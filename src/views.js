/* Экраны — строки HTML. Поведение описано атрибутами htmx прямо в разметке:
   `hx-get` и `hx-post` уходят в маршруты (src/app.js), ответ занимает `#app`.
   Никаких обработчиков в коде: переворот карточки и раскрытие примера —
   это класс на узле, всё остальное — запрос. */

import { CONFIG, langFlag, langName, levelName, posName } from "./config.js";
import { example, formatDate, isMT, meaning, plural, scoreLine, word } from "./core.js";

export const esc = (value) => String(value ?? "").replace(/[&<>"]/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/* Значки — один тонкий штрих без заливки, тот же вес, что у рамок. */
const PATHS = {
  book: '<path d="M3.5 4.5h6a2 2 0 0 1 2 2v13a1.8 1.8 0 0 0-1.8-1.5H3.5z"/><path d="M20.5 4.5h-6a2 2 0 0 0-2 2v13a1.8 1.8 0 0 1 1.8-1.5h6.2z"/>',
  link: '<path d="M9.5 14.5 14.5 9.5"/><path d="M11 6.5 13 4.5a3.5 3.5 0 0 1 5 5l-2 2"/><path d="M13 17.5 11 19.5a3.5 3.5 0 0 1-5-5l2-2"/>',
  infinity: '<path d="M12 12c1.6-2.2 2.8-3.3 4.4-3.3a3.3 3.3 0 0 1 0 6.6C14.8 15.3 13.6 14.2 12 12z"/><path d="M12 12c-1.6 2.2-2.8 3.3-4.4 3.3a3.3 3.3 0 0 1 0-6.6C9.2 8.7 10.4 9.8 12 12z"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5"/><path d="M3.5 9.5h17"/><path d="M8 3.5v3"/><path d="M16 3.5v3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5a13 13 0 0 1 3.4 8.5A13 13 0 0 1 12 20.5 13 13 0 0 1 8.6 12 13 13 0 0 1 12 3.5z"/>',
  settings: '<path d="M3.5 8h11.8M19.7 8h.8"/><circle cx="17.5" cy="8" r="2.2"/><path d="M3.5 16h.8M8.7 16h11.8"/><circle cx="6.5" cy="16" r="2.2"/>',
  check: '<polyline points="4 12.5 9.5 18 20 6"/>',
  flame: '<path d="M12 3.5c3 3 5 5.3 5 8.5a5 5 0 0 1-10 0c0-1.6.7-3 2-4.4.3 1.3 1 2 2 2.2-.4-2.4.3-4.4 1-6.3z"/>',
};

export const icon = (name) => `<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.25" stroke-linecap="square" stroke-linejoin="miter">${PATHS[name] || ""}</svg></span>`;

const bar = (share = 0) => `<div class="bar"><div class="bar__fill" style="width:${Math.round(share * 100)}%"></div></div>`;

/** Ряд выбора: [значение, подпись, включён?, запрос, подсказка]. */
const chips = (list, extra = "") => `<div class="chips ${extra}">${list.map(([label, on, action, hint = ""]) =>
  `<button class="chip${on ? " chip--on" : ""}" type="button" ${action}
     ${hint ? `title="${esc(hint)}"` : ""}>${esc(label)}</button>`).join("")}</div>`;

const empty = (kind) => `<div class="card">
  <h2>Учить нечего</h2>
  <p class="muted">${kind === "phrasal"
    ? "Все загруженные фразовые глаголы уже выучены."
    : "На загруженных уровнях не осталось невыученных слов. Загрузите следующий уровень — прогресс при этом не сбрасывается."}</p>
  <button class="btn btn--primary btn--wide" type="button" hx-get="/packs">Языки и уровни</button>
</div>`;

/* ── Карточка ───────────────────────────────────────────────────────────
   Одна карточка на всё приложение: слова дня, фразовые глаголы,
   бесконечный режим и повторение. Лицо — слово, оборот — перевод и пример.
   Экраны отличаются только тем, чем открывается оборот. */

/** Лицо: слово, часть речи и строка приглашения снизу. Строка есть всегда,
    даже пустая: иначе слово съезжало бы от экрана к экрану. */
const face = (item, config, invite = "") => `
  <div class="word">${esc(word(item, config.study))}</div>
  <div class="pos">${esc(posName(item.pos))}</div>
  <div class="hint">${invite}</div>`;

/** Пометка машинного перевода. */
const mt = (item, config) => isMT(item, config)
  ? ` <span class="badge" title="Машинный перевод: смысл уточняйте по примеру">mt</span>` : "";

/** Пример: сворачивается до двух строк, раскрывается по нажатию. Совпавшие
    строки — это пара «английский → английский», второй раз её не показываем. */
const exampleBlock = (item, config) => {
  const en = example(item, config.study), tr = example(item, config.lang);
  if (!en) return "";
  return `<div class="example clamped" title="Нажмите, чтобы раскрыть"
    hx-on:click="event.stopPropagation(); this.classList.toggle('clamped')">
    <div class="example__en">«${esc(en)}»</div>
    ${tr && tr !== en ? `<div class="example__tr">${esc(tr)}</div>` : ""}</div>`;
};

/** Приглашения открыть оборот: строка для переворота, кнопка для проверки. */
const INVITE = {
  turn: esc("Нажмите, чтобы посмотреть перевод"),
  peek: `<button class="btn btn--small btn--ghost peek" type="button"
    hx-on:click="event.stopPropagation(); this.closest('.day').classList.add('turned')">Подсмотреть</button>`,
  shut: "",
};

/** Единственная карточка приложения. Переворот — класс на экране: его же ждут
    кнопки ответа, поэтому они появляются вместе. `open` говорит, чем оборот
    открывается: «turn» — нажатием на карточку, «peek» — только кнопкой
    (проверка), «shut» — не открывается (сортировка: подглядывать нечего).
    `swipe` — [вправо, влево]: те же ответы, что у кнопок под карточкой. */
const flipCard = (item, config, { open = "turn", post = "", swipe } = {}) => `
<div class="stage">
  <div class="flip" ${post && swipe ? `${post} data-swipe hx-trigger="swipeleft, swiperight"
       hx-vals="js:{a: event.type === 'swiperight' ? '${swipe[0]}' : '${swipe[1]}'}"` : ""}>
    <div class="flip__inner" ${open === "turn"
      ? `hx-on:click="this.closest('.day').classList.toggle('turned')"` : ""}>
      <div class="flip__face card">${face(item, config, INVITE[open])}</div>
      <div class="flip__face flip__face--back card">
        ${face(item, config)}
        <div class="tr">${esc(meaning(item, config.lang) || "—")}${mt(item, config)}</div>
        ${exampleBlock(item, config)}
      </div>
    </div>
  </div>
</div>`;

/* ── Экран сессии ───────────────────────────────────────────────────────
   Один шаблон на все карточные экраны: шапка, карточка, шкала круга
   с подписью, кнопки. Экран меняет содержимое этих мест, но не их состав
   и не порядок — поэтому карточка не переезжает ни между этапами дня,
   ни между режимами. */

/** Шкала круга: засечка на карточку, пройденные залиты. */
const marks = (total, done) => Array.from({ length: Math.max(total | 0, 0) }, (_, i) =>
  `<span class="dot${i < done ? " done" : i === done ? " active" : ""}"></span>`).join("");

/** `left` — подпись слева, `switcher` — готовая разметка вместо неё.
    `wait` — кнопки ответа ждут открытого оборота. */
const session = ({ left = "", switcher = "", right = "", card, meter = "", lead = "", actions, wait = false }) => `
  <div class="day__head">${switcher || `<span>${esc(left)}</span>`}<span>${esc(right)}</span></div>
  ${card}
  <div class="day__meter">
    <div class="dots">${meter}</div>
    <p class="lead center">${esc(lead)}</p>
  </div>
  <div class="actions${wait ? " actions--turned" : ""}">${actions}</div>`;

/** Кнопка ответа: всё, чем отличаются экраны, — это подпись и действие. */
const answer = (post, action, label, mod = "") =>
  `<button class="btn${mod ? ` btn--${mod}` : ""}" type="button" ${post}
     hx-vals='{"a":"${action}"}'>${esc(label)}</button>`;

/* ── Хаб ────────────────────────────────────────────────────────────── */

export const home = ({ config, lines, stats, endless, closed, streak }) => `
<div class="home">
  <header class="home__head">
    <h1 class="home__title">${esc(langName(config.study))}</h1>
    <div class="home__meta">
      <span class="home__meta-item">Уровень ${esc(config.level.toUpperCase())}</span>
      <span class="home__dot"></span>
      <span class="home__meta-item">${streak ? icon("flame") : ""}${esc(streak
        ? `Стрик: ${plural(streak, "день", "дня", "дней")}`
        : closed ? "Стрик прерван" : "Стрик ещё не начат")}</span>
    </div>
  </header>

  <button class="hero" type="button" hx-get="/day/words">
    <div class="hero__top">
      <div>
        <div class="hero__label">Основной режим</div>
        <h2 class="hero__title">${esc(CONFIG.kinds.words.title)}</h2>
        <div class="hero__state">${esc(lines.words)}</div>
      </div>
      ${icon("book")}
    </div>
    <div class="hero__foot">
      <div class="hero__scale"><span>Прогресс ${esc(config.level.toUpperCase())}</span>
        <span>${stats.learned} / ${stats.total}</span></div>
      ${bar(stats.total ? stats.learned / stats.total : 0)}
    </div>
  </button>

  <div class="tiles">
    <button class="tile" type="button" hx-get="/day/phrasal">
      ${icon("link")}
      <div class="tile__body"><h3 class="tile__title">${esc(CONFIG.kinds.phrasal.title)}</h3>
        <div class="tile__state">${esc(lines.phrasal)}</div></div>
    </button>
    <button class="tile" type="button" hx-get="/endless/words">
      ${icon("infinity")}
      <div class="tile__body"><h3 class="tile__title">Бесконечный режим</h3>
        <div class="tile__state">${esc(endless === null ? "Нет загруженных слов"
          : `Без дневного лимита · впереди ${endless}`)}</div></div>
    </button>
  </div>

  <div class="hub">
    ${[["calendar", "История и повторение", closed
        ? plural(closed, "закрытый день", "закрытых дня", "закрытых дней") : "Пока пусто", "/history"],
      ["globe", "Языки и уровни",
        `${langFlag(config.study)} → ${langFlag(config.lang)} · уровень ${config.level.toUpperCase()}`, "/packs"],
      ["settings", "Настройки", "Размер дня, тема, копия данных", "/settings"],
    ].map(([mark, name, state, path]) => `
      <button class="hub__item" type="button" hx-get="${path}">
        <span class="hub__icon">${icon(mark)}</span>
        <span class="hub__body"><span class="hub__name">${esc(name)}</span>
          <span class="hub__state">${esc(state)}</span></span>
        <span class="hub__chev">→</span>
      </button>`).join("")}
  </div>
</div>`;

/* ── День: три этапа и итог ─────────────────────────────────────────── */

export function day({ day: current, item, config }) {
  if (!current) return empty("words");
  const post = `hx-post="/day/${current.kind}/answer"`;
  const stage = { sort, cards, check, done }[current.stage];
  return `<div class="day">${stage({ day: current, item, config, post })}</div>`;
}

/** Пройдено на сортировке: знакомое ушло в выученные, остальное осталось
    в наборе, а добор возвращает слово и в набор, и в очередь. */
const sorted = (day) => day.known.length + day.set.length - day.queue.length;

const sort = ({ day, item, config, post }) => session({
  left: "Этап 1 из 3 · знакомо?",
  right: formatDate(day.date),
  card: flipCard(item, config, { open: "shut", post, swipe: ["know", "skip"] }),
  meter: marks(day.size || day.set.length + day.known.length, sorted(day)),
  lead: "«Знаю» — слово сразу считается выученным и заменяется другим.",
  actions: answer(post, "skip", "Не знаю", "bad") + answer(post, "know", "Знаю", "good"),
});

const cards = ({ day, item, config, post }) => session({
  left: "Этап 2 из 3 · карточки",
  right: formatDate(day.date),
  card: flipCard(item, config, { post, swipe: ["ok", "repeat"] }),
  meter: marks(day.round, day.done),
  lead: "«Ещё раз» отправит карточку в конец круга.",
  actions: answer(post, "repeat", "Ещё раз") + answer(post, "ok", "Знаю", "good"),
  wait: true,
});

const check = ({ day, item, config, post }) => session({
  left: "Этап 3 из 3 · проверка",
  right: formatDate(day.date),
  card: flipCard(item, config, { open: "peek", post, swipe: ["yes", "no"] }),
  meter: marks(day.round, day.round - day.queue.length),
  lead: "Помните перевод?",
  actions: answer(post, "no", "Нет", "bad") + answer(post, "yes", "Да", "good"),
});

const done = ({ day, config }) => `
  <div class="done-hero">
    <div class="done-hero__mark">${icon("check")}</div>
    <h2 class="done-hero__title">Готово на сегодня</h2>
    <p class="muted done-hero__date">${esc(formatDate(day.date))}</p>
  </div>
  ${day.parts.total ? tally(day.parts) + wordList(day.parts, config)
    : '<p class="muted center">Сегодня закрывать было нечего.</p>'}
  <div class="actions">
    <button class="btn" type="button" hx-get="/review/${day.date}/${day.kind}">Повторить</button>
    <button class="btn btn--primary" type="button" hx-get="/home">На главную</button>
  </div>`;

/** Двойной счёт крупными цифрами. Пустая половина не рисуется: ноль в итоге
    дня ничего не сообщает. */
export function tally({ fresh, known }, closed = true) {
  const cell = (mod, n, label) => `<div class="tally__cell tally__cell--${mod}">
    <div class="tally__num">${n}</div><div class="tally__label">${esc(label)}</div></div>`;
  return `<div class="tally">
    ${fresh.length || !known.length ? cell("fresh", fresh.length, closed ? "новых" : "в наборе") : ""}
    ${fresh.length && known.length ? '<div class="tally__plus">+</div>' : ""}
    ${known.length ? cell("known", known.length, "знакомых") : ""}</div>`;
}

/** Список дня двумя группами: знакомое идёт вторым и тише — оно тоже закрыто,
    но взгляду задерживаться на нём незачем. */
export function wordList({ fresh, known }, config, closed = true) {
  const group = (title, items, dim) => !items.length ? "" : `
    <div class="words-group">
      <div class="words-group__title"><span>${esc(title)}</span><span>${items.length}</span></div>
      <div class="words-list">${items.map((item) => `
        <div class="word-row${dim ? " word-row--known" : ""}">
          <span class="word-row__en">${esc(word(item, config.study))}</span>
          <span class="word-row__tr">${esc(meaning(item, config.lang) || "—")}</span>
        </div>`).join("")}</div>
    </div>`;
  return `<div class="words-groups">
    ${group(closed ? "Выучено сегодня" : "Набор дня", fresh, false)}
    ${group("Уже были знакомы", known, true)}</div>`;
}

/* ── Бесконечный режим ──────────────────────────────────────────────── */

/* Тот же шаблон, что у дня: переключатель вида занимает в шапке место
   подписи этапа, а шкала круга — пустая, круга здесь нет. */
export const endless = ({ kind, level, item, config, learned, left, again }) => {
  const switcher = chips(Object.entries(CONFIG.kinds).map(([name, meta]) =>
    [meta.short, name === kind, `hx-get="/endless/${name}"`]));
  if (!item) return `<div class="day"><div class="day__head">${switcher}</div>${empty(kind)}</div>`;
  const post = `hx-post="/endless/${kind}/answer"`;
  return `<div class="day">${session({
    switcher,
    right: `${kind === "words" && level ? `${level.toUpperCase()} · ` : ""}выучено ${learned} · осталось ${left}`,
    card: flipCard(item, config, { post, swipe: ["ok", "repeat"] }),
    lead: again
      ? `${plural(again, "карточка вернётся", "карточки вернутся", "карточек вернутся")} ещё раз`
      : "Режим без дневного лимита: карточки идут, пока не остановитесь.",
    actions: answer(post, "repeat", "Ещё раз") + answer(post, "ok", "Знаю", "good"),
    wait: true,
  })}</div>`;
};

/* ── История и повторение ───────────────────────────────────────────── */

const STAGE_TEXT = { sort: "сортировка", cards: "карточки", check: "проверка" };

export const history = (days) => !days.length ? `
  <div class="card center">
    <p>История пока пуста.</p>
    <p class="muted">Закройте первый день — он появится здесь.</p>
    <button class="btn btn--primary btn--wide" type="button" hx-get="/day/words">Начать день</button>
  </div>` : `
  <div class="list">
    <header class="page-head"><h1>История</h1></header>
    ${[...new Set(days.map((d) => d.date))].map((date) => `
      <h2 class="section-title">${esc(formatDate(date))}</h2>
      ${days.filter((d) => d.date === date).map((entry) => `
        <button class="row" type="button" hx-get="/history/${entry.date}">
          <span class="hub__icon">${icon(CONFIG.kinds[entry.kind]?.icon || "book")}</span>
          <span class="row__body">
            <span class="row__title">${esc(CONFIG.kinds[entry.kind]?.title || entry.kind)}</span>
            <span class="row__sub">${esc(entry.stage === "done" ? scoreLine(entry)
              : `не закончен · ${STAGE_TEXT[entry.stage] || entry.stage}`)}</span>
          </span>
          <span class="row__chev">→</span>
        </button>`).join("")}`).join("")}
  </div>`;

export const historyDay = ({ date, entries, config }) => `
  <div class="list">
    <header class="page-head"><h1>${esc(formatDate(date))}</h1>
      <button class="page-head__back" type="button" hx-get="/history">‹ Все дни</button></header>
    ${entries.map(({ day, parts }) => `
      <div class="card">
        <div class="row__title">${esc(CONFIG.kinds[day.kind]?.title || day.kind)}</div>
        <div class="row__sub">${day.stage === "done" ? "День закрыт" : "День не закончен"}</div>
        ${parts.total ? `<div style="margin-top:12px">${tally(parts, day.stage === "done")}
          ${wordList(parts, config, day.stage === "done")}</div>`
          : '<p class="muted" style="margin-top:10px">Набор этого дня пуст.</p>'}
        <div class="actions">
          <button class="btn" type="button" ${parts.total ? "" : "disabled"}
            hx-get="/review/${day.date}/${day.kind}">Повторить</button>
          <button class="btn btn--danger" type="button" hx-post="/history/${day.date}/delete"
            hx-vals='{"kind":"${day.kind}"}'
            hx-confirm="Удалить этот день? Запись о дне исчезнет из истории, но выученные слова останутся выученными — прогресс хранится отдельно.">Удалить день</button>
        </div>
      </div>`).join("")}
  </div>`;

export const review = ({ kind, date, item, config, index, total }) => !item ? `
  <div class="card"><p>Нечего повторять: слова этого дня не загружены.</p>
    <p class="muted">Пакет был удалён. Прогресс сохранён, вернуть слова можно в «Языках и уровнях».</p></div>` : `
  <div class="day">${(() => {
    const post = `hx-post="/review/${date}/${kind}/step"`;
    return session({
      left: CONFIG.kinds[kind]?.title || kind,
      right: formatDate(date),
      card: flipCard(item, config, { post, swipe: ["next", "back"] }),
      meter: marks(total, index),
      lead: "Повторение идёт кругом и прогресс не меняет.",
      actions: `<button class="btn" type="button" ${index ? "" : "disabled"}
          ${post} hx-vals='{"a":"back"}'>Назад</button>
        ${answer(post, "next", index + 1 < total ? "Дальше" : "Ещё круг", "primary")}`,
    });
  })()}</div>`;

/* ── Языки и уровни ─────────────────────────────────────────────────── */

const langRow = (value, other, onPick) => chips(Object.keys(CONFIG.langs).map((code) => {
  // Одинаковая пара бессмысленна — кроме английского: English → English
  // это толкование, а не тот же самый текст.
  const blocked = code === other && code !== "en";
  return [langName(code), code === value,
    `${blocked ? "disabled" : `hx-post="${onPick}" hx-vals='{"code":"${code}"}'`}`,
    blocked ? "Слово и перевод совпали бы" : ""];
}));

export const packs = ({ config, rows, error }) => `
  <div class="list">
    <header class="page-head"><h1>Языки и уровни</h1></header>
    ${navigator.onLine === false ? `<div class="card"><div class="row__title">Нет подключения</div>
      <p class="muted" style="margin:4px 0 0">Загрузка и сборка пакетов недоступны.
      Уже загруженные пакеты работают как обычно.</p></div>` : ""}
    ${error ? `<div class="card"><div class="row__title">Каталог недоступен</div>
      <p class="muted" style="margin:4px 0 0">${esc(error)}</p></div>` : ""}

    <h2 class="section-title">Изучаю</h2>
    ${langRow(config.study, config.lang, "/packs/study")}
    <h2 class="section-title">Перевод</h2>
    ${langRow(config.lang, config.study, "/packs/lang")}
    <h2 class="section-title">Уровень слов дня</h2>
    ${chips(CONFIG.levels.map((level) => [level.toUpperCase(), level === config.level,
      `hx-post="/packs/level" hx-vals='{"code":"${level}"}'`, CONFIG.levelHints[level]]))}
    <p class="lead">${esc(CONFIG.levelHints[config.level] || "")}</p>

    <h2 class="section-title">Пакеты</h2>
    ${rows.map((row) => `
      <div class="row row--static">
        <span class="row__body">
          <span class="row__title">${esc(levelName(row.level))}
            ${row.active ? '<span class="badge" title="Слова дня берутся отсюда">активный</span>' : ""}</span>
          <span class="row__sub">${esc(row.sub)}</span>
        </span>
        <span class="row__side">
          ${row.missing.length ? `
            <button class="btn btn--small btn--primary" type="button" hx-post="/packs/install"
              hx-vals='{"level":"${row.level}"}' ${navigator.onLine === false ? "disabled" : ""}
            >${row.missing.every((p) => p.entry) ? "Загрузить" : "Собрать"}</button>` : `
            ${row.stale.length ? `<button class="btn btn--small btn--primary" type="button"
              hx-post="/packs/install" hx-vals='{"level":"${row.level}"}'>Обновить</button>` : ""}
            ${row.kind === "words" && !row.active ? `<button class="btn btn--small" type="button"
              hx-post="/packs/level" hx-vals='{"code":"${row.level}"}'>Сделать активным</button>` : ""}
            ${row.parts.some((p) => p.have) ? `<button class="btn btn--small btn--danger" type="button"
              hx-post="/packs/uninstall" hx-vals='{"level":"${row.level}"}'
              hx-confirm="Удалить пакет ${esc(levelName(row.level))}? Слова уровня исчезнут из базы, но прогресс останется: поставите заново — выученное так и будет выученным."
            >Удалить</button>` : ""}`}
        </span>
      </div>`).join("")}

    <p class="lead">Пакет — это записи одного уровня на одном языке: слово, перевод и пример.
    Карточке нужны две стороны, поэтому пара языков может требовать двух пакетов. Готовые
    пакеты скачиваются файлом, остальные собираются здесь переводом английских слов
    и примеров — такие записи помечены «mt». Прогресс хранится отдельно от пакетов,
    поэтому смена языков или удаление пакета его не стирают.</p>
  </div>`;

/* ── Настройки ──────────────────────────────────────────────────────── */

export const settings = ({ config, totals }) => {
  const total = Object.values(config.per).reduce((sum, n) => sum + n, 0);
  const tooMuch = total > CONFIG.recommendedTotal;
  const sizes = (kind) => chips(CONFIG.kinds[kind].sizes.map((n) =>
    [String(n), config.per[kind] === n, `hx-post="/settings/size" hx-vals='{"kind":"${kind}","n":"${n}"}'`]));

  return `<div class="list">
    <header class="page-head"><h1>Настройки</h1></header>

    <h2 class="section-title">Размер дня</h2>
    <div class="card">
      ${Object.entries(CONFIG.kinds).map(([kind, meta]) =>
        `<div class="row__title" style="margin-top:8px">${esc(meta.title)} в день</div>${sizes(kind)}`).join("")}
      <p class="${tooMuch ? "warn" : "muted"}" style="margin:12px 0 0;font-size:13px">
        Всего ${esc(plural(total, "запись", "записи", "записей"))} в день.
        ${tooMuch ? `Рекомендуем не больше ${CONFIG.recommendedTotal} в сумме: большой набор
          закрывается через раз, и прогресс идёт медленнее.` : `Рекомендуемый потолок — ${CONFIG.recommendedTotal} в сумме.`}</p>
      <p class="muted" style="margin:6px 0 0;font-size:13px">Новый размер применится
        к следующему дню — начатый день не меняется.</p>
    </div>

    <h2 class="section-title">Тема</h2>
    <div class="card">
      ${chips(CONFIG.themes.map(([value, label]) =>
        [label, config.theme === value, `hx-post="/settings/theme" hx-vals='{"value":"${value}"}'`]))}
      <p class="muted" style="margin:10px 0 0;font-size:13px">«Как в системе» следует
        за настройкой телефона или браузера.</p>
    </div>

    <h2 class="section-title">Мои данные</h2>
    <div class="card">
      <div class="row__title">Копия данных</div>
      <p class="muted" style="margin:4px 0 6px;font-size:13px">В базе:
        ${esc(plural(totals.items, "запись", "записи", "записей"))}, выучено ${totals.learned},
        дней в истории ${totals.days}.</p>
      <p class="muted" style="margin:0 0 10px;font-size:13px">Импорт принимает только .json:
        файл копии базы или файл-пакет вида packs/&lt;язык&gt;/&lt;уровень&gt;.json.</p>
      <div class="actions" style="margin-top:0">
        <button class="btn" type="button" hx-post="/settings/export">Экспорт</button>
        <button class="btn" type="button"
          hx-on:click="this.nextElementSibling.click()">Импорт</button>
        <input type="file" accept="application/json,.json" hidden
          hx-post="/settings/import" hx-trigger="change" hx-encoding="multipart/form-data">
      </div>
    </div>

    <h2 class="section-title">Удаление</h2>
    <div class="card">
      <button class="btn btn--wide btn--danger" type="button" hx-post="/settings/clear-history"
        hx-confirm="Удалить всю историю? Исчезнут все дни. Выученные слова останутся выученными — прогресс хранится отдельно. Перед удалением лучше сделать экспорт.">Удалить всю историю</button>
      <button class="btn btn--wide btn--danger" type="button" style="margin-top:10px"
        hx-post="/settings/reset"
        hx-confirm="Полный сброс? База удаляется целиком: слова, прогресс, история и настройки. Отменить нельзя.">Полный сброс</button>
    </div>

    <div class="card">
      <button class="btn btn--wide btn--ghost" type="button" hx-post="/settings/onboarding">
        Показать вводные экраны заново</button>
    </div>
  </div>`;
};

/* ── Справка и знакомство ───────────────────────────────────────────── */

export const help = () => `
  <div class="card help">
    <h3>Три этапа дня</h3>
    <ol>
      <li>Сортировка. «Знаю» — слово сразу уходит в выученные и заменяется другим;
        «не знаю» — остаётся в наборе дня.</li>
      <li>Карточки. Нажатие переворачивает карточку: видно перевод и пример.
        «Ещё раз» отправляет её в конец круга.</li>
      <li>Проверка. Те же слова без перевода. Что не вспомнилось — возвращается
        в карточки новым кругом; чистый круг закрывает день.</li>
    </ol>
    <h3>Бесконечный режим</h3>
    <p>Тот же материал без дневного набора и без этапов. Прогресс общий с днями,
      но в историю бесконечный режим не попадает — история про закрытые дни.</p>
    <h3>Языки и уровни</h3>
    <p>Слова приходят пакетами: один пакет — один язык и один уровень. Пакет
      скачивается один раз, дальше интернет не нужен.</p>
    <p>Языков два: «Изучаю» — лицевая сторона карточки, «Перевод» — оборот. Пара может
      требовать двух пакетов сразу; кнопка в строке уровня приносит всё, чего не хватает.
      Отдельный случай — English → English: на обороте не перевод, а толкование.</p>
    <p>Готового файла для языка может не быть — тогда приложение собирает пакет само,
      переводя английские слова и примеры. Такие записи помечены «mt».</p>
    <h3>Данные и приватность</h3>
    <p>Прогресс, история и слова хранятся только в этом браузере (IndexedDB): без аккаунта
      и без отправки наружу. «Настройки» → «Копия данных» сохраняет всё одним файлом.</p>
    <div class="actions">
      <button class="btn btn--primary btn--wide" type="button" hx-get="/home">Понятно</button>
    </div>
  </div>`;

const STEPS = [
  { mark: "I", title: "Слова по уровням", text: "Каждый день — небольшой набор слов вашего уровня CEFR. Фразовые глаголы идут отдельным занятием, устроенным точно так же." },
  { mark: "II", title: "Три этапа дня", text: "Сначала отсеиваете знакомое, потом учите карточками, потом проверяете себя. Что не вспомнилось — вернётся в карточки, пока круг не будет чистым." },
  { mark: "III", title: "Языки и уровень", text: "Выберите язык, который изучаете, язык перевода и свой уровень — нужные пакеты загрузятся сразу. Менять выбор можно когда угодно, прогресс не сбрасывается.", choice: true },
  { mark: "IV", title: "Данные остаются у вас", text: "Прогресс и история хранятся в этом браузере, без аккаунта и без отправки наружу. Копию можно сохранить файлом в настройках." },
];

export const onboarding = ({ step, config, status }) => {
  const current = STEPS[step];
  return `<div class="onboarding">
    <div class="onboarding__mark">${current.mark}</div>
    <h2 class="onboarding__title">${esc(current.title)}</h2>
    <p class="onboarding__text">${esc(current.text)}</p>
    ${current.choice ? `<div class="choice">
      <div class="choice__label">Изучаю</div>${langRow(config.study, config.lang, "/packs/study?step=2")}
      <div class="choice__label">Перевод</div>${langRow(config.lang, config.study, "/packs/lang?step=2")}
      <div class="choice__label">Ваш уровень</div>
      ${chips(CONFIG.levels.map((level) => [level.toUpperCase(), level === config.level,
        `hx-post="/packs/level?step=2" hx-vals='{"code":"${level}"}'`, CONFIG.levelHints[level]]))}
      <p class="choice__hint">${esc(CONFIG.levelHints[config.level] || "")}</p>
      <p class="choice__status">${esc(status || "")}</p>
    </div>` : ""}
    <div class="onboarding__dots">${STEPS.map((_, i) =>
      `<span class="dot${i === step ? " active" : i < step ? " done" : ""}"></span>`).join("")}</div>
    <div class="actions">
      <button class="btn" type="button" hx-post="/onboarding/finish">Пропустить</button>
      ${step + 1 < STEPS.length
        ? `<button class="btn btn--primary" type="button" hx-get="/onboarding?step=${step + 1}">Дальше</button>`
        : '<button class="btn btn--primary" type="button" hx-post="/onboarding/finish">Начать</button>'}
    </div>
  </div>`;
};

/** Полоса для долгих дел — живёт в диалоге, его двигает src/app.js. */
export const progress = (title) => `<div class="modal__box">
  <h2 class="modal__title">${esc(title)}</h2>
  <p class="modal__text" data-note>Готовим…</p>
  ${bar(0)}
  <div class="modal__actions" style="margin-top:16px">
    <button class="btn" type="button" data-cancel>Отмена</button>
  </div></div>`;
