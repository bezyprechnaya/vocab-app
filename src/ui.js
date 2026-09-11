/* Мелочи, общие для всех экранов: создание узлов, тосты, модальные окна,
   форматирование дат и частей речи. */

const POS_LABELS = {
  n: "сущ.", v: "глаг.", adj: "прил.", adv: "нареч.", prep: "предлог",
  conj: "союз", pron: "мест.", det: "опред.", num: "числ.",
};

export function posLabel(pos) {
  if (pos.startsWith("phr")) return "фразовый глагол";
  return POS_LABELS[pos] || pos;
}

/** el("div.card", {onclick}, "текст", el("span", …)) — короткая замена шаблонам. */
export function el(spec, props, ...children) {
  const [tag, ...classes] = spec.split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");
  if (props && (typeof props !== "object" || props instanceof Node)) {
    children.unshift(props);
    props = null;
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key === "html") {
      node.innerHTML = value;
    } else if (key in node && key !== "list") {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? "" : value);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* Значки — тонкая линия в один вес, без заливки и без скруглений: тот же
   штрих, что у рамок и разделителей. Эмодзи на их месте выглядели чужеродно —
   у каждого свой цвет и своя жирность, и строй списка от них рассыпался. */

const ICONS = {
  book: '<path d="M3.5 4.5h6a2 2 0 0 1 2 2v13a1.8 1.8 0 0 0-1.8-1.5H3.5z"/>'
    + '<path d="M20.5 4.5h-6a2 2 0 0 0-2 2v13a1.8 1.8 0 0 1 1.8-1.5h6.2z"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/>'
    + '<path d="M11 6.5 13 4.5a3.5 3.5 0 0 1 5 5l-2 2"/>'
    + '<path d="M13 17.5 11 19.5a3.5 3.5 0 0 1-5-5l2-2"/>',
  infinity: '<path d="M12 12c1.6-2.2 2.8-3.3 4.4-3.3a3.3 3.3 0 0 1 0 6.6C14.8 15.3 13.6 14.2 12 12z"/>'
    + '<path d="M12 12c-1.6 2.2-2.8 3.3-4.4 3.3a3.3 3.3 0 0 1 0-6.6C9.2 8.7 10.4 9.8 12 12z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5"/>'
    + '<path d="M3.5 9.5h17"/><path d="M8 3.5v3"/><path d="M16 3.5v3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/>'
    + '<path d="M12 3.5a13 13 0 0 1 3.4 8.5A13 13 0 0 1 12 20.5 13 13 0 0 1 8.6 12 13 13 0 0 1 12 3.5z"/>',
  settings: '<path d="M3.5 8h11.8M19.7 8h.8"/><circle cx="17.5" cy="8" r="2.2"/>'
    + '<path d="M3.5 16h.8M8.7 16h11.8"/><circle cx="6.5" cy="16" r="2.2"/>',
  check: '<polyline points="4 12.5 9.5 18 20 6"/>',
  flame: '<path d="M12 3.5c3 3 5 5.3 5 8.5a5 5 0 0 1-10 0c0-1.6.7-3 2-4.4.3 1.3 1 2 2 2.2-.4-2.4.3-4.4 1-6.3z"/>',
};

/** Значок как узел: `el("span.hub__icon", {}, icon("book"))`. */
export function icon(name) {
  const box = document.createElement("span");
  box.className = "icon";
  box.setAttribute("aria-hidden", "true");
  box.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"`
    + ` stroke-width="1.25" stroke-linecap="square" stroke-linejoin="miter">`
    + `${ICONS[name] || ""}</svg>`;
  return box;
}

let toastTimer = null;

export function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3500);
}

/** Подтверждение разрушительного действия. По умолчанию — отмена (глава I, 3.6). */
export function confirmAction({ title, text, confirmLabel = "Удалить", extra }) {
  const box = document.getElementById("modal");
  return new Promise((resolve) => {
    const close = (value) => { box.hidden = true; clear(box); resolve(value); };
    clear(box).append(el("div.modal__box", {},
      el("h2.modal__title", {}, title),
      el("p.modal__text", {}, text),
      extra || null,
      el("div.modal__actions", {},
        el("button.btn", { type: "button", onclick: () => close(false) }, "Отмена"),
        el("button.btn.btn--danger", { type: "button", onclick: () => close(true) }, confirmLabel))));
    box.hidden = false;
    box.onclick = (e) => { if (e.target === box) close(false); };
  });
}

/** Диалог с несколькими вариантами. Возвращает value выбранной кнопки или null,
    если человек отказался: отмена — всегда отдельный, безопасный выход. */
export function chooseAction({ title, text, options, extra }) {
  const box = document.getElementById("modal");
  return new Promise((resolve) => {
    const close = (value) => { box.hidden = true; clear(box); resolve(value); };
    const buttons = options.map((option) => el(
      `button.btn${option.tone ? `.btn--${option.tone}` : ""}`,
      { type: "button", onclick: () => close(option.value) }, option.label));
    clear(box).append(el("div.modal__box", {},
      el("h2.modal__title", {}, title),
      el("p.modal__text", {}, text),
      extra || null,
      el("div.modal__actions", { style: "flex-wrap:wrap" },
        el("button.btn", { type: "button", onclick: () => close(null) }, "Отмена"),
        buttons)));
    box.hidden = false;
    box.onclick = (e) => { if (e.target === box) close(null); };
  });
}

/** Экран загрузки для долгого дела: заголовок, полоса, строка состояния и отмена.
    Сборка пакета идёт минуты, и всё это время должно быть видно, что происходит
    и что процесс можно прервать. */
export function progressModal({ title, text = "", cancelLabel = "Отмена" }) {
  const box = document.getElementById("modal");
  const fill = el("div.bar__fill", { style: "width:0%" });
  const note = el("p.modal__text", {}, text);
  const button = el("button.btn", { type: "button" }, cancelLabel);
  clear(box).append(el("div.modal__box", {},
    el("h2.modal__title", {}, title),
    note,
    el("div.bar", {}, fill),
    el("div.modal__actions", { style: "margin-top:16px" }, button)));
  box.hidden = false;
  box.onclick = null;                       // случайный тап мимо не должен всё бросать
  return {
    set(value, message) {
      fill.style.width = `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`;
      if (message) note.textContent = message;
    },
    onCancel(fn) { button.onclick = fn; },
    close() { box.hidden = true; clear(box); },
  };
}

export function todayISO(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Соседний день в ISO: `shift` — сколько дней вперёд или назад. Дата собирается
    через локальный Date, поэтому переход через месяц и год считает браузер. */
export function shiftDate(iso, shift) {
  const [y, m, d] = iso.split("-").map(Number);
  return todayISO(new Date(y, m - 1, d + shift));
}

/** Тема: `auto` отдаёт выбор системе, `light` и `dark` — фиксируют.
    Атрибут на <html> перебивает медиазапрос, поэтому переключение мгновенное. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
  else root.removeAttribute("data-theme");
}

const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря"];

export function formatDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const today = todayISO();
  if (iso === today) return "сегодня";
  const yesterday = todayISO(new Date(Date.now() - 86400000));
  if (iso === yesterday) return "вчера";
  const now = new Date();
  const year = y === now.getFullYear() ? "" : ` ${y}`;
  return `${d} ${MONTHS[m - 1]}${year}`;
}

/** Счёт дня словами: «10 новых + 6 знакомых». Нуля в строке не бывает —
    «+ 0 знакомых» это не факт о дне, а шум. */
export function scoreLine({ fresh, known }) {
  const left = plural(fresh, "новое", "новых", "новых");
  const right = plural(known, "знакомое", "знакомых", "знакомых");
  if (!known) return left;
  if (!fresh) return right;
  return `${left} + ${right}`;
}

export function plural(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} ${one}`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Блок примера: два предложения, сворачиваются до двух строк, раскрываются по тапу.
    Совпавшие строки — это пара «английский → английский»: одно предложение,
    показанное дважды, только занимало бы место. */
export function exampleBlock(exStudy, exTr) {
  if (!exStudy) return null;
  const block = el("div.example.example--clamped", {
    onclick: (e) => { e.stopPropagation(); block.classList.toggle("example--clamped"); },
    title: "Нажмите, чтобы раскрыть",
  },
    el("div.example__en", {}, `«${exStudy}»`),
    exTr && exTr !== exStudy ? el("div.example__tr", {}, exTr) : null);
  return block;
}

/** Пометка машинного перевода (глава I, 3.5). */
export function originBadge(origin) {
  if (origin !== "mt") return null;
  return el("span.badge-mt", {
    title: "Машинный перевод: слово переведено автоматически, смысл уточняйте по примеру",
  }, "mt");
}

/** Свайп по карточке: влево — «повторить ещё», вправо — «знаю» (глава I, 3.7).
    Кнопки остаются на месте, свайп — только дополнение к ним. */
export function attachSwipe(node, { onLeft, onRight, threshold = 60 } = {}) {
  let startX = null, startY = null, moved = false;

  node.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY; moved = false;
  });

  node.addEventListener("pointermove", (e) => {
    if (startX === null) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) < Math.abs(dy)) return;          // вертикальный жест — это скролл
    moved = Math.abs(dx) > 10;
    if (moved) node.style.transform = `translateX(${dx}px)`;
  });

  const finish = (e) => {
    if (startX === null) return;
    const dx = (e.clientX ?? startX) - startX;
    node.style.transform = "";
    startX = null;
    if (!moved) return;
    if (dx <= -threshold && onLeft) onLeft();
    else if (dx >= threshold && onRight) onRight();
  };

  node.addEventListener("pointerup", finish);
  node.addEventListener("pointercancel", () => { node.style.transform = ""; startX = null; });
  return node;
}
