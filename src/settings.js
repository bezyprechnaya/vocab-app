/* Настройки приложения — одна запись `app` в сторе settings. */

import * as db from "./db.js";

const DEFAULTS = {
  id: "app",
  study: "en",         // язык, который изучаем: лицевая сторона карточки
  lang: "ru",          // язык перевода: оборот карточки
  level: "b1",         // активный уровень слов
  onboarded: false,    // онбординг пройден
  theme: "auto",       // auto — как в системе, иначе light или dark
  wordsPerDay: 10,
  phrasalPerDay: 5,
};

/** Размеры дня. Больше — не быстрее: набор надо не только разобрать, но и
    вспомнить на проверке, поэтому раздутый день закрывается через раз,
    а невыученное каждый вечер возвращается в пул. Отсюда и потолок суммы. */
export const WORD_SIZES = [5, 7, 10, 12];
export const PHRASAL_SIZES = [3, 5, 7];
export const RECOMMENDED_TOTAL = 15;

export const THEMES = [
  { value: "auto", label: "Как в системе" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
];

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

/** Сколько записей в сумме приходится на день — слова и фразовые глаголы вместе. */
export function dayTotal(settings) {
  return settings.wordsPerDay + settings.phrasalPerDay;
}
