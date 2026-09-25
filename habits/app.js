(function () {
  "use strict";

  const STORAGE_KEY = "habits.v1";
  const COLORS = ["#7ef0c4", "#ffcf5c", "#9ab8ff", "#ff9ec7", "#c9a7ff", "#7fd6ff"];
  const WEEKDAY = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
  const HEAT_WEEKS = 12;

  // --- Даты: только локальные ключи ГГГГ-ММ-ДД, без часовых поясов ----------
  const pad = (n) => String(n).padStart(2, "0");
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const today = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };

  // --- Хранилище: браузер может запретить localStorage (приватный режим) ---
  let storageOk = true;
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const data = raw ? JSON.parse(raw) : null;
      return normalize(data) ?? { habits: [] };
    } catch {
      storageOk = false;
      return { habits: [] };
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      storageOk = true;
    } catch {
      storageOk = false;
    }
  }
  // Проверяет форму данных — и из localStorage, и из загруженного файла.
  function normalize(data) {
    if (!data || !Array.isArray(data.habits)) return null;
    const habits = [];
    for (const h of data.habits) {
      if (!h || typeof h.name !== "string" || !h.name.trim()) continue;
      habits.push({
        id: typeof h.id === "string" ? h.id : uid(),
        name: h.name.trim().slice(0, 60),
        color: COLORS.includes(h.color) ? h.color : COLORS[0],
        created: /^\d{4}-\d{2}-\d{2}$/.test(h.created) ? h.created : keyOf(today()),
        done: Array.isArray(h.done) ? [...new Set(h.done.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)))].sort() : [],
      });
    }
    return { habits };
  }
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  let state = load();
  let color = COLORS[0];
  const expanded = new Set();

  // --- Подсчёты --------------------------------------------------------------
  // Текущая серия: подряд идущие дни до сегодня. Если сегодня ещё не отмечено,
  // серия не обрывается — считаем до вчера: день ещё не закончился.
  function currentStreak(h) {
    const set = new Set(h.done);
    let d = today();
    if (!set.has(keyOf(d))) d = addDays(d, -1);
    let n = 0;
    while (set.has(keyOf(d))) { n++; d = addDays(d, -1); }
    return n;
  }
  function bestStreak(h) {
    let best = 0, run = 0, prev = null;
    for (const k of h.done) {
      const [y, m, dd] = k.split("-").map(Number);
      const d = new Date(y, m - 1, dd);
      run = prev && keyOf(addDays(prev, 1)) === k ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    }
    return best;
  }
  // Доля выполненных дней за последние 30 — но не раньше дня создания привычки.
  function rate30(h) {
    const set = new Set(h.done);
    const t = today();
    let total = 0, done = 0;
    for (let i = 0; i < 30; i++) {
      const k = keyOf(addDays(t, -i));
      if (k < h.created && !set.has(k)) break;
      total++;
      if (set.has(k)) done++;
    }
    return total ? Math.round((done / total) * 100) : 0;
  }
  const plural = (n, one, few, many) => {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  };
  const days = (n) => `${n} ${plural(n, "день", "дня", "дней")}`;

  // --- Отрисовка -------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const visibleDays = () => (window.matchMedia("(max-width: 640px)").matches ? 7 : 14);

  function renderHeader() {
    const t = today();
    $("today-label").textContent = t.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    const n = visibleDays();
    const head = $("days-head");
    head.style.setProperty("--days", n);
    head.innerHTML = "";
    for (let i = n - 1; i >= 0; i--) {
      const d = addDays(t, -i);
      const el = document.createElement("span");
      el.textContent = `${WEEKDAY[d.getDay()]} ${d.getDate()}`;
      if (i === 0) el.className = "today";
      head.appendChild(el);
    }
  }

  function renderSummary() {
    const t = keyOf(today());
    const total = state.habits.length;
    const doneToday = state.habits.filter((h) => h.done.includes(t)).length;
    const best = state.habits.reduce((a, h) => Math.max(a, currentStreak(h)), 0);
    $("summary").innerHTML = total
      ? `<div class="pill"><b>${doneToday} из ${total}</b><span>сделано сегодня</span></div>
         <div class="pill"><b>${days(best)}</b><span>самая длинная серия сейчас</span></div>`
      : "";
  }

  function renderHabits() {
    const list = $("habits");
    list.innerHTML = "";
    $("empty").hidden = state.habits.length > 0;
    $("days-head").hidden = state.habits.length === 0;
    const n = visibleDays();
    const t = today();
    const tpl = $("habit-tpl");

    for (const h of state.habits) {
      const li = tpl.content.firstElementChild.cloneNode(true);
      li.style.setProperty("--c", h.color);
      li.dataset.id = h.id;
      const set = new Set(h.done);

      const name = li.querySelector(".habit-name");
      name.innerHTML = "<span></span>";
      name.firstChild.textContent = h.name;
      name.setAttribute("aria-expanded", String(expanded.has(h.id)));
      li.querySelector(".habit-stats").innerHTML =
        `серия <b>${days(currentStreak(h))}</b> · лучшая ${days(bestStreak(h))} · за 30 дней <b>${rate30(h)}%</b>`;

      const cells = li.querySelector(".cells");
      cells.style.setProperty("--days", n);
      for (let i = n - 1; i >= 0; i--) {
        const d = addDays(t, -i);
        const k = keyOf(d);
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cell" + (set.has(k) ? " done" : "") + (i === 0 ? " today" : "");
        b.dataset.day = k;
        b.textContent = d.getDate();
        b.setAttribute("aria-pressed", String(set.has(k)));
        b.setAttribute("aria-label", `${h.name}, ${d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}`);
        cells.appendChild(b);
      }

      const more = li.querySelector(".habit-more");
      more.hidden = !expanded.has(h.id);
      if (!more.hidden) {
        const heat = li.querySelector(".heat");
        // Сетка 12 недель: колонки — недели (пн…вс), последняя колонка — текущая.
        const mondayOffset = (t.getDay() + 6) % 7;
        const start = addDays(t, -mondayOffset - (HEAT_WEEKS - 1) * 7);
        for (let i = 0; i < HEAT_WEEKS * 7; i++) {
          const d = addDays(start, i);
          const k = keyOf(d);
          const cell = document.createElement("i");
          if (d > t) cell.className = "future";
          else if (set.has(k)) cell.className = "done";
          cell.title = d.toLocaleDateString("ru-RU") + (set.has(k) ? " — сделано" : "");
          heat.appendChild(cell);
        }
      }
      list.appendChild(li);
    }
  }

  function render() {
    renderHeader();
    renderSummary();
    renderHabits();
  }

  function notify(text) {
    $("notice").textContent = text;
    clearTimeout(notify.t);
    notify.t = setTimeout(() => ($("notice").textContent = ""), 5000);
  }

  function commit() {
    save();
    render();
    if (!storageOk) notify("Браузер не даёт сохранить данные (приватный режим?). Отметки пропадут после перезагрузки — сохраните их в файл.");
  }

  // --- Действия --------------------------------------------------------------
  const swatches = $("swatches");
  COLORS.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.background = c;
    b.setAttribute("role", "radio");
    b.setAttribute("aria-label", `Цвет ${i + 1}`);
    b.setAttribute("aria-checked", String(c === color));
    b.addEventListener("click", () => {
      color = c;
      swatches.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-checked", String(s === b)));
    });
    swatches.appendChild(b);
  });

  function addHabit(name, c) {
    state.habits.push({ id: uid(), name, color: c, created: keyOf(today()), done: [] });
  }

  $("add-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("habit-name");
    const name = input.value.trim();
    if (!name) return;
    if (state.habits.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
      notify("Такая привычка уже есть");
      return;
    }
    addHabit(name, color);
    input.value = "";
    // Следующая привычка — следующим цветом, чтобы строки различались без выбора вручную.
    const next = COLORS[(COLORS.indexOf(color) + 1) % COLORS.length];
    swatches.children[COLORS.indexOf(next)].click();
    commit();
  });

  $("add-examples").addEventListener("click", () => {
    addHabit("Лечь спать до полуночи", COLORS[0]);
    addHabit("30 минут пешком", COLORS[1]);
    addHabit("Прочитать 20 страниц", COLORS[2]);
    commit();
  });

  $("habits").addEventListener("click", (e) => {
    const li = e.target.closest(".habit");
    if (!li) return;
    const h = state.habits.find((x) => x.id === li.dataset.id);
    if (!h) return;

    const cell = e.target.closest(".cell");
    if (cell) {
      const k = cell.dataset.day;
      h.done = h.done.includes(k) ? h.done.filter((x) => x !== k) : [...h.done, k].sort();
      commit();
      return;
    }
    if (e.target.closest(".habit-name")) {
      expanded.has(h.id) ? expanded.delete(h.id) : expanded.add(h.id);
      render();
      return;
    }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "rename") {
      const name = prompt("Новое название", h.name)?.trim();
      if (name) { h.name = name.slice(0, 60); commit(); }
    } else if (act === "delete") {
      if (confirm(`Удалить «${h.name}» вместе со всеми отметками?`)) {
        state.habits = state.habits.filter((x) => x.id !== h.id);
        expanded.delete(h.id);
        commit();
      }
    }
  });

  $("export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ ...state, exported: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `habits-${keyOf(today())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = normalize(JSON.parse(await file.text()));
      if (!data) throw new Error("format");
      if (state.habits.length && !confirm(`Заменить текущие привычки (${state.habits.length}) данными из файла?`)) return;
      state = data;
      commit();
      notify(`Загружено привычек: ${data.habits.length}`);
    } catch {
      notify("Не получилось прочитать файл — это должен быть файл, сохранённый этим трекером.");
    }
  });

  // Новый день наступил, пока вкладка была открыта, — перерисовать.
  let lastDay = keyOf(today());
  setInterval(() => {
    const k = keyOf(today());
    if (k !== lastDay) { lastDay = k; render(); }
  }, 60 * 1000);
  window.matchMedia("(max-width: 640px)").addEventListener("change", render);

  render();
})();
