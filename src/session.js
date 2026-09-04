/* Движок дня — один на слова и на фразовые глаголы (глава I, этап 4).

   Виды пакета отличаются только размером набора и подписями; логика трёх этапов
   общая, поэтому отдельного кода для фразовых глаголов нет.

   Этапы:
     sort   — «знаю / не знаю»: знакомое сразу уходит в выученное, набор дня
              добирается новыми записями до нужного размера;
     cards  — карточки с переворотом по набору дня, «повторить» отправляет
              карточку в конец очереди;
     check  — «помнишь перевод?»: провалы возвращаются в карточки новым кругом,
              чистый круг закрывает день;
     done   — день закрыт, набор перестаёт меняться.
*/

import * as db from "./db.js";
import * as progress from "./progress.js";
import * as settingsStore from "./settings.js";
import { shuffle, todayISO } from "./ui.js";
import { LEVELS } from "./packs.js";

export const KINDS = {
  words: { title: "Слова дня", icon: "📘", route: "#/day/words" },
  phrasal: { title: "Фразовые глаголы", icon: "🔗", route: "#/day/phrasal" },
};

export const PHASES = ["sort", "cards", "check", "done"];

export function isDone(session) {
  return !!session && session.phase === "done";
}

export async function load(kind, date = todayISO()) {
  return db.get("sessions", db.sessionKey(date, kind));
}

export async function save(session) {
  // Закрытый день не перезаписываем: возврат на экран дня не должен его «открыть».
  const existing = await db.get("sessions", session.id);
  if (existing && existing.phase === "done" && session.phase !== "done") return existing;
  await db.put("sessions", session);
  return session;
}

/** Уровень, на котором ещё есть невыученное. Для фразовых глаголов уровень один. */
export async function pickLevel(kind, preferred) {
  if (kind === "phrasal") {
    const stats = await progress.levelStats("phrasal", "phrasal");
    return stats.total - stats.learned > 0 ? "phrasal" : null;
  }
  const order = [preferred, ...LEVELS.filter((l) => l !== preferred)];
  for (const level of order) {
    if (!level) continue;
    const stats = await progress.levelStats("words", level);
    if (stats.total - stats.learned > 0) return level;
  }
  return null;
}

function empty(kind, date, level, size) {
  return {
    id: db.sessionKey(date, kind),
    date, kind, level, size,
    daySet: [], sortQueue: [],
    phase: "sort",
    cardQueue: [], cardRoundTotal: 0, cardsDone: 0, checkTarget: [],
    checkQueue: [], checkRoundTotal: 0, checkFailed: [],
    knownCount: 0, learnedToday: 0, lastPresented: null,
  };
}

/** Сессия дня: существующая или новая. `null` — учить больше нечего. */
export async function loadOrStart(kind, date = todayISO()) {
  const existing = await load(kind, date);
  if (existing) return existing;

  await progress.releaseLearning();          // хвосты незакрытых дней возвращаем в пул
  const settings = await settingsStore.get();
  const level = await pickLevel(kind, settings.level);
  if (!level) return null;

  const size = settingsStore.perDay(settings, kind);
  const pool = await progress.poolFor(kind, level);
  const picked = shuffle(pool).slice(0, size).map((item) => item.id);
  const session = empty(kind, date, level, size);
  session.daySet = picked.slice();
  session.sortQueue = shuffle(picked);
  await save(session);
  return session;
}

export async function items(ids) {
  const rows = await Promise.all(ids.map((id) => db.get("items", id)));
  return rows.filter(Boolean);
}

export async function currentItem(session) {
  const id = currentId(session);
  return id ? db.get("items", id) : null;
}

export function currentId(session) {
  if (session.phase === "sort") return session.sortQueue[0] || null;
  if (session.phase === "cards") return session.cardQueue[0] || null;
  if (session.phase === "check") return session.checkQueue[0] || null;
  return null;
}

/** Этап 1. know=true — знакомое слово: сразу выучено, набор дня добирается. */
export async function answerSort(session, know) {
  const id = session.sortQueue.shift();
  if (!id) return afterSort(session);
  if (know) {
    await progress.mark(id, progress.LEARNED, session.date);
    session.knownCount++;
    session.daySet = session.daySet.filter((x) => x !== id);
    await refill(session);
  } else {
    await progress.mark(id, progress.LEARNING, session.date);
  }
  if (!session.sortQueue.length) return afterSort(session);
  await save(session);
  return session;
}

/** Добор набора дня после ответа «знаю»: день должен остаться нужного размера. */
async function refill(session) {
  if (session.daySet.length >= session.size) return;
  const pool = await progress.poolFor(session.kind, session.level);
  const busy = new Set([...session.daySet, ...session.sortQueue]);
  const candidates = pool.filter((item) => !busy.has(item.id));
  if (!candidates.length) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  session.daySet.push(pick.id);
  session.sortQueue.unshift(pick.id);        // показать следующим
}

async function afterSort(session) {
  if (!session.daySet.length) {              // всё оказалось знакомым
    session.phase = "done";
    session.learnedToday = session.knownCount;
    await save(session);
    return session;
  }
  return startCards(session, shuffle(session.daySet));
}

async function startCards(session, ids) {
  session.phase = "cards";
  session.cardQueue = ids.slice();
  session.cardRoundTotal = ids.length;
  session.cardsDone = 0;
  session.checkTarget = ids.slice();
  session.lastPresented = null;
  await save(session);
  return session;
}

/** Показ карточки считается повтором ровно один раз, даже после перезагрузки. */
export async function present(session) {
  const id = currentId(session);
  if (!id || session.lastPresented === id) return session;
  await progress.touch(id, session.date);
  session.lastPresented = id;
  await save(session);
  return session;
}

export async function cardKnown(session) {
  session.cardQueue.shift();
  session.cardsDone++;
  session.lastPresented = null;
  if (!session.cardQueue.length) return startCheck(session, session.checkTarget.slice());
  await save(session);
  return session;
}

export async function cardRepeat(session) {
  const id = session.cardQueue.shift();
  if (id) session.cardQueue.push(id);
  session.lastPresented = null;
  await save(session);
  return session;
}

async function startCheck(session, ids) {
  session.phase = "check";
  session.checkQueue = ids.slice();
  session.checkRoundTotal = ids.length;
  session.checkFailed = [];
  session.lastPresented = null;
  await save(session);
  return session;
}

/** Этап 3. Провалы уходят в новый круг карточек, чистый круг закрывает день. */
export async function answerCheck(session, remembered) {
  const id = session.checkQueue.shift();
  if (id && !remembered) session.checkFailed.push(id);
  session.lastPresented = null;
  if (session.checkQueue.length) {
    await save(session);
    return session;
  }
  if (session.checkFailed.length) return startCards(session, shuffle(session.checkFailed));
  return finish(session);
}

async function finish(session) {
  for (const id of session.daySet) {
    await progress.mark(id, progress.LEARNED, session.date);
  }
  session.phase = "done";
  session.learnedToday = session.knownCount + session.daySet.length;
  await save(session);
  return session;
}

/** Строка состояния для хаба: «осталось 4 из 10» / «сделано сегодня». */
export async function stateLine(kind, date = todayISO()) {
  const session = await load(kind, date);
  if (session && session.phase === "done") {
    return { done: true, text: `Сделано сегодня — ${session.learnedToday} записей` };
  }
  if (session) {
    const left = session.phase === "sort"
      ? session.sortQueue.length
      : session.phase === "cards" ? session.cardQueue.length : session.checkQueue.length;
    const stage = { sort: "сортировка", cards: "карточки", check: "проверка" }[session.phase];
    return { done: false, text: `${stage}: осталось ${left} из ${session.size}` };
  }
  const settings = await settingsStore.get();
  const level = await pickLevel(kind, settings.level);
  if (!level) return { done: false, text: "Нет загруженных записей — загрузите пакет" };
  const stats = await progress.levelStats(kind, level);
  const label = kind === "phrasal" ? "" : ` · ${level.toUpperCase()}`;
  return { done: false, text: `Не начат${label} · осталось ${stats.total - stats.learned}` };
}

/** Все закрытые и незакрытые дни, новые сверху — для истории. */
export async function history() {
  const rows = await db.getAll("sessions");
  return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export async function removeDay(id) {
  return db.remove("sessions", id);
}
