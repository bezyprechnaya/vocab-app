/* Маршруты и переходы (глава I, 3.1).

   Маршрут живёт в `location.hash`, поэтому работают кнопка «назад» браузера,
   жест «назад» на телефоне и прямые ссылки. Своего роутера не нужно —
   достаточно таблицы шаблонов и стека возврата. */

import { clear, el, toast } from "./ui.js";

import * as home from "./screens/home.js";
import * as day from "./screens/day.js";
import * as history from "./screens/history.js";
import * as review from "./screens/review.js";
import * as packs from "./screens/packs.js";
import * as settings from "./screens/settings.js";
import * as help from "./screens/help.js";
import * as onboarding from "./screens/onboarding.js";

const ROUTES = [
  { pattern: "/home", screen: home },
  { pattern: "/day/:kind", screen: day },
  { pattern: "/history", screen: history },
  { pattern: "/history/:date", screen: history },
  { pattern: "/review/:date/:kind", screen: review },
  { pattern: "/packs", screen: packs },
  { pattern: "/settings", screen: settings },
  { pattern: "/help", screen: help },
  { pattern: "/onboarding", screen: onboarding },
];

export const HOME = "#/home";

let container = null;
let depth = 0;               // сколько наших переходов лежит в истории браузера
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
  if (replace) location.replace(target);
  else { depth++; location.hash = target; }
}

export function back() {
  if (depth > 0) { depth--; window.history.back(); }
  else navigate(HOME, { replace: true });
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
    const { route, params } = match;
    const ctx = { params, navigate, back, refresh, setTitle };
    const node = await route.screen.render(ctx);
    clear(container).append(node);
    setTitle(typeof route.screen.title === "function"
      ? route.screen.title(params) : route.screen.title || "VOCAB");
    document.getElementById("back").hidden = !canGoBack();
    document.getElementById("help-link").hidden = location.hash === "#/help";
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

function setTitle(text) {
  document.getElementById("title").textContent = text;
}

export function start(node) {
  container = node;
  window.addEventListener("hashchange", render);
  document.getElementById("back").addEventListener("click", back);
  document.getElementById("help-link").addEventListener("click", () => navigate("#/help"));
  if (!location.hash) location.replace(HOME);
  return render();
}
