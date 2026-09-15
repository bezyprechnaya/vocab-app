/* IndexedDB и настройки.

   Контент (`items`) и прогресс (`progress`) лежат в разных сторах: удаление
   или переустановка пакета не стирает выученное. Имя и схема базы прежние —
   старые копии данных и пакеты читаются как есть. */

import { CONFIG } from "./config.js";

export const STORES = ["items", "progress", "sessions", "packs", "settings"];
export const itemKey = (en, pos) => `${en}|${pos}`;
export const dayKey = (date, kind) => `${date}|${kind}`;
export const packKey = (lang, level) => `${lang}|${level}`;

let conn = null;

export function open() {
  return conn ||= new Promise((ok, fail) => {
    const r = indexedDB.open("vocab", 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore("items", { keyPath: "id" }).createIndex("kind_level", ["kind", "level"]);
      db.createObjectStore("progress", { keyPath: "id" }).createIndex("status", "status");
      db.createObjectStore("sessions", { keyPath: "id" }).createIndex("date", "date");
      db.createObjectStore("packs", { keyPath: "id" });
      db.createObjectStore("settings", { keyPath: "id" });
    };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); conn = null; }; ok(r.result); };
    r.onerror = () => fail(r.error);
    r.onblocked = () => fail(new Error("База открыта в другой вкладке — закройте её"));
  });
}

export const req = (r) => new Promise((ok, fail) => {
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});

/** Транзакция на несколько сторов; fn получает { store: objectStore }. */
export async function tx(names, mode, fn) {
  const db = await open();
  const t = db.transaction(names, mode);
  const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)]));
  const out = await fn(stores);
  return new Promise((ok, fail) => {
    t.oncomplete = () => ok(out);
    t.onerror = t.onabort = () => fail(t.error || new Error("Транзакция отменена"));
  });
}

export const get = (store, key) => tx([store], "readonly", (s) => req(s[store].get(key)));
export const put = (store, value) => tx([store], "readwrite", (s) => req(s[store].put(value)));
export const del = (store, key) => tx([store], "readwrite", (s) => req(s[store].delete(key)));
export const clear = (store) => tx([store], "readwrite", (s) => req(s[store].clear()));
export const count = (store) => tx([store], "readonly", (s) => req(s[store].count()));

/** getAll по стору или по его индексу: all("items", "kind_level", ["words", "b1"]). */
export const all = (store, index, query) =>
  tx([store], "readonly", (s) => req((index ? s[store].index(index) : s[store]).getAll(query)));

export const keysOf = (store, index, query) =>
  tx([store], "readonly", (s) => req(s[store].index(index).getAllKeys(query)));

export function destroy() {
  conn = null;
  return new Promise((ok) => {
    const r = indexedDB.deleteDatabase("vocab");
    r.onsuccess = r.onerror = r.onblocked = () => ok();
  });
}

/* ── Настройки: одна запись «app» ───────────────────────────────────── */

let cache = null;

export async function settings() {
  if (cache) return cache;
  const saved = await get("settings", "app") || {};
  // Старые настройки хранили размеры дня двумя полями — переносим при чтении.
  const legacy = saved.wordsPerDay ? { words: saved.wordsPerDay, phrasal: saved.phrasalPerDay } : {};
  const per = { ...CONFIG.defaults.per, ...legacy, ...saved.per };
  return cache = { ...CONFIG.defaults, ...saved, per, id: "app" };
}

export async function patch(changes) {
  cache = { ...await settings(), ...changes, id: "app" };
  await put("settings", cache);
  return cache;
}

export const forgetSettings = () => { cache = null; };
