/* Точка входа: открыть базу, поставить стартовые пакеты, показать первый экран. */

import * as db from "./db.js";
import * as nav from "./nav.js";
import * as packsStore from "./packs.js";
import * as settingsStore from "./settings.js";
import { el, toast } from "./ui.js";

async function boot() {
  const root = document.getElementById("app");
  root.append(el("p.muted.center", {}, "Открываем базу…"));

  try {
    await db.open();
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
    const starters = await packsStore.ensureStarter();
    if (starters.length) toast(`Установлены стартовые пакеты: ${starters.length}`);
  } catch (error) {
    console.warn("стартовые пакеты не установились:", error);
  }

  const settings = await settingsStore.get();
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
