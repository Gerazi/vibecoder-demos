(function () {
  "use strict";

  // Кириллица и эмодзи — только в UTF-8, иначе сканер покажет кракозябры.
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

  const $ = (id) => document.getElementById(id);
  const form = $("form");
  const canvas = $("canvas");
  let mode = "text";
  let current = null; // { qr, payload, fg, bg, margin }

  // --- Что кодируем ---------------------------------------------------------
  // Спецсимволы в Wi-Fi-строке экранируются обратным слэшем (формат ZXing,
  // его понимают камеры iOS и Android).
  const wifiEscape = (s) => s.replace(/([\\;,:"])/g, "\\$1");
  // В vCard экранируются \ , ; и переводы строк.
  const vEscape = (s) => s.replace(/([\\,;])/g, "\\$1").replace(/\n/g, "\\n");

  function payload() {
    const f = Object.fromEntries(new FormData(form));
    if (mode === "text") return f.text.trim();

    if (mode === "wifi") {
      if (!f.ssid.trim()) return "";
      const sec = f.security;
      const parts = [`T:${sec}`, `S:${wifiEscape(f.ssid)}`];
      if (sec !== "nopass" && f.password) parts.push(`P:${wifiEscape(f.password)}`);
      if (form.elements.hidden.checked) parts.push("H:true");
      return `WIFI:${parts.join(";")};;`;
    }

    // Визитка
    const first = f.first.trim(), last = f.last.trim();
    if (!first && !last && !f.phone.trim() && !f.email.trim()) return "";
    const lines = ["BEGIN:VCARD", "VERSION:3.0"];
    lines.push(`N:${vEscape(last)};${vEscape(first)};;;`);
    lines.push(`FN:${vEscape([first, last].filter(Boolean).join(" ") || f.org.trim() || f.phone.trim() || f.email.trim())}`);
    if (f.org.trim()) lines.push(`ORG:${vEscape(f.org.trim())}`);
    if (f.role.trim()) lines.push(`TITLE:${vEscape(f.role.trim())}`);
    if (f.phone.trim()) lines.push(`TEL;TYPE=CELL:${f.phone.trim()}`);
    if (f.email.trim()) lines.push(`EMAIL:${f.email.trim()}`);
    if (f.url.trim()) lines.push(`URL:${f.url.trim()}`);
    lines.push("END:VCARD");
    return lines.join("\n");
  }

  // --- Контраст: светлый код на светлом фоне сканер не прочтёт --------------
  function luminance(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  // --- Отрисовка ------------------------------------------------------------
  function draw(ctx, qr, size, fg, bg, margin) {
    const n = qr.getModuleCount();
    const cell = size / (n + margin * 2);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = fg;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) {
          // Округление до целых пикселей — иначе между модулями видны щели.
          const x = Math.round((c + margin) * cell), y = Math.round((r + margin) * cell);
          const x2 = Math.round((c + margin + 1) * cell), y2 = Math.round((r + margin + 1) * cell);
          ctx.fillRect(x, y, x2 - x, y2 - y);
        }
      }
    }
  }

  function svgOf({ qr, fg, bg, margin }) {
    const n = qr.getModuleCount();
    const total = n + margin * 2;
    let path = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) path += `M${c + margin} ${r + margin}h1v1h-1z`;
      }
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">
<rect width="${total}" height="${total}" fill="${bg}"/>
<path d="${path}" fill="${fg}"/>
</svg>`;
  }

  function update() {
    const text = payload();
    const f = Object.fromEntries(new FormData(form));
    const wrap = $("canvas-wrap");
    const warn = $("warn");
    $("raw").textContent = text;
    warn.textContent = "";
    $("meta").textContent = "";

    if (!text) {
      current = null;
      wrap.classList.add("empty");
      setButtons(false);
      return;
    }

    let qr;
    try {
      qr = qrcode(0, f.ecc);
      qr.addData(text, "Byte");
      qr.make();
    } catch {
      current = null;
      wrap.classList.add("empty");
      setButtons(false);
      warn.textContent = "Слишком много данных для одного QR-кода. Сократите текст или выберите коррекцию L.";
      return;
    }

    const margin = Number(f.margin);
    current = { qr, payload: text, fg: f.fg, bg: f.bg, margin };
    wrap.classList.remove("empty");
    const size = 640;
    canvas.width = canvas.height = size;
    draw(canvas.getContext("2d"), qr, size, f.fg, f.bg, margin);
    setButtons(true);

    const n = qr.getModuleCount();
    const bytes = new TextEncoder().encode(text).length;
    $("meta").textContent = `${n}×${n} модулей · версия ${(n - 17) / 4} · ${bytes} байт`;

    const ratio = contrast(f.fg, f.bg);
    if (ratio < 3) warn.textContent = "Цвета почти не различаются — многие сканеры такой код не прочтут.";
    else if (luminance(f.fg) > luminance(f.bg)) warn.textContent = "Светлый код на тёмном фоне читают не все камеры. Надёжнее — тёмный на светлом.";
    else if (margin === 0) warn.textContent = "Без поля код плохо читается на пёстром фоне — оставьте хотя бы узкое.";
  }

  function setButtons(on) {
    $("dl-png").disabled = !on;
    $("dl-svg").disabled = !on;
  }

  // --- Скачивание -----------------------------------------------------------
  function fileBase() {
    if (mode === "wifi") return "qr-wifi";
    if (mode === "vcard") return "qr-contact";
    return "qr-code";
  }
  function download(href, name) {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
  }

  $("dl-png").addEventListener("click", () => {
    if (!current) return;
    const size = Number($("png-size").value);
    const c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), current.qr, size, current.fg, current.bg, current.margin);
    c.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      download(url, `${fileBase()}-${size}.png`);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  });

  $("dl-svg").addEventListener("click", () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([svgOf(current)], { type: "image/svg+xml" }));
    download(url, `${fileBase()}.svg`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // --- Вкладки --------------------------------------------------------------
  document.querySelectorAll("[role=tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      mode = tab.dataset.mode;
      document.querySelectorAll("[role=tab]").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      document.querySelectorAll("fieldset[data-mode]").forEach((fs) => (fs.hidden = fs.dataset.mode !== mode));
      update();
    });
  });

  form.addEventListener("input", update);
  form.addEventListener("change", update);
  form.addEventListener("submit", (e) => e.preventDefault());

  // Ссылка вида /qr/?text=… сразу показывает код — удобно, чтобы делиться.
  const initial = new URLSearchParams(location.search).get("text");
  if (initial) form.elements.text.value = initial;
  update();
})();
