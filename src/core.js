/* Логика: стороны карточки, прогресс, движок дня. Ни DOM, ни HTML. */

import { CONFIG } from "./config.js";
import { all, dayKey, get, keysOf, put, req, settings, tx } from "./store.js";

/* ── Две стороны карточки ───────────────────────────────────────────────
   Запись всегда лежит по-английски, `tr` — карта переводов по языкам.
   Английский опорный: как язык изучения это само слово, как язык перевода —
   толкование из пакета `en`. */

export const word = (item, lang) => (lang === "en" ? item.en : item.tr?.[lang]) || "";
export const meaning = (item, lang) => (lang === "en" ? item.tr?.en || item.en : item.tr?.[lang]) || "";
export const example = (item, lang) => (lang === "en" ? item.exEn : item.exTr?.[lang]) || "";
export const usable = (item, pair) => !!word(item, pair.study) && !!meaning(item, pair.lang);
export const isMT = (item, { study, lang }) =>
  [study, lang].some((code) => code !== "en" && item.src?.[code] === "mt");

/* ── Даты, числительные, перемешивание ──────────────────────────────── */

export const todayISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const shiftDate = (iso, days) => {
  const [y, m, d] = iso.split("-").map(Number);
  return todayISO(new Date(y, m - 1, d + days));
};

const DAY_MONTH = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long" });
const WITH_YEAR = new Intl.DateTimeFormat("ru", { day: "numeric", month: "long", year: "numeric" });

export function formatDate(iso) {
  const today = todayISO();
  if (iso === today) return "сегодня";
  if (iso === shiftDate(today, -1)) return "вчера";
  const [y, m, d] = iso.split("-").map(Number);
  return (y === new Date().getFullYear() ? DAY_MONTH : WITH_YEAR).format(new Date(y, m - 1, d));
}

const RULES = new Intl.PluralRules("ru");
const FORM = { one: 0, few: 1, many: 2, other: 2 };
export const plural = (n, one, few, many) => `${n} ${[one, few, many][FORM[RULES.select(n)]]}`;

export const formatSize = (bytes) => !bytes ? ""
  : bytes < 1024 ? `${bytes} Б`
  : bytes < 1048576 ? `${Math.round(bytes / 1024)} КБ`
  : `${(bytes / 1048576).toFixed(1)} МБ`;

export function shuffle(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Набор из пула: слово без примера учится хуже, поэтому сначала берутся
    записи с примером — порядок внутри групп остаётся случайным. */
export const pick = (list, size) => {
  const mixed = shuffle(list);
  return [...mixed.filter((i) => i.exEn), ...mixed.filter((i) => !i.exEn)].slice(0, size);
};

/* ── Прогресс ───────────────────────────────────────────────────────────
   `new` — записи в сторе нет, `learning` — взято в работу, `learned` — выучено. */

export const LEARNING = "learning";
export const LEARNED = "learned";

export const mark = (id, status, date) => tx(["progress"], "readwrite", async (s) => {
  const row = await req(s.progress.get(id)) || { id, firstShown: date, reviews: 0 };
  s.progress.put({ ...row, status, firstShown: row.firstShown || date, ...(status === LEARNED ? { learnedAt: date } : {}) });
});

export const touch = (id, date) => tx(["progress"], "readwrite", async (s) => {
  const row = await req(s.progress.get(id)) || { id, status: LEARNING, firstShown: date, reviews: 0 };
  s.progress.put({ ...row, reviews: (row.reviews || 0) + 1 });
});

/** Незакрытый день прошлого оставляет слова в `learning` — возвращаем их в пул.
    Наборы сегодняшних незакрытых дней не трогаем: такой день ещё идёт. */
export async function releaseLearning(today) {
  const rows = await all("progress", "status", LEARNING);
  if (!rows.length) return;
  const busy = new Set((await all("sessions", "date", today))
    .flatMap((day) => day.stage === "done" || day.phase === "done" ? [] : day.set || day.daySet || []));
  await tx(["progress"], "readwrite", (s) => {
    for (const row of rows) if (!busy.has(row.id)) s.progress.delete(row.id);
  });
}

/** Записи вида `kind` на уровне `level`: сколько всего и сколько выучено. */
export async function levelStats(kind, level) {
  const [ids, rows] = await Promise.all([keysOf("items", "kind_level", [kind, level]), all("progress")]);
  const status = new Map(rows.map((r) => [r.id, r.status]));
  const learned = ids.filter((id) => status.get(id) === LEARNED).length;
  return { total: ids.length, learned, left: ids.length - learned };
}

/** Ещё не выученное: из него набирается день. Записи без слова или без перевода
    не берём — карточка с прочерком ничему не учит. */
export async function pool(kind, level, pair) {
  const [items, done] = await Promise.all([
    all("items", "kind_level", [kind, level]),
    all("progress", "status", LEARNED),
  ]);
  const learned = new Set(done.map((r) => r.id));
  return items.filter((item) => !learned.has(item.id) && (!pair || usable(item, pair)));
}

export const totals = async () => ({
  items: (await all("items")).length,
  learned: (await all("progress", "status", LEARNED)).length,
  days: (await all("sessions")).length,
});

/* ── Движок дня ─────────────────────────────────────────────────────────
   Этапы: sort — «знаю / не знаю», знакомое сразу уходит в выученные, а набор
   добирается новым; cards — карточки с переворотом; check — «помнишь перевод?»,
   провалы возвращаются в карточки новым кругом, чистый круг закрывает день. */

/** Сессии старого приложения читаются как свои: поля переименованы. */
const norm = (day) => !day || day.stage ? day : {
  ...day, stage: day.phase, set: day.daySet || [], known: day.knownIds || [],
  queue: { sort: day.sortQueue, cards: day.cardQueue, check: day.checkQueue }[day.phase] || [],
  target: day.checkTarget || [], failed: day.checkFailed || [],
  round: day.cardRoundTotal || 0, done: day.cardsDone || 0,
};

export const loadDay = async (kind, date = todayISO()) => norm(await get("sessions", dayKey(date, kind)));

/** Закрытый день не переписываем: возврат на экран дня не должен его «открыть». */
async function save(day) {
  const old = norm(await get("sessions", day.id));
  if (old?.stage === "done" && day.stage !== "done") return old;
  await put("sessions", day);
  return day;
}

/** Уровень, на котором ещё есть что учить: проверяем именно пул. */
export async function pickLevel(kind, preferred, pair) {
  const { levels } = CONFIG.kinds[kind];
  const order = levels === "*" ? [preferred, ...CONFIG.levels.filter((l) => l !== preferred)] : levels;
  for (const level of order) if (level && (await pool(kind, level, pair)).length) return level;
  return null;
}

/** Сессия дня: существующая или новая. `null` — учить больше нечего. */
export async function startDay(kind, date = todayISO()) {
  const existing = await loadDay(kind, date);
  if (existing) return existing;

  await releaseLearning(date);
  const config = await settings();
  const level = await pickLevel(kind, config.level, config);
  if (!level) return null;

  const size = config.per[kind];
  const ids = pick(await pool(kind, level, config), size).map((item) => item.id);
  return save({
    id: dayKey(date, kind), date, kind, level, size, stage: "sort",
    set: [...ids], queue: shuffle(ids), target: [], failed: [], known: [],
    round: 0, done: 0, shown: null,
  });
}

const toCards = (day, ids) => save(Object.assign(day, {
  stage: "cards", queue: [...ids], target: [...ids], round: ids.length, done: 0, shown: null,
}));

const toCheck = (day, ids) => save(Object.assign(day, {
  stage: "check", queue: [...ids], round: ids.length, failed: [], shown: null,
}));

async function finish(day) {
  for (const id of day.set) await mark(id, LEARNED, day.date);
  return save(Object.assign(day, { stage: "done", shown: null }));
}

/** Добор набора после «знаю»: день должен остаться нужного размера. */
async function refill(day, config) {
  if (day.set.length >= day.size) return;
  const busy = new Set([...day.set, ...day.queue]);
  const [next] = pick((await pool(day.kind, day.level, config)).filter((i) => !busy.has(i.id)), 1);
  if (next) { day.set.push(next.id); day.queue.unshift(next.id); }   // показать следующим
}

/** Единственный вход для ответов: know / skip / ok / repeat / yes / no. */
export async function answer(day, action) {
  const id = day.queue.shift();
  day.shown = null;

  if (day.stage === "sort") {
    if (id && action === "know") {
      await mark(id, LEARNED, day.date);
      day.known.push(id);
      day.set = day.set.filter((x) => x !== id);
      await refill(day, await settings());
    } else if (id) {
      await mark(id, LEARNING, day.date);
    }
    if (day.queue.length) return save(day);
    return day.set.length ? toCards(day, shuffle(day.set)) : finish(day);
  }

  if (day.stage === "cards") {
    if (action === "repeat") {
      if (id) day.queue.push(id);
      return save(day);
    }
    day.done++;
    return day.queue.length ? save(day) : toCheck(day, day.target);
  }

  if (id && action !== "yes") day.failed.push(id);
  if (day.queue.length) return save(day);
  return day.failed.length ? toCards(day, shuffle(day.failed)) : finish(day);
}

/** Показ карточки считается повтором ровно один раз, даже после перезагрузки. */
export async function present(day) {
  const id = day.queue[0];
  if (!id || day.shown === id) return day;
  await touch(id, day.date);
  return save(Object.assign(day, { shown: id }));
}

export const itemsOf = async (ids) =>
  (await Promise.all(ids.map((id) => get("items", id)))).filter(Boolean);

export const currentItem = (day) => day.queue[0] ? get("items", day.queue[0]) : null;

/** Всё, что день закрыл: набор плюс знакомое, отсеянное на сортировке. */
export const closedIds = (day) => [...day.set || [], ...day.known || []];

/** Счёт дня двумя числами: новое прошло карточки и проверку, знакомое закрылось
    одним нажатием — это разный труд, и в одно число он не складывается. */
export const score = (day) => ({ fresh: (day.set || []).length, known: (day.known || []).length });

export function scoreLine(day) {
  const { fresh, known } = score(day);
  const left = plural(fresh, "новое", "новых", "новых");
  const right = plural(known, "знакомое", "знакомых", "знакомых");
  return !known ? left : !fresh ? right : `${left} + ${right}`;
}

/** Все дни, новые сверху. */
export const history = async () =>
  (await all("sessions")).map(norm).sort((a, b) => b.date.localeCompare(a.date));

/** Стрик: сколько дней подряд закрыт хотя бы один день. Вчерашний конец стрик
    не рвёт — сегодня ещё можно позаниматься. */
export async function streak(today = todayISO()) {
  const closed = new Set((await history()).filter((d) => d.stage === "done").map((d) => d.date));
  let cursor = closed.has(today) ? today : shiftDate(today, -1);
  let days = 0;
  while (closed.has(cursor)) { days++; cursor = shiftDate(cursor, -1); }
  return days;
}
