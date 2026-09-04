/* Прогресс: статусы слов, счётчики, статистика.

   Статусы: `new` (запись ни разу не попадала в день — просто нет записи в progress),
   `learning` (взято в работу, день не закрыт), `learned` (выучено).
   Прогресс живёт отдельно от контента и не привязан к языку: смена языка или
   переустановка пакета его не трогают (глава I, 2.2). */

import * as db from "./db.js";

export const NEW = "new";
export const LEARNING = "learning";
export const LEARNED = "learned";

export async function map(ids) {
  const rows = await db.getAll("progress");
  const wanted = ids ? new Set(ids) : null;
  const out = new Map();
  for (const row of rows) {
    if (!wanted || wanted.has(row.id)) out.set(row.id, row);
  }
  return out;
}

export async function statusOf(id) {
  const row = await db.get("progress", id);
  return row ? row.status : NEW;
}

export async function idsWithStatus(status) {
  const rows = await db.indexAll("progress", "status", status);
  return rows.map((r) => r.id);
}

export async function countWithStatus(status) {
  return db.indexCount("progress", "status", status);
}

/** Отметить статус. `date` — сегодняшняя дата в ISO. */
export async function mark(id, status, date) {
  return db.transact(["progress"], "readwrite", async (s) => {
    const store = s.progress;
    const existing = await db.request(store.get(id));
    const row = existing || { id, status: NEW, firstShown: date, reviews: 0 };
    row.status = status;
    row.firstShown = row.firstShown || date;
    if (status === LEARNED) row.learnedAt = date;
    store.put(row);
    return row;
  });
}

/** Показ карточки: считаем повторы. */
export async function touch(id, date) {
  return db.transact(["progress"], "readwrite", async (s) => {
    const store = s.progress;
    const existing = await db.request(store.get(id));
    const row = existing || { id, status: LEARNING, firstShown: date, reviews: 0 };
    row.reviews = (row.reviews || 0) + 1;
    store.put(row);
    return row;
  });
}

/** Незакрытый день прошлого оставляет слова в `learning` — возвращаем их в пул.
    Слова сегодняшних незакрытых дней не трогаем: такой день ещё идёт, и его набор
    (в том числе набор соседнего занятия) должен остаться на месте. */
export async function releaseLearning(today) {
  const rows = await db.indexAll("progress", "status", LEARNING);
  if (!rows.length) return 0;
  const sessions = await db.indexAll("sessions", "date", today);
  const busy = new Set();
  for (const session of sessions) {
    if (session.phase === "done") continue;
    for (const id of session.daySet || []) busy.add(id);
  }
  const stale = rows.filter((row) => !busy.has(row.id));
  if (!stale.length) return 0;
  await db.transact(["progress"], "readwrite", (s) => {
    for (const row of stale) s.progress.delete(row.id);
  });
  return stale.length;
}

/** Сколько записей вида `kind` на уровне `level` выучено и сколько осталось. */
export async function levelStats(kind, level) {
  const ids = await db.indexKeys("items", "kind_level", [kind, level]);
  const progress = await map(ids);
  let learned = 0, learning = 0;
  for (const id of ids) {
    const status = progress.get(id)?.status;
    if (status === LEARNED) learned++;
    else if (status === LEARNING) learning++;
  }
  return { total: ids.length, learned, learning, fresh: ids.length - learned - learning };
}

/** Записи, ещё не выученные: из них набирается день. */
export async function poolFor(kind, level) {
  const items = await db.indexAll("items", "kind_level", [kind, level]);
  const learned = new Set(await idsWithStatus(LEARNED));
  return items.filter((item) => !learned.has(item.id));
}

export async function totals() {
  const [items, learned, learning] = await Promise.all([
    db.count("items"),
    countWithStatus(LEARNED),
    countWithStatus(LEARNING),
  ]);
  return { items, learned, learning };
}
