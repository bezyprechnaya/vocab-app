/* IndexedDB, схема 1 (глава I, 2.2).

   Контент и прогресс лежат в разных сторах: удаление или переустановка пакета
   сносит записи из `items`, но не трогает `progress` — выученное остаётся выученным.

   Сторы:
     items     ключ `en|pos`  — контент: en, pos, level, kind, tr{lang}, exEn, exTr{lang}, src{lang}
     progress  ключ `en|pos`  — прогресс: status, firstShown, learnedAt, reviews
     sessions  ключ `date|kind` — день: набор, этап, что пройдено
     packs     ключ `lang|level` — что установлено, когда, сколько записей
     settings  ключ "app"     — активный язык и уровень, флаг онбординга
*/

export const DB_NAME = "vocab";
export const DB_VERSION = 1;
export const STORES = ["items", "progress", "sessions", "packs", "settings"];

export const itemKey = (en, pos) => `${en}|${pos}`;
export const sessionKey = (date, kind) => `${date}|${kind}`;
export const packKey = (lang, level) => `${lang}|${level}`;

export function parseItemKey(key) {
  const i = key.lastIndexOf("|");
  return { en: key.slice(0, i), pos: key.slice(i + 1) };
}

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;

      const items = db.createObjectStore("items", { keyPath: "id" });
      items.createIndex("kind_level", ["kind", "level"]);
      items.createIndex("kind", "kind");

      const progress = db.createObjectStore("progress", { keyPath: "id" });
      progress.createIndex("status", "status");

      const sessions = db.createObjectStore("sessions", { keyPath: "id" });
      sessions.createIndex("date", "date");

      db.createObjectStore("packs", { keyPath: "id" });
      db.createObjectStore("settings", { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("База открыта в другой вкладке — закройте её"));
  });
  return dbPromise;
}

export function forget() { dbPromise = null; }

export function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Транзакция на несколько сторов; fn получает объект {store: objectStore}. */
export async function transact(names, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    const stores = {};
    for (const name of names) stores[name] = tx.objectStore(name);
    let result;
    Promise.resolve(fn(stores, tx)).then((value) => { result = value; }, reject);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Транзакция отменена"));
  });
}

export async function get(store, key) {
  return transact([store], "readonly", (s) => request(s[store].get(key)));
}

export async function getAll(store, query, count) {
  return transact([store], "readonly", (s) => request(s[store].getAll(query, count)));
}

export async function getAllKeys(store, query) {
  return transact([store], "readonly", (s) => request(s[store].getAllKeys(query)));
}

export async function put(store, value) {
  return transact([store], "readwrite", (s) => request(s[store].put(value)));
}

export async function putAll(store, values) {
  return transact([store], "readwrite", (s) => {
    for (const value of values) s[store].put(value);
  });
}

export async function remove(store, key) {
  return transact([store], "readwrite", (s) => request(s[store].delete(key)));
}

export async function clear(store) {
  return transact([store], "readwrite", (s) => request(s[store].clear()));
}

export async function count(store) {
  return transact([store], "readonly", (s) => request(s[store].count()));
}

export async function indexAll(store, index, query) {
  return transact([store], "readonly", (s) => request(s[store].index(index).getAll(query)));
}

export async function indexKeys(store, index, query) {
  return transact([store], "readonly", (s) => request(s[store].index(index).getAllKeys(query)));
}

export async function indexCount(store, index, query) {
  return transact([store], "readonly", (s) => request(s[store].index(index).count(query)));
}

/** Полное удаление базы — «полный сброс» из настроек (3.6). */
export function destroy() {
  forget();
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();   // закроется, когда отпустят другие вкладки
  });
}
