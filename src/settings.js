/* Настройки приложения — одна запись `app` в сторе settings. */

import * as db from "./db.js";

const DEFAULTS = {
  id: "app",
  study: "en",         // язык, который изучаем: лицевая сторона карточки
  lang: "ru",          // язык перевода: оборот карточки
  level: "b1",         // активный уровень слов
  onboarded: false,    // онбординг пройден
  wordsPerDay: 10,
  phrasalPerDay: 5,
};

let cache = null;

export async function get() {
  if (cache) return cache;
  const saved = await db.get("settings", "app");
  cache = { ...DEFAULTS, ...(saved || {}) };
  return cache;
}

export async function patch(changes) {
  const current = await get();
  cache = { ...current, ...changes, id: "app" };
  await db.put("settings", cache);
  return cache;
}

export function forget() { cache = null; }

export function perDay(settings, kind) {
  return kind === "phrasal" ? settings.phrasalPerDay : settings.wordsPerDay;
}
