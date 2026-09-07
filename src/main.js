/* Точка входа: открыть базу, поставить стартовые пакеты, показать первый экран. */

import * as db from "./db.js";
import * as nav from "./nav.js";
import * as packsStore from "./packs.js";
import * as settingsStore from "./settings.js";
import { el, toast, applyTheme } from "./ui.js";

/** Стартовый экран: строка состояния и полоса. Первый запуск ставит пакеты
    из папки `packs/`, а это секунды записи в базу — без полосы экран выглядел бы
    зависшим. Полоса живёт до первого экрана и уходит вместе с ним. */
function bootScreen(root) {
  const fill = el("div.bar__fill", { style: "width:0%" });
  const note = el("p.muted.center", {}, "Открываем базу…");
  root.append(el("div.card", {}, note, el("div.bar", {}, fill)));
  return (value, message) => {
    fill.style.width = `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`;
    if (message) note.textContent = message;
  };
}

async function boot() {
  const root = document.getElementById("app");
  const step = bootScreen(root);

  try {
    await db.open();
    step(0.05);
  } catch (error) {
    root.textContent = "";
    root.append(el("div.card", {},
      el("h2", {}, "Нет доступа к хранилищу"),
      el("p.muted", {}, "Прогресс хранится в IndexedDB браузера. В приватном окне "
        + "или при запрете хранения данных приложение работать не может."),
      el("p.muted", {}, String(error.message || error))));
    return;
  }

  try {
    const starters = await packsStore.ensureStarter((value, label) =>
      step(0.05 + value * 0.95, label ? `Ставим пакет: ${label}` : undefined));
    step(1);
    if (starters.length) toast(`Установлены стартовые пакеты: ${starters.length}`);
  } catch (error) {
    console.warn("стартовые пакеты не установились:", error);
  }

  const settings = await settingsStore.get();
  applyTheme(settings.theme);
  if (!settings.onboarded && !location.hash.startsWith("#/help")) {
    location.replace("#/onboarding");
  }

  await nav.start(root);
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (location.protocol === "http:" && location.hostname !== "localhost") return;
  // Путь относительный: область действия сама станет папкой приложения —
  // и в корне, и в подпапке вида /vocab-app/ на GitHub Pages.
  navigator.serviceWorker.register(new URL("../sw.js", import.meta.url))
    .catch((error) => console.warn("service worker не зарегистрирован:", error));
}

boot();
