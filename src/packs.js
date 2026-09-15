/* Пакеты: каталог, установка, удаление, сборка недостающего языка переводом
   и копия базы.

   Пакет — файл `packs/<язык>/<уровень>.json`: один язык, один уровень. После
   установки он лежит в IndexedDB, и сеть больше не нужна. Пути относительные:
   приложение живёт и в корне, и в подпапке. */

import { kindOf, langName, levelName } from "./config.js";
import { STORES, all, forgetSettings, get, itemKey, packKey, patch, req, settings, tx } from "./store.js";
import { todayISO } from "./core.js";

const SCHEMA = 1;
const url = (path) => new URL(`../packs/${path}`, import.meta.url);

let catalogCache = null;

export async function catalog() {
  if (catalogCache) return catalogCache;
  const response = await fetch(url("index.json"), { cache: "no-cache" });
  if (!response.ok) throw new Error(`каталог пакетов недоступен (${response.status})`);
  const data = await response.json();
  if (data.schema !== SCHEMA) throw new Error("каталог пакетов другой версии");
  return catalogCache = data.packs || [];
}

export const installed = async () => new Map((await all("packs")).map((p) => [p.id, p]));
export const online = () => navigator.onLine !== false;
export const entryFor = async (lang, level) =>
  (await catalog()).find((p) => p.lang === lang && p.level === level) || null;

/** Языки, пакеты которых нужны выбранной паре: перевод нужен всегда, язык
    изучения — только если он не английский (английское слово есть в любой записи). */
export const needed = ({ study, lang }) => [...new Set([lang, ...(study === "en" ? [] : [study])])];

/** У английского оборота готового файла может не быть — тогда на обороте
    окажется само слово. Собирать такой пакет незачем. */
export const optional = (lang) => lang === "en";

export function validate(pack) {
  if (!pack || typeof pack !== "object") throw new Error("файл не похож на пакет");
  if (pack.schema !== SCHEMA) throw new Error(`версия пакета ${pack.schema}, нужна ${SCHEMA}`);
  if (!pack.lang || !pack.level) throw new Error("в пакете нет языка или уровня");
  if (!Array.isArray(pack.items) || !pack.items.length) throw new Error("пакет пустой");
  return pack;
}

/** Запись пакета в базу. Прогресс не трогаем — он в своём сторе.
    Все записи читаются одним `getAll`, поэтому установка идёт одним проходом. */
export async function write(pack, bytes = 0, onProgress = () => {}) {
  validate(pack);
  const kind = pack.kind || kindOf(pack.level);
  const total = pack.items.length;
  await tx(["items", "packs"], "readwrite", async (stores) => {
    const known = new Map((await req(stores.items.getAll())).map((item) => [item.id, item]));
    pack.items.forEach(([en, pos, tr, exEn = "", exTr = "", origin = "mt"], n) => {
      const base = known.get(itemKey(en, pos)) || { id: itemKey(en, pos), en, pos, tr: {}, exTr: {}, src: {}, exEn: "" };
      stores.items.put({
        ...base, level: pack.level, kind,
        tr: { ...base.tr, [pack.lang]: tr },
        exTr: { ...base.exTr, [pack.lang]: exTr },
        src: { ...base.src, [pack.lang]: origin },
        exEn: exEn || base.exEn,
      });
      if (n % 50 === 0) onProgress(n / total);
    });
    stores.packs.put({
      id: packKey(pack.lang, pack.level), lang: pack.lang, level: pack.level, kind,
      count: total, bytes, builtAt: pack.builtAt || "", installedAt: todayISO(),
      ...(pack.origin ? { origin: pack.origin } : {}),
    });
  });
  onProgress(1);
}

/** Скачать и установить. Долгая часть — не скачивание, а запись, поэтому файл
    занимает первую десятую полосы, остальное двигает сама запись. */
export async function install(entry, onProgress = () => {}) {
  onProgress(0.05);
  const response = await fetch(url(entry.path), { cache: "no-cache" });
  if (!response.ok) throw new Error(`не удалось скачать пакет (${response.status})`);
  const pack = validate(await response.json());
  await write(pack, entry.bytes, (value) => onProgress(0.1 + value * 0.9));
  return pack;
}

/** Удаление: контент уходит, прогресс остаётся выученным. */
export async function uninstall(lang, level) {
  const record = await get("packs", packKey(lang, level));
  const kind = record?.kind || kindOf(level);
  await tx(["items", "packs"], "readwrite", async (stores) => {
    for (const item of await req(stores.items.index("kind_level").getAll([kind, level]))) {
      delete item.tr[lang]; delete item.exTr[lang]; delete item.src[lang];
      if (Object.keys(item.tr).length) stores.items.put(item);
      else stores.items.delete(item.id);
    }
    stores.packs.delete(packKey(lang, level));
  });
}

/** Пакет должен лежать в базе; нет — ставим сейчас. */
async function ensure(lang, level, onProgress) {
  if (await get("packs", packKey(lang, level))) return "ready";
  const entry = await entryFor(lang, level);
  if (!entry) return "missing";
  await install(entry, onProgress);
  return "installed";
}

/** Выбор языка или уровня — законченное действие: настройка записана, нужные
    пакеты докачаны. `missing` — то, чего в каталоге нет: это собирается на месте. */
export async function apply(changes, onProgress = () => {}) {
  const config = await patch(changes);
  const added = [], missing = [];
  for (const lang of needed(config)) {
    for (const level of [config.level, "phrasal"]) {
      const status = await ensure(lang, level, onProgress);
      if (status === "installed") added.push({ lang, level });
      else if (status === "missing" && !optional(lang)) missing.push({ lang, level });
    }
  }
  return { config, added, missing };
}

/** Первый запуск: ставим пакеты, лежащие в репозитории. Доля считается по числу
    записей — делить полосу поровну значило бы врать про остаток. */
export async function ensureStarter(onProgress = () => {}) {
  if ((await installed()).size) return [];
  const config = await settings();
  const langs = needed(config);
  const starters = (await catalog()).filter((p) => langs.includes(p.lang)
    && (p.level === config.level || p.level === "phrasal"));
  const total = starters.reduce((sum, p) => sum + (p.count || 1), 0) || 1;
  let done = 0;
  for (const entry of starters) {
    const label = `${langName(entry.lang)} · ${levelName(entry.level)}`;
    await install(entry, (value) => onProgress((done + value * (entry.count || 1)) / total, label));
    done += entry.count || 1;
  }
  return starters;
}

/* ── Перевод: сборка пакета прямо в приложении ──────────────────────────
   Слова и примеры уровня уже лежат в базе по-английски, поэтому недостающий
   язык — это их перевод. Строки уходят пачками; пачка, вернувшаяся не тем
   числом строк, переводится построчно, безнадёжная строка остаётся пустой. */

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";

async function ask(text, lang, signal) {
  for (let attempt = 0, wait = 700; ; attempt++, wait *= 2) {
    try {
      const params = new URLSearchParams({ client: "gtx", sl: "en", tl: lang, dt: "t", q: text });
      const response = await fetch(`${ENDPOINT}?${params}`, { signal });
      if (!response.ok) throw new Error(`переводчик ответил ${response.status}`);
      return ((await response.json())[0] || []).map((part) => part[0] || "").join("");
    } catch (error) {
      if (error.name === "AbortError" || attempt >= 3) throw error;
      await new Promise((ok) => setTimeout(ok, wait));
    }
  }
}

export async function translate(texts, lang, { onProgress = () => {}, signal } = {}) {
  const unique = [...new Set(texts.filter(Boolean))];
  const batches = [];
  for (const text of unique) {
    const last = batches.at(-1);
    if (!last || last.chars + text.length > 900 || last.lines.length >= 20) batches.push({ lines: [text], chars: text.length });
    else { last.lines.push(text); last.chars += text.length + 1; }
  }

  const queue = [...batches], out = new Map();
  let done = 0;

  const worker = async () => {
    for (let batch; (batch = queue.shift());) {
      const { lines } = batch;
      let parts = [];
      try {
        parts = (await ask(lines.join("\n"), lang, signal)).split("\n");
      } catch (error) {
        if (error.name === "AbortError") throw error;
      }
      if (parts.length !== lines.length) {               // пачка не сошлась — по одной
        parts = [];
        for (const line of lines) {
          try { parts.push(await ask(line, lang, signal)); } catch (error) {
            if (error.name === "AbortError") throw error;
            parts.push("");
          }
        }
      }
      // Совпадение с оригиналом не выбрасываем: «hotel» и по-испански «hotel».
      lines.forEach((line, i) => { if (parts[i]?.trim()) out.set(line, parts[i].trim()); });
      onProgress(++done / batches.length, out.size, unique.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker));
  return out;
}

/** Сборка пакета для языка, которого нет в каталоге. Перевод машинный, поэтому
    все записи помечаются `mt`: в карточке видно и пометку, и пример. */
export async function build(lang, level, { onProgress = () => {}, signal } = {}) {
  const kind = kindOf(level);
  onProgress(0.02, "Готовим слова…");

  // Слова уровня должны лежать в базе хоть на каком-то языке: из них берутся
  // английские строки для перевода.
  if (!(await all("items", "kind_level", [kind, level])).length) {
    const best = (await catalog()).filter((p) => p.level === level).sort((a, b) => b.count - a.count)[0];
    if (!best) throw new Error(`слов уровня ${levelName(level)} нет ни в одном пакете`);
    await install(best, (value) => onProgress(0.02 + value * 0.08, "Готовим слова…"));
  }

  const items = await all("items", "kind_level", [kind, level]);
  const texts = items.flatMap((item) => [item.en, item.exEn].filter(Boolean));
  const dictionary = await translate(texts, lang, {
    signal,
    onProgress: (value, ready, total) => onProgress(0.1 + value * 0.85, `Перевод: ${ready} из ${total} строк`),
  });
  if (!dictionary.size) throw new Error("переводчик не ответил ни на одну строку");

  onProgress(0.97, "Записываем пакет…");
  let count = 0;
  await tx(["items", "packs"], "readwrite", (stores) => {
    for (const item of items) {
      const tr = dictionary.get(item.en);
      if (!tr) continue;
      stores.items.put({
        ...item,
        tr: { ...item.tr, [lang]: tr },
        exTr: { ...item.exTr, [lang]: item.exEn ? dictionary.get(item.exEn) || "" : "" },
        src: { ...item.src, [lang]: "mt" },
      });
      count++;
    }
    stores.packs.put({
      id: packKey(lang, level), lang, level, kind, count, bytes: 0,
      builtAt: todayISO(), installedAt: todayISO(), origin: "local",
    });
  });
  onProgress(1, "Готово");
  return count;
}

/* ── Копия базы ─────────────────────────────────────────────────────── */

const RANK = { new: 0, learning: 1, learned: 2 };

export async function exportAll() {
  const [items, progress, sessions, packs, settingsRows] = await Promise.all(STORES.map((s) => all(s)));
  return { schema: SCHEMA, kind: "backup", exportedAt: new Date().toISOString(), items, progress, sessions, packs, settings: settingsRows };
}

export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("это не JSON"); }
  if (Array.isArray(data?.items?.[0])) return { type: "pack", data: validate(data) };
  if (data?.schema !== SCHEMA || !Array.isArray(data?.items)) throw new Error("файл не похож на копию базы или пакет");
  return { type: "backup", data };
}

/** Объединение: побеждает более продвинутый статус, закрытый день не затирается. */
export async function merge(data) {
  await tx(STORES, "readwrite", async (stores) => {
    for (const item of data.items || []) {
      const old = await req(stores.items.get(item.id));
      stores.items.put(old ? { ...old, ...item, tr: { ...old.tr, ...item.tr }, exTr: { ...old.exTr, ...item.exTr }, src: { ...old.src, ...item.src } } : item);
    }
    for (const row of data.progress || []) {
      const old = await req(stores.progress.get(row.id));
      if (!old || (RANK[row.status] ?? 0) > (RANK[old.status] ?? 0)) {
        stores.progress.put({ ...old, ...row, reviews: Math.max(old?.reviews || 0, row.reviews || 0) });
      }
    }
    for (const row of data.sessions || []) {
      const old = await req(stores.sessions.get(row.id));
      if (!old || (old.stage || old.phase) !== "done") stores.sessions.put(row);
    }
    for (const row of data.packs || []) stores.packs.put(row);
  });
  forgetSettings();
}

export async function replaceAll(data) {
  await tx(STORES, "readwrite", (stores) => {
    for (const name of STORES) stores[name].clear();
    for (const name of ["items", "progress", "sessions", "packs", "settings"]) {
      for (const row of data[name] || []) stores[name].put(row);
    }
  });
  forgetSettings();
}
