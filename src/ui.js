/* Мелочи, общие для всех экранов: создание узлов, тосты, модальные окна,
   форматирование дат и частей речи. */

export const POS_LABELS = {
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
        el("button.btn.btn--bad", { type: "button", onclick: () => close(true) }, confirmLabel))));
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

export function todayISO(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

/** Блок примера: два предложения, сворачиваются до двух строк, раскрываются по тапу. */
export function exampleBlock(exEn, exTr) {
  if (!exEn) return null;
  const block = el("div.example.example--clamped", {
    onclick: (e) => { e.stopPropagation(); block.classList.toggle("example--clamped"); },
    title: "Нажмите, чтобы раскрыть",
  },
    el("div.example__en", {}, exEn),
    exTr ? el("div.example__tr", {}, exTr) : null);
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
