/* Маршруты и переходы (глава I, 3.1).

   Маршрут живёт в `location.hash`, поэтому работают кнопка «назад» браузера,
   жест «назад» на телефоне и прямые ссылки. Своего роутера не нужно —
   достаточно таблицы шаблонов и стека возврата. */

import { clear, el, icon, toast } from "./ui.js";

import * as home from "./screens/home.js";
import * as day from "./screens/day.js";
import * as endless from "./screens/endless.js";
import * as history from "./screens/history.js";
import * as review from "./screens/review.js";
import * as packs from "./screens/packs.js";
import * as settings from "./screens/settings.js";
import * as help from "./screens/help.js";
import * as onboarding from "./screens/onboarding.js";

/* Оболочка экрана («chrome») — три вида:
     panel — левая боковая панель вместо верхней (хаб, история, языки, настройки);
     top   — полная экранная сессия с полосой «Назад / заголовок» (день, повторение);
     none  — ни того, ни другого (знакомство, у него свой выход). */
const ROUTES = [
  { pattern: "/home", screen: home, chrome: "panel" },
  { pattern: "/day/:kind", screen: day, chrome: "top" },
  { pattern: "/endless/:kind", screen: endless, chrome: "top" },
  { pattern: "/history", screen: history, chrome: "panel" },
  { pattern: "/history/:date", screen: history, chrome: "panel" },
  { pattern: "/review/:date/:kind", screen: review, chrome: "top" },
  { pattern: "/packs", screen: packs, chrome: "panel" },
  { pattern: "/settings", screen: settings, chrome: "panel" },
  { pattern: "/help", screen: help, chrome: "top" },
  { pattern: "/onboarding", screen: onboarding, chrome: "none" },
];

export const HOME = "#/home";

let container = null;
let stack = [];              // наши переходы: последний элемент — текущий экран
let rendering = false;

function parse(hash) {
  const path = (hash || "").replace(/^#/, "") || "/home";
  const parts = path.split("/").filter(Boolean);
  for (const route of ROUTES) {
    const template = route.pattern.split("/").filter(Boolean);
    if (template.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < template.length; i++) {
      if (template[i].startsWith(":")) params[template[i].slice(1)] = decodeURIComponent(parts[i]);
      else if (template[i] !== parts[i]) { ok = false; break; }
    }
    if (ok) return { route, params, path: `/${parts.join("/")}` };
  }
  return null;
}

export function navigate(hash, { replace = false } = {}) {
  const target = hash.startsWith("#") ? hash : `#${hash}`;
  if (target === location.hash) return render();
  if (replace) {
    stack[Math.max(stack.length - 1, 0)] = target;
    location.replace(target);
  } else {
    location.hash = target;
  }
}

/** Назад — шагом браузера, если шаг наш; иначе на хаб. Кнопка «назад» телефона
    и жест работают тем же путём: стек ведём по hashchange. Вызывается панелью
    (`start`), экранам он не нужен — у них есть `navigate`. */
function back() {
  if (stack.length > 1) window.history.back();
  else navigate(HOME, { replace: true });
}

function trackHash() {
  const current = location.hash || HOME;
  if (stack.length > 1 && stack[stack.length - 2] === current) stack.pop();
  else if (stack[stack.length - 1] !== current) stack.push(current);
  return render();
}

export function canGoBack() {
  return location.hash !== HOME && location.hash !== "";
}

export function refresh() { return render(); }

export async function render() {
  if (rendering) return;
  rendering = true;
  const match = parse(location.hash);
  try {
    if (!match) { navigate(HOME, { replace: true }); return; }
    const { route, params, path } = match;
    const ctx = { params, navigate, refresh, setTitle };
    const node = await route.screen.render(ctx);
    clear(container).append(node);
    setTitle(typeof route.screen.title === "function"
      ? route.screen.title(params) : route.screen.title || "VOCAB");
    // Вид оболочки задаёт маршрут: у дня и повторения — своя полоса сверху,
    // у разделов — навигация в боковой панели.
    document.querySelector(".app").dataset.chrome = route.chrome;
    setActiveItem(path);
    // Экран может отказаться от «назад»: у знакомства свой выход — «Пропустить».
    document.getElementById("back").hidden = !canGoBack() || !!route.screen.noBack;
    container.scrollTop = 0;
    window.scrollTo(0, 0);
  } catch (error) {
    console.error(error);
    clear(container).append(el("div.card", {},
      el("h2", {}, "Что-то сломалось"),
      el("p.muted", {}, String(error && error.message || error)),
      el("button.btn.btn--wide", { type: "button", onclick: () => navigate(HOME) }, "На главную")));
    toast("Ошибка экрана");
  } finally {
    rendering = false;
  }
}

/** Подсветка текущего раздела в боковой панели: активен пункт, чей маршрут
    является префиксом текущего пути («/history/2026-09-01» → «История»). */
function setActiveItem(path) {
  for (const item of document.querySelectorAll(".side__item[data-route]")) {
    const target = item.dataset.route.slice(1);          // "#/history" -> "/history"
    const on = path === target || path.startsWith(target + "/");
    item.classList.toggle("side__item--on", on);
  }
}

function setTitle(text) {
  document.getElementById("title").textContent = text;
}

/** Боковая панель: значки в ITEMS вставляет здесь, клики ведут тем же
    `navigate`, что и ссылки на экранах. */
function wireSidebar() {
  for (const item of document.querySelectorAll(".side__item[data-route]")) {
    if (item.dataset.icon) item.prepend(icon(item.dataset.icon));
    item.addEventListener("click", () => navigate(item.dataset.route));
  }
}

export function start(node) {
  container = node;
  wireSidebar();
  window.addEventListener("hashchange", trackHash);
  document.getElementById("back").addEventListener("click", back);
  if (!location.hash) location.replace(HOME);
  stack = [location.hash || HOME];
  return render();
}
