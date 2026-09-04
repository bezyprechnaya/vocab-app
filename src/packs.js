/* Каталог пакетов, загрузка, установка и удаление (глава I, 3.2).

   Пакет — один файл `packs/<lang>/<level>.json`: один язык + один уровень.
   Установка = разбор файла и запись в сторы `items` и `packs` одной транзакцией.
   После этого сеть не нужна никогда: приложение работает из IndexedDB.

   Пути только относительные — приложение живёт и в корне, и в подпапке
   (`/vocab-app/` на GitHub Pages). */

import * as db from "./db.js";
import * as settingsStore from "./settings.js";
import * as translate from "./translate.js";

export const SCHEMA = 1;
export const LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"];

export const LANG_NAMES = {
  en: "Английский", ru: "Русский", es: "Испанский",
  de: "Немецкий", fr: "Французский",
};

/** Языки первой очереди — порядок в обоих списках выбора. Готовых файлов
    для всех тут нет и не нужно: недостающий язык собирается на месте. */
export const LANGS = ["en", "ru", "es", "de", "fr"];

export const LEVEL_NAMES = {
  a1: "A1 · начальный", a2: "A2 · базовый", b1: "B1 · средний",
  b2: "B2 · выше среднего", c1: "C1 · продвинутый", c2: "C2 · владение",
  phrasal: "Фразовые глаголы",
};

/** Короткая подсказка «про меня ли этот уровень» — для выбора на знакомстве. */
export const LEVEL_HINTS = {
  a1: "Первые слова: приветствия, числа, простые вещи вокруг.",
  a2: "Быт и простые темы: работа, покупки, дорога, семья.",
  b1: "Разговор без словаря на знакомые темы, новости в общих чертах.",
  b2: "Свободное общение, фильмы и статьи почти без пропусков.",
  c1: "Сложные тексты и оттенки смысла, профессиональная речь.",
  c2: "Редкие и книжные слова, уровень носителя.",
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

/** Есть ли такой пакет в каталоге. */
export async function entryFor(lang, level) {
  const list = await catalog();
  return list.find((p) => p.lang === lang && p.level === level) || null;
}

/** Пакет под язык и уровень должен лежать в базе. Нет — ставим прямо сейчас.
    `ready` — уже стоял, `installed` — только что поставили, `missing` — такого
    пакета в каталоге нет. */
export async function ensureFor(lang, level, onProgress) {
  const have = await db.get("packs", db.packKey(lang, level));
  if (have) return { status: "ready", level };
  const entry = await entryFor(lang, level);
  if (!entry) return { status: "missing", level };
  await install(entry, onProgress);
  return { status: "installed", level, entry };
}

/** Слова уровня должны лежать в базе хоть на каком-то языке: из них берутся
    английские слова и примеры для сборки. Ничего нет — ставим самый полный
    готовый пакет этого уровня, каким бы ни был его язык. */
async function ensureSource(kind, level, onProgress) {
  const keys = await db.indexKeys("items", "kind_level", [kind, level]);
  if (keys.length) return keys.length;
  const list = await catalog();
  const best = list.filter((p) => p.level === level)
    .sort((a, b) => b.count - a.count)[0];
  if (!best) throw new Error(`слов уровня ${level.toUpperCase()} нет ни в одном пакете`);
  await install(best, onProgress);
  return (await db.indexKeys("items", "kind_level", [kind, level])).length;
}

/** Сборка пакета прямо в приложении, без готового файла в каталоге.

    Слово и пример уже есть по-английски — недостающий язык это их перевод.
    Перевод машинный, поэтому все записи помечаются `mt`: в карточке видно
    и пометку, и пример, по которому смысл проверяется. */
export async function buildLocal(lang, level, { onProgress = () => {}, signal } = {}) {
  const kind = level === "phrasal" ? "phrasal" : "words";
  onProgress(0.02, "Готовим слова…");
  await ensureSource(kind, level, (value) => onProgress(0.02 + value * 0.08, "Готовим слова…"));

  const items = await db.indexAll("items", "kind_level", [kind, level]);
  if (!items.length) throw new Error("для этого уровня нет слов");

  const texts = [];
  for (const item of items) {
    texts.push(item.en);
    if (item.exEn) texts.push(item.exEn);
  }

  const dictionary = await translate.many(texts, lang, {
    signal,
    onProgress: (value, ready, total) =>
      onProgress(0.1 + value * 0.85, `Перевод: ${ready} из ${total} строк`),
  });
  if (!dictionary.size) throw new Error("переводчик не ответил ни на одну строку");

  onProgress(0.97, "Записываем пакет…");
  let count = 0;
  await db.transact(["items", "packs"], "readwrite", (s) => {
    for (const item of items) {
      const tr = dictionary.get(item.en);
      if (!tr) continue;
      item.tr = { ...item.tr, [lang]: tr };
      item.exTr = { ...item.exTr, [lang]: item.exEn ? dictionary.get(item.exEn) || "" : "" };
      item.src = { ...item.src, [lang]: "mt" };
      s.items.put(item);
      count++;
    }
    s.packs.put({
      id: db.packKey(lang, level),
      lang, level, kind, count, bytes: 0,
      builtAt: new Date().toISOString().slice(0, 10),
      installedAt: new Date().toISOString().slice(0, 10),
      origin: "local",
    });
  });
  onProgress(1, "Готово");
  return { count, total: items.length };
}

/** Языки, пакеты которых должны лежать в базе для выбранной пары.

    Язык перевода нужен всегда — без него нечего показать на обороте. Язык
    изучения нужен, только если он не английский: английское слово и пример
    есть в любой записи, а вот английское толкование живёт в пакете `en`. */
export function needed(settings) {
  return [...new Set([settings.lang, ...(settings.study === "en" ? [] : [settings.study])])];
}

/** Английская сторона мягкая: готового файла может не быть, и тогда на обороте
    окажется само слово. Собирать такой пакет незачем — это был бы перевод
    английского на английский. */
export function optional(lang) {
  return lang === "en";
}

/** Смена языков или уровня — одно действие: настройка записана, нужные пакеты
    докачаны. Иначе выбор ничего не меняет, пока человек не сходит за пакетом сам. */
export async function apply(changes, onProgress = () => {}) {
  const settings = await settingsStore.patch(changes);
  const added = [], missing = [];
  for (const lang of needed(settings)) {
    for (const level of [settings.level, "phrasal"]) {
      const result = await ensureFor(lang, level, onProgress);
      if (result.status === "installed") added.push({ lang, level });
      else if (result.status === "missing" && !optional(lang)) missing.push({ lang, level });
    }
  }
  return { settings, added, missing };
}

/** Первый запуск: ставим пакеты, лежащие в репозитории, — приложению есть что показать. */
export async function ensureStarter() {
  const have = await installed();
  if (have.size) return [];
  const settings = await settingsStore.get();
  const list = await catalog();
  const langs = needed(settings);
  const starters = list.filter((p) => langs.includes(p.lang)
    && (p.level === settings.level || p.level === "phrasal"));
  for (const entry of starters) await install(entry);
  return starters;
}

export function online() {
  return navigator.onLine !== false;
}
