/* Маршруты и действия — «сервер», который живёт в самой странице.

   Разметка ходит за экранами через htmx (`hx-get`, `hx-post`), а запрос
   перехватывается здесь: вместо сети отвечает таблица маршрутов, htmx делает
   то же, что делал бы с ответом сервера — подменяет `#app`. Экраны остаются
   строками HTML, а состояние — в IndexedDB.

   Адрес держится в хеше, поэтому «назад» браузера и телефона работают сами. */

import { CONFIG, kindOf, langName, levelName } from "./config.js";
import * as V from "./views.js";
import * as P from "./packs.js";
import {
  LEARNED, answer, closedIds, currentItem, formatSize, history as allDays, itemsOf, levelStats,
  loadDay, mark, pick, pickLevel, plural, pool, present, scoreLine, shuffle, startDay,
  streak, todayISO, totals, touch,
} from "./core.js";
import { clear, dayKey, del, destroy, forgetSettings, get, open, packKey, patch, settings } from "./store.js";

const app = document.getElementById("app");
const dialog = document.getElementById("dialog");

/* ── Мелочи оболочки ────────────────────────────────────────────────── */

let toastTimer;
export function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  node.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove("show"), 3500);
}

const applyTheme = (theme) => theme === "auto"
  ? document.documentElement.removeAttribute("data-theme")
  : document.documentElement.setAttribute("data-theme", theme);

/** Вопрос с двумя ответами. По умолчанию — отмена: Esc и клик мимо закрывают
    диалог отказом. Ответ приходит из самой кнопки, а не из события `close`:
    в некоторых движках оно у <dialog> не доходит. */
const ask = (text, confirmLabel = "Продолжить") => new Promise((resolve) => {
  const close = (value) => { dialog.close(); resolve(value); };
  dialog.innerHTML = `<div class="modal__box"><p class="modal__text">${V.esc(text)}</p>
    <div class="modal__actions">
      <button class="btn" type="button" data-no>Отмена</button>
      <button class="btn btn--danger" type="button" data-yes>${V.esc(confirmLabel)}</button>
    </div></div>`;
  dialog.querySelector("[data-no]").onclick = () => close(false);
  dialog.querySelector("[data-yes]").onclick = () => close(true);
  dialog.oncancel = () => close(false);
  dialog.onclick = (event) => { if (event.target === dialog) close(false); };
  dialog.showModal();
});

/** Экран загрузки для долгого дела: полоса, строка состояния и отмена. */
async function withProgress(title, task) {
  dialog.innerHTML = V.progress(title);
  const fill = dialog.querySelector(".bar__fill");
  const note = dialog.querySelector("[data-note]");
  const stop = new AbortController();
  dialog.querySelector("[data-cancel]").onclick = () => stop.abort();
  dialog.oncancel = (event) => { event.preventDefault(); stop.abort(); };
  dialog.onclick = null;                      // случайный тап мимо не бросает работу
  dialog.showModal();
  const set = (value, message) => {
    fill.style.width = `${Math.round(Math.min(Math.max(value, 0), 1) * 100)}%`;
    if (message) note.textContent = message;
  };
  try {
    return await task({ set, signal: stop.signal });
  } finally {
    dialog.close();
  }
}

/* ── Экраны ─────────────────────────────────────────────────────────── */

const STAGE_TEXT = { sort: "сортировка", cards: "карточки", check: "проверка" };

/** Строка состояния режима для хаба. */
async function stateLine(kind) {
  const day = await loadDay(kind);
  if (day?.stage === "done") return `Готово: ${scoreLine(day)}`;
  if (day) return `${STAGE_TEXT[day.stage]}: осталось ${day.queue.length} из ${day.size}`;
  const config = await settings();
  const level = await pickLevel(kind, config.level, config);
  if (!level) return "Нет загруженных записей — загрузите пакет";
  const stats = await levelStats(kind, level);
  const label = kind === "phrasal" ? "" : ` · ${level.toUpperCase()}`;
  return `Не начат${label} · осталось ${stats.left}`;
}

async function home() {
  const config = await settings();
  const [words, phrasal, stats, days, days_streak] = await Promise.all([
    stateLine("words"), stateLine("phrasal"),
    levelStats("words", config.level), allDays(), streak(),
  ]);
  const level = await pickLevel("words", config.level, config);
  return V.home({
    config, lines: { words, phrasal }, stats, streak: days_streak,
    endless: level ? (await levelStats("words", level)).left : null,
    closed: days.filter((d) => d.stage === "done").length,
  });
}

const splitParts = async (day) => {
  const [fresh, known] = await Promise.all([itemsOf(day.set || []), itemsOf(day.known || [])]);
  return { fresh, known, total: fresh.length + known.length };
};

/** Экран дня по текущему этапу. Слова может не оказаться в базе — пакет
    удалили посреди дня: отвечаем за него сами и идём дальше. */
async function dayView(day) {
  const config = await settings();
  let item = day.stage === "done" ? null : await currentItem(day);
  for (let guard = 0; day.stage !== "done" && !item && guard < 999; guard++) {
    day = await answer(day, day.stage === "check" ? "yes" : "skip");
    item = day.stage === "done" ? null : await currentItem(day);
  }
  if (day.stage === "done") return V.day({ day: { ...day, parts: await splitParts(day) }, config });
  if (day.stage !== "sort") day = await present(day);
  return V.day({ day, item, config });
}

async function dayScreen({ kind }) {
  if (!CONFIG.kinds[kind]) return home();
  const day = await startDay(kind);
  return day ? dayView(day) : V.day({ day: null });
}

async function dayAnswer({ kind }, params) {
  const day = await loadDay(kind);
  return day ? dayView(await answer(day, params.a)) : dayScreen({ kind });
}

/* Бесконечный режим и повторение живут ровно столько, сколько открыт экран:
   очередь нигде не сохраняется — в историю попадают только дни. */

let endlessState = null;

async function endlessRefill(config) {
  const state = endlessState;
  const next = await pickLevel(state.kind, state.level || config.level, config);
  if (!next) return false;
  if (state.level && next !== state.level) {
    toast(`Уровень ${state.level.toUpperCase()} пройден — дальше ${next.toUpperCase()}`);
  }
  state.level = next;
  const list = await pool(state.kind, next, config);
  state.left = list.length;
  const busy = new Set(state.queue);
  const fresh = pick(list.filter((item) => !busy.has(item.id)), list.length);
  state.queue = [...state.queue, ...fresh.map((item) => item.id)];
  return state.queue.length > 0;
}

async function endlessView() {
  const config = await settings();
  const state = endlessState;
  for (let guard = 0; guard < 999; guard++) {
    const item = state.queue[0] ? await get("items", state.queue[0]) : null;
    if (item) {
      await touch(item.id, todayISO());
      return V.endless({ ...state, item, config });
    }
    if (state.queue.length) state.queue.shift();          // слова нет — пакет удалён
    else if (!await endlessRefill(config)) break;
  }
  return V.endless({ kind: state.kind, item: null });
}

async function endlessScreen({ kind }) {
  if (!CONFIG.kinds[kind]) return home();
  if (endlessState?.kind !== kind) endlessState = { kind, level: null, queue: [], learned: 0, again: 0, left: 0 };
  return endlessView();
}

async function endlessAnswer({ kind }, params) {
  if (endlessState?.kind !== kind) return endlessScreen({ kind });
  const state = endlessState;
  const id = state.queue.shift();
  if (id && params.a === "ok") {
    await mark(id, LEARNED, todayISO());
    state.learned++;
    state.left = Math.max(state.left - 1, 0);
  } else if (id) {
    state.queue.splice(Math.min(CONFIG.againAfter, state.queue.length), 0, id);
    state.again++;
  }
  return endlessView();
}

let reviewState = null;

async function reviewView() {
  const config = await settings();
  const { order, index, kind, date } = reviewState;
  const item = order[index] ? await get("items", order[index]) : null;
  return V.review({ kind, date, item, config, index, total: order.length });
}

async function reviewScreen({ date, kind }) {
  const day = await loadDay(kind, date);
  const items = day ? await itemsOf(closedIds(day)) : [];
  reviewState = { date, kind, order: shuffle(items.map((i) => i.id)), index: 0 };
  return reviewView();
}

async function reviewStep(params, values) {
  if (!reviewState) return reviewScreen(params);
  const state = reviewState;
  if (values.a === "back") state.index = Math.max(state.index - 1, 0);
  else if (state.index + 1 < state.order.length) state.index++;
  else { toast("Круг пройден"); state.order = shuffle(state.order); state.index = 0; }
  return reviewView();
}

/* ── История ────────────────────────────────────────────────────────── */

const historyScreen = async () => V.history(await allDays());

async function historyDayScreen({ date }) {
  const entries = (await allDays()).filter((day) => day.date === date);
  if (!entries.length) return historyScreen();
  return V.historyDay({
    date, config: await settings(),
    entries: await Promise.all(entries.map(async (day) => ({ day, parts: await splitParts(day) }))),
  });
}

async function historyDelete({ date }, params) {
  await del("sessions", dayKey(date, params.kind));
  toast("День удалён");
  return historyScreen();
}

/* ── Языки, уровни, пакеты ──────────────────────────────────────────── */

async function packsScreen() {
  const config = await settings();
  let list = [], error = null;
  try { list = await P.catalog(); } catch (e) { error = e.message; }
  const have = await P.installed();
  const sides = P.needed(config);

  const describe = (part) =>
    part.have?.origin === "local" ? `собран здесь ${part.have.installedAt}`
    : part.have ? `загружен ${part.have.installedAt}`
    : part.entry ? `${plural(part.entry.count, "запись", "записи", "записей")} · ${formatSize(part.entry.bytes)}`
    : P.optional(part.lang) ? "толкования нет — на обороте само слово"
    : "готового файла нет — соберём здесь";

  const rows = [];
  for (const level of [...CONFIG.levels, "phrasal"]) {
    const kind = kindOf(level);
    const parts = sides.map((lang) => ({
      lang, entry: list.find((p) => p.lang === lang && p.level === level) || null,
      have: have.get(packKey(lang, level)) || null,
    }));
    const stats = await levelStats(kind, level);
    // Словам уровня нужен хоть какой-то пакет: из него берутся сами слова и примеры.
    if (!stats.total && !parts.some((p) => p.have || p.entry)) {
      const best = list.filter((p) => p.level === level).sort((a, b) => b.count - a.count)[0];
      if (best) parts.push({ lang: best.lang, entry: best, have: null });
    }
    // Английская сторона без файла — не недостача: на обороте будет само слово.
    const missing = parts.filter((p) => !p.have && !(P.optional(p.lang) && !p.entry));
    const stale = parts.filter((p) => p.have && p.entry
      && (p.entry.count !== p.have.count || p.entry.builtAt > (p.have.builtAt || "")));
    rows.push({
      level, kind, parts, missing, stale,
      active: kind === "words" && config.level === level,
      sub: [
        parts.length > 1 ? parts.map((p) => `${langName(p.lang)}: ${describe(p)}`).join(" · ") : describe(parts[0]),
        missing.length ? null : `выучено ${stats.learned} из ${stats.total}`,
      ].filter(Boolean).join(" · "),
    });
  }
  return V.packs({ config, rows, error });
}

/** Начатый день набран на прежнем уровне и сам не поменяется — предложим
    начать заново, иначе смена уровня выглядит так, будто ничего не произошло. */
async function offerRestart(level) {
  const day = await loadDay("words");
  if (!day || day.stage === "done" || day.level === level) return;
  const yes = await ask(`Сегодняшний набор взят с уровня ${day.level.toUpperCase()}. Начать день заново `
    + `с уровня ${level.toUpperCase()}? Выученное останется выученным.`, "Начать заново");
  if (!yes) return;
  await del("sessions", day.id);
  toast("День начат заново");
}

/** Выбор языка или уровня — законченное действие: настройка записана, готовые
    пакеты скачаны, а недостающие собраны переводом прямо здесь. */
async function choose(changes) {
  let result;
  try {
    result = await withProgress("Загружаем пакеты", ({ set }) => P.apply(changes, set));
  } catch (error) {
    toast(`Не получилось загрузить: ${error.message}`);
    return;
  }
  for (const gap of result.missing) {
    if (!P.online()) { toast("Нет сети: пакет нельзя ни скачать, ни собрать"); break; }
    await withProgress(`Собираем ${langName(gap.lang)} · ${levelName(gap.level)}`, async ({ set, signal }) => {
      try {
        const count = await P.build(gap.lang, gap.level, { signal, onProgress: set });
        toast(`Пакет собран: ${plural(count, "запись", "записи", "записей")}`);
      } catch (error) {
        toast(error.name === "AbortError" ? "Сборка отменена" : `Собрать не вышло: ${error.message}`);
      }
    });
  }
  if (!result.missing.length && !result.added.length) toast("Готово — пакет уже был загружен");
  if (changes.level) await offerRestart(changes.level);
}

/** Один обработчик на три ряда выбора: язык изучения, язык перевода, уровень.
    На знакомстве тот же выбор возвращает шаг знакомства, а не экран пакетов. */
const pickField = (field) => async (_, params, query) => {
  await choose({ [field]: params.code });
  return query.step ? onboardingScreen(null, {}, query) : packsScreen();
};

async function packsInstall(_, params) {
  const config = await settings();
  const level = params.level;
  for (const lang of P.needed(config)) {
    const entry = await P.entryFor(lang, level);
    if (!entry) {
      if (!P.optional(lang)) await choose({});   // соберём недостающее переводом
      continue;
    }
    try {
      await withProgress(`${langName(lang)} · ${levelName(level)}`, ({ set }) => P.install(entry, set));
    } catch (error) {
      toast(`Не получилось: ${error.message}`);
    }
  }
  return packsScreen();
}

async function packsUninstall(_, params) {
  const config = await settings();
  for (const lang of P.needed(config)) {
    if (await get("packs", packKey(lang, params.level))) await P.uninstall(lang, params.level);
  }
  toast("Пакет удалён");
  return packsScreen();
}

/* ── Настройки ──────────────────────────────────────────────────────── */

const settingsScreen = async () => V.settings({ config: await settings(), totals: await totals() });

const settingsSize = async (_, params) => {
  const config = await settings();
  await patch({ per: { ...config.per, [params.kind]: Number(params.n) } });
  return settingsScreen();
};

const settingsTheme = async (_, params) => {
  applyTheme(params.value);
  await patch({ theme: params.value });
  return settingsScreen();
};

async function settingsExport() {
  const blob = new Blob([JSON.stringify(await P.exportAll())], { type: "application/json" });
  const link = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(blob), download: `vocab-backup-${todayISO()}.json`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  toast("Файл копии сохранён");
  return settingsScreen();
}

async function settingsImport(_, params, query, element) {
  const file = element?.files?.[0];
  if (element) element.value = "";
  if (!file) return settingsScreen();
  try {
    const parsed = P.parseBackup(await file.text());
    if (parsed.type === "pack") {
      await P.write(parsed.data);
      toast(`Пакет ${parsed.data.lang}/${parsed.data.level} установлен из файла`);
      return settingsScreen();
    }
    const replace = await ask("«Заменить всё» сотрёт текущую базу и положит содержимое файла. "
      + "Отмена оставит всё как есть — тогда можно выбрать «Объединить».", "Заменить всё");
    if (replace) await P.replaceAll(parsed.data);
    else if (await ask("Объединить файл с текущей базой? Победит более продвинутый статус, "
      + "ничего не потеряется.", "Объединить")) await P.merge(parsed.data);
    else return settingsScreen();
    toast(replace ? "База заменена" : "Данные объединены");
  } catch (error) {
    toast(`Импорт не удался: ${error.message}`);
  }
  return settingsScreen();
}

const settingsClearHistory = async () => {
  await clear("sessions");
  toast("История удалена");
  return settingsScreen();
};

async function settingsReset() {
  await destroy();
  forgetSettings();
  location.hash = "#/home";
  location.reload();
  return "";
}

const settingsOnboarding = async () => {
  await patch({ onboarded: false });
  return onboardingScreen(null, {}, {});
};

/* ── Знакомство ─────────────────────────────────────────────────────── */

async function onboardingScreen(_, __, query = {}) {
  const config = await settings();
  const step = Math.min(Number(query.step) || 0, 3);
  const have = await P.installed();
  const ready = P.needed(config).every((code) => have.has(packKey(code, config.level)));
  return V.onboarding({
    step, config,
    status: step === 2
      ? ready ? `Готово: ${langName(config.study)} → ${langName(config.lang)}, ${levelName(config.level)}.`
        : `Пакет ${levelName(config.level)} пока не получен — попробуйте ещё раз или выберите другой уровень.`
      : "",
  });
}

const onboardingFinish = async () => {
  await patch({ onboarded: true });
  return home();
};

/* ── Таблица маршрутов ──────────────────────────────────────────────── */

const ROUTES = [
  ["GET", "/home", home, { chrome: "panel", title: "VOCAB" }],
  ["GET", "/day/:kind", dayScreen, { chrome: "top", title: (p) => CONFIG.kinds[p.kind]?.title || "День" }],
  ["POST", "/day/:kind/answer", dayAnswer],
  ["GET", "/endless/:kind", endlessScreen, { chrome: "top", title: "Бесконечный режим" }],
  ["POST", "/endless/:kind/answer", endlessAnswer],
  ["GET", "/history", historyScreen, { chrome: "panel", title: "История" }],
  ["GET", "/history/:date", historyDayScreen, { chrome: "panel", title: "История" }],
  ["POST", "/history/:date/delete", historyDelete],
  ["GET", "/review/:date/:kind", reviewScreen, { chrome: "top", title: "Повторение" }],
  ["POST", "/review/:date/:kind/step", reviewStep],
  ["GET", "/packs", packsScreen, { chrome: "panel", title: "Языки и уровни" }],
  ["POST", "/packs/study", pickField("study")],
  ["POST", "/packs/lang", pickField("lang")],
  ["POST", "/packs/level", pickField("level")],
  ["POST", "/packs/install", packsInstall],
  ["POST", "/packs/uninstall", packsUninstall],
  ["GET", "/settings", settingsScreen, { chrome: "panel", title: "Настройки" }],
  ["POST", "/settings/size", settingsSize],
  ["POST", "/settings/theme", settingsTheme],
  ["POST", "/settings/export", settingsExport],
  ["POST", "/settings/import", settingsImport],
  ["POST", "/settings/clear-history", settingsClearHistory],
  ["POST", "/settings/reset", settingsReset],
  ["POST", "/settings/onboarding", settingsOnboarding, { chrome: "none", title: "Знакомство" }],
  ["GET", "/help", V.help, { chrome: "top", title: "Как это работает" }],
  ["GET", "/onboarding", onboardingScreen, { chrome: "none", title: "Знакомство" }],
  ["POST", "/onboarding/finish", onboardingFinish, { chrome: "panel", title: "VOCAB" }],
];

function match(verb, path) {
  const parts = path.split("/").filter(Boolean);
  for (const [method, pattern, handler, meta] of ROUTES) {
    if (method !== verb) continue;
    const template = pattern.split("/").filter(Boolean);
    if (template.length !== parts.length) continue;
    const params = {};
    if (template.every((part, i) => part.startsWith(":")
      ? (params[part.slice(1)] = decodeURIComponent(parts[i]), true)
      : part === parts[i])) return { handler, params, meta };
  }
  return null;
}

/* ── Мост с htmx ────────────────────────────────────────────────────────
   Запрос перехватывается до отправки: маршрут отвечает строкой, htmx кладёт
   её в цель ровно так же, как ответ сервера. */

async function serve(verb, address, values = {}, { target = app, element = null, push = true } = {}) {
  const [path, search = ""] = address.split("?");
  const route = match(verb, path);
  if (!route) return serve("GET", "/home", {}, { target, push });

  let html;
  try {
    html = await route.handler(route.params, values, Object.fromEntries(new URLSearchParams(search)), element);
  } catch (error) {
    console.error(error);
    html = `<div class="card"><h2>Что-то сломалось</h2>
      <p class="muted">${V.esc(error.message || error)}</p>
      <button class="btn btn--wide" type="button" hx-get="/home">На главную</button></div>`;
  }

  const { meta } = route;
  if (meta) {
    const hash = meta.hash || (verb === "GET" ? `#${path}${search ? `?${search}` : ""}` : `#${path}`);
    document.querySelector(".app").dataset.chrome = meta.chrome;
    document.getElementById("title").textContent =
      typeof meta.title === "function" ? meta.title(route.params) : meta.title;
    document.getElementById("back").hidden = meta.chrome === "none" || hash === "#/home";
    if (push && hash !== location.hash) history.pushState({}, "", hash);
    else if (!push) history.replaceState({}, "", hash);
    for (const item of document.querySelectorAll(".side__item[data-route]")) {
      const target = item.dataset.route;
      item.classList.toggle("side__item--on", path === target || path.startsWith(`${target}/`));
    }
  }

  htmx.swap(target, html, { swapStyle: "innerHTML" });
  app.scrollTop = 0;
  return html;
}

// Ни один hx-запрос не уходит в сеть: на них отвечает таблица маршрутов.
document.body.addEventListener("htmx:configRequest", (event) => {
  event.preventDefault();
  const { verb, path, parameters, target } = event.detail;
  serve(verb.toUpperCase(), path, parameters, { target, element: event.target });
});

// hx-confirm показываем своим диалогом вместо системного окна.
document.body.addEventListener("htmx:confirm", (event) => {
  if (!event.detail.question) return;
  event.preventDefault();
  ask(event.detail.question, "Да").then((yes) => yes && event.detail.issueRequest(true));
});

addEventListener("popstate", () => serve("GET", location.hash.slice(1) || "/home", {}, { push: false }));

/* Свайп по карточке: влево — «ещё раз», вправо — «знаю». Жест только дополняет
   кнопки, поэтому это обычное событие, которое ждёт `hx-trigger`. */
let swipe = null;

app.addEventListener("pointerdown", (event) => {
  const node = event.target.closest("[data-swipe]");
  if (node && !(event.pointerType === "mouse" && event.button)) {
    swipe = { node, x: event.clientX, y: event.clientY, moved: false };
  }
});

app.addEventListener("pointermove", (event) => {
  if (!swipe) return;
  const dx = event.clientX - swipe.x;
  if (Math.abs(dx) < Math.abs(event.clientY - swipe.y)) return;   // вертикаль — это скролл
  swipe.moved = Math.abs(dx) > 10;
  if (swipe.moved) swipe.node.style.transform = `translateX(${dx}px)`;
});

app.addEventListener("pointerup", (event) => {
  if (!swipe) return;
  const dx = event.clientX - swipe.x;
  swipe.node.style.transform = "";
  if (swipe.moved && Math.abs(dx) >= 60) {
    swipe.node.dispatchEvent(new CustomEvent(dx > 0 ? "swiperight" : "swipeleft"));
  }
  swipe = null;
});

app.addEventListener("pointercancel", () => {
  if (swipe) swipe.node.style.transform = "";
  swipe = null;
});

/* ── Запуск ─────────────────────────────────────────────────────────── */

async function boot() {
  document.getElementById("side-nav").innerHTML = CONFIG.nav.map(([path, mark, label]) =>
    `<button class="side__item" type="button" data-route="${path}" hx-get="${path}">${V.icon(mark)}${label}</button>`).join("");
  htmx.process(document.getElementById("side-nav"));

  app.innerHTML = `<div class="card"><p class="muted center" data-note>Открываем базу…</p>
    <div class="bar"><div class="bar__fill" style="width:5%"></div></div></div>`;
  const note = app.querySelector("[data-note]");
  const fill = app.querySelector(".bar__fill");

  try {
    await open();
  } catch (error) {
    app.innerHTML = `<div class="card"><h2>Нет доступа к хранилищу</h2>
      <p class="muted">Прогресс хранится в IndexedDB браузера. В приватном окне или при запрете
      хранения данных приложение работать не может.</p>
      <p class="muted">${V.esc(error.message || error)}</p></div>`;
    return;
  }

  // Первый запуск ставит пакеты из папки packs/ — это секунды записи в базу,
  // и всё это время на экране должно быть видно, что происходит.
  try {
    const starters = await P.ensureStarter((value, label) => {
      fill.style.width = `${Math.round(5 + value * 95)}%`;
      if (label) note.textContent = `Ставим пакет: ${label}`;
    });
    if (starters.length) toast(`Установлены стартовые пакеты: ${starters.length}`);
  } catch (error) {
    console.warn("стартовые пакеты не установились:", error);
  }

  const config = await settings();
  applyTheme(config.theme);
  const start = !config.onboarded && !location.hash.startsWith("#/help")
    ? "/onboarding" : location.hash.slice(1) || "/home";
  await serve("GET", start, {}, { push: false });

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register(new URL("../sw.js", import.meta.url))
      .catch((error) => console.warn("service worker не зарегистрирован:", error));
  }
}

boot();
