(function () {
  const cfg = window.SITE_CONFIG;
  const DAYS = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];
  // «Откроемся в понедельник / во вторник / в среду» — винительный падеж с предлогом.
  const ON_DAY = ["в воскресенье", "в понедельник", "во вторник", "в среду", "в четверг", "в пятницу", "в субботу"];
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const rub = (n) => new Intl.NumberFormat("ru-RU").format(n) + " ₽";

  // Простые поля — прямо из конфига.
  document.querySelectorAll("[data-bind]").forEach((el) => {
    el.textContent = cfg[el.dataset.bind] ?? "";
  });
  document.title = `${cfg.name} — ${cfg.tagline}`;

  const tel = "tel:" + cfg.phone.replace(/[^\d+]/g, "");
  for (const id of ["hero-phone", "contact-phone"]) {
    const a = document.getElementById(id);
    a.href = tel;
    a.textContent = cfg.phone;
  }
  const mail = document.getElementById("contact-email");
  mail.href = "mailto:" + cfg.email;
  mail.textContent = cfg.email;

  // --- Открыто ли сейчас -------------------------------------------------
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };

  function openStatus(now) {
    const day = now.getDay();
    const minutes = now.getHours() * 60 + now.getMinutes();
    const today = cfg.hours[day];
    if (today && minutes >= toMinutes(today[0]) && minutes < toMinutes(today[1])) {
      return { open: true, text: `Открыто до ${today[1]}` };
    }
    // Ищем ближайшее открытие: сегодня позже или в следующие дни.
    for (let shift = 0; shift < 7; shift++) {
      const d = (day + shift) % 7;
      const hours = cfg.hours[d];
      if (!hours) continue;
      if (shift === 0 && minutes >= toMinutes(hours[0])) continue;
      const when = shift === 0 ? "сегодня" : shift === 1 ? "завтра" : ON_DAY[d];
      return { open: false, text: `Закрыто · откроемся ${when} в ${hours[0]}` };
    }
    return { open: false, text: "Закрыто" };
  }

  function renderStatus() {
    const s = openStatus(new Date());
    const el = document.getElementById("status");
    el.textContent = s.text;
    el.classList.toggle("closed", !s.open);
  }
  renderStatus();
  setInterval(renderStatus, 60 * 1000);

  // --- Часы работы -------------------------------------------------------
  const hoursTable = document.getElementById("hours");
  const todayIdx = new Date().getDay();
  for (const d of ORDER) {
    const tr = document.createElement("tr");
    if (d === todayIdx) tr.className = "today";
    const h = cfg.hours[d];
    tr.innerHTML = `<td>${DAYS[d]}</td><td>${h ? `${h[0]}–${h[1]}` : "выходной"}</td>`;
    hoursTable.appendChild(tr);
  }

  // --- Услуги ------------------------------------------------------------
  const duration = (min) => {
    if (min < 60) return `${min} мин`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} ч ${m} мин` : `${h} ч`;
  };

  const list = document.getElementById("services-list");
  const calcForm = document.getElementById("calc-form");
  for (const s of cfg.services) {
    const card = document.createElement("article");
    card.className = "service";
    card.innerHTML = `
      <div class="service-head">
        <span class="service-title"></span>
        <span class="service-price">от ${rub(s.price)}</span>
      </div>
      <p class="service-note"></p>
      <p class="service-time">≈ ${duration(s.minutes)}</p>`;
    card.querySelector(".service-title").textContent = s.title;
    card.querySelector(".service-note").textContent = s.note;
    list.appendChild(card);

    const row = document.createElement("label");
    row.className = "calc-item";
    row.innerHTML = `<input type="checkbox" name="service" value="${s.id}"><span></span><span>от ${rub(s.price)}</span>`;
    row.querySelector("span").textContent = s.title;
    calcForm.appendChild(row);
  }

  // --- Калькулятор -------------------------------------------------------
  const selected = () =>
    [...calcForm.querySelectorAll("input:checked")].map((i) => cfg.services.find((s) => s.id === i.value));

  function renderTotal() {
    const items = selected();
    const sum = items.reduce((a, s) => a + s.price, 0);
    const min = items.reduce((a, s) => a + s.minutes, 0);
    document.getElementById("calc-sum").textContent = (items.length ? "от " : "") + rub(sum);
    document.getElementById("calc-time").textContent = items.length
      ? `Работы примерно на ${duration(min)}`
      : "Выберите хотя бы одну работу";
  }
  calcForm.addEventListener("change", renderTotal);
  renderTotal();

  // --- FAQ ---------------------------------------------------------------
  const faq = document.getElementById("faq-list");
  for (const [q, a] of cfg.faq) {
    const d = document.createElement("details");
    d.innerHTML = "<summary></summary><p></p>";
    d.querySelector("summary").textContent = q;
    d.querySelector("p").textContent = a;
    faq.appendChild(d);
  }

  // --- Заявка ------------------------------------------------------------
  const request = document.getElementById("request");
  const error = document.getElementById("form-error");
  if (!cfg.telegram) document.getElementById("send-telegram").hidden = true;

  function requestText() {
    const data = new FormData(request);
    const items = selected();
    const lines = [
      `Заявка с сайта «${cfg.name}»`,
      `Имя: ${data.get("name").trim()}`,
      `Контакт: ${data.get("contact").trim()}`,
    ];
    if (items.length) {
      lines.push("Работы:");
      for (const s of items) lines.push(`— ${s.title} (от ${rub(s.price)})`);
      lines.push(`Ориентир: от ${rub(items.reduce((a, s) => a + s.price, 0))}`);
    }
    const comment = data.get("comment").trim();
    if (comment) lines.push(`Комментарий: ${comment}`);
    return lines.join("\n");
  }

  function validate() {
    const data = new FormData(request);
    if (!data.get("name").trim()) return "Напишите, как к вам обращаться";
    if (!data.get("contact").trim()) return "Оставьте телефон или ник — иначе не сможем ответить";
    if (!selected().length && !data.get("comment").trim())
      return "Отметьте работы в списке или опишите, что случилось";
    return "";
  }

  request.addEventListener("submit", (e) => {
    e.preventDefault();
    const problem = validate();
    error.textContent = problem;
    if (problem) return;
    const text = requestText();
    const channel = e.submitter?.dataset.channel;
    if (channel === "telegram") {
      window.open(`https://t.me/${cfg.telegram}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    } else {
      location.href = `mailto:${cfg.email}?subject=${encodeURIComponent("Заявка на ремонт")}&body=${encodeURIComponent(text)}`;
    }
  });

  document.getElementById("copy-request").addEventListener("click", async () => {
    const problem = validate();
    error.textContent = problem;
    if (problem) return;
    const hint = document.getElementById("copy-hint");
    try {
      await navigator.clipboard.writeText(requestText());
      hint.textContent = "Текст заявки скопирован — вставьте его в любой мессенджер.";
    } catch {
      hint.textContent = "Браузер не дал доступ к буферу обмена — выделите и скопируйте текст вручную.";
    }
  });
})();
