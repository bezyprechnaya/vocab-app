/* Каталог пакетов, загрузка, установка и удаление (глава I, 3.2).

   Пакет — один файл `packs/<lang>/<level>.json`: один язык + один уровень.
   Установка = разбор файла и запись в сторы `items` и `packs` одной транзакцией.
   После этого сеть не нужна никогда: приложение работает из IndexedDB.

   Пути только относительные — приложение живёт и в корне, и в подпапке
   (`/vocab-app/` на GitHub Pages). */

import * as db from "./db.js";

export const SCHEMA = 1;
export const LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"];

export const LANG_NAMES = {
  ru: "Русский", es: "Испанский", de: "Немецкий", fr: "Французский",
  en: "English → English",
};

export const LEVEL_NAMES = {
  a1: "A1 · начальный", a2: "A2 · базовый", b1: "B1 · средний",
  b2: "B2 · выше среднего", c1: "C1 · продвинутый", c2: "C2 · владение",
  phrasal: "Фразовые глаголы",
};

const CATALOG_URL = new URL("../packs/index.json", import.meta.url);
const packUrl = (path) => new URL(`../packs/${path}`, import.meta.url);

let catalogCache = null;

export async function catalog() {
  if (catalogCache) return catalogCache;
  const response = await fetch(CATALOG_URL, { cache: "no-cache" });
  if (!response.ok) throw new Error(`каталог пакетов недоступен (${response.status})`);
  const data = await response.json();
  if (data.schema !== SCHEMA) throw new Error("каталог пакетов другой версии");
  catalogCache = data.packs || [];
  return catalogCache;
}

export async function installed() {
  const rows = await db.getAll("packs");
  const out = new Map();
  for (const row of rows) out.set(row.id, row);
  return out;
}

export function levelLabel(level) {
  return LEVEL_NAMES[level] || level.toUpperCase();
}

/** Проверка формы пакета до записи в базу: кривой файл не должен попасть в сторы. */
export function validate(pack) {
  if (!pack || typeof pack !== "object") throw new Error("файл не похож на пакет");
  if (pack.schema !== SCHEMA) throw new Error(`версия пакета ${pack.schema}, нужна ${SCHEMA}`);
  if (!pack.lang || !pack.level) throw new Error("в пакете нет языка или уровня");
  if (!Array.isArray(pack.items) || !pack.items.length) throw new Error("пакет пустой");
  for (const row of pack.items) {
    if (!Array.isArray(row) || row.length < 3 || !row[0] || !row[1] || !row[2]) {
      throw new Error(`запись повреждена: ${JSON.stringify(row).slice(0, 60)}`);
    }
  }
  return pack;
}

/** Пакет → записи стора items. Переводы разных языков сливаются в одну запись. */
function toItem(existing, row, pack) {
  const [en, pos, tr, exEn = "", exTr = "", origin = "mt"] = row;
  const item = existing || {
    id: db.itemKey(en, pos), en, pos,
    level: pack.level, kind: pack.kind || "words",
    tr: {}, exEn: "", exTr: {}, src: {},
  };
  item.level = pack.level;
  item.kind = pack.kind || "words";
  item.tr = { ...item.tr, [pack.lang]: tr };
  item.exTr = { ...item.exTr, [pack.lang]: exTr };
  item.src = { ...item.src, [pack.lang]: origin };
  if (exEn) item.exEn = exEn;
  return item;
}

/** Скачать и установить пакет. onProgress(0…1) — для полосы загрузки. */
export async function install(entry, onProgress = () => {}) {
  onProgress(0.05);
  const response = await fetch(packUrl(entry.path), { cache: "no-cache" });
  if (!response.ok) throw new Error(`не удалось скачать пакет (${response.status})`);
  const pack = validate(await response.json());
  onProgress(0.5);
  await write(pack, entry.bytes);
  onProgress(1);
  return pack;
}

/** Запись разобранного пакета в базу. Прогресс не трогаем — он в своём сторе. */
export async function write(pack, bytes = 0) {
  validate(pack);
  await db.transact(["items", "packs"], "readwrite", async (s) => {
    for (const row of pack.items) {
      const id = db.itemKey(row[0], row[1]);
      const existing = await db.request(s.items.get(id));
      s.items.put(toItem(existing, row, pack));
    }
    s.packs.put({
      id: db.packKey(pack.lang, pack.level),
      lang: pack.lang,
      level: pack.level,
      kind: pack.kind || "words",
      count: pack.items.length,
      bytes,
      builtAt: pack.builtAt || "",
      installedAt: new Date().toISOString().slice(0, 10),
    });
  });
}

/** Удаление пакета: контент уходит, прогресс остаётся (глава I, 2.2 и 3.6). */
export async function uninstall(lang, level) {
  const key = db.packKey(lang, level);
  const record = await db.get("packs", key);
  const kind = record?.kind || (level === "phrasal" ? "phrasal" : "words");
  await db.transact(["items", "packs"], "readwrite", async (s) => {
    const items = await db.request(s.items.index("kind_level").getAll([kind, level]));
    for (const item of items) {
      delete item.tr[lang];
      delete item.exTr[lang];
      delete item.src[lang];
      if (Object.keys(item.tr).length === 0) s.items.delete(item.id);
      else s.items.put(item);
    }
    s.packs.delete(key);
  });
}

/** Первый запуск: ставим пакеты, лежащие в репозитории, — приложению есть что показать. */
export async function ensureStarter() {
  const have = await installed();
  if (have.size) return [];
  const list = await catalog();
  const starters = list.filter((p) => p.lang === "ru" && (p.level === "b1" || p.level === "phrasal"));
  for (const entry of starters) await install(entry);
  return starters;
}

export function online() {
  return navigator.onLine !== false;
}
