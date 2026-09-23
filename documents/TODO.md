# Глава III. Архитектура: как есть и как переписать

> Цель — чтобы язык, уровень, вид карточек, этап дня или режим повторения
> добавлялись правкой конфига и одного модуля, а не поиском по всему `src/`.

**Коротко.** Стек не меняем: статика, нативные ES-модули, IndexedDB, без сборщика
и без зависимостей. Меняем три вещи:
1. всё настраиваемое — в один `config.json` (его читают и приложение, и `tools/`);
2. логика — в чистый слой `core/` без DOM и базы, покрытый тестами `node --test`;
3. день — не жёсткий `sort → cards → check`, а список этапов из конфига.

---

## 1. Как устроено сейчас

```
index.html ─ main.js ─ nav.js ─ screens/*  ─┬─ ui.js, flip.js, choose.js
                                            ├─ session.js ─ progress.js ─┐
                                            ├─ packs.js ─ translate.js ──┼─ db.js ─ IndexedDB
                                            └─ settings.js, backup.js ───┘
sw.js — кэш оболочки        tools/build-packs.py — офлайн-сборка packs/*.json
```

| Модуль | Отвечает за |
|---|---|
| `db.js` | IndexedDB: 5 сторов, `transact`, CRUD |
| `packs.js` | каталог, установка, удаление, сборка пакета в браузере + **справочники языков и уровней** |
| `session.js` | движок дня (3 этапа), счёт, стрик, **строки для хаба** |
| `progress.js` | статусы `learning / learned`, пул, статистика |
| `lang.js` | стороны карточки: `word / meaning / example / origin` |
| `nav.js` | hash-роутер, **таблица маршрутов**, боковая панель |
| `ui.js` | `el()`, значки, 3 модалки, даты, `plural`, свайп |
| `screens/*` | 14 экранов, каждый `render(ctx) → Node` |

**Данные.** Запись — `id = "en|pos"`, английский опорный, переводы — карты по языкам:
`{ en, pos, level, kind, tr:{ru,…}, exEn, exTr:{ru,…}, src:{ru:"ok"|"mt"} }`.
Прогресс отдельно: `{ id, status, firstShown, learnedAt, reviews }`.
Сессия дня — вся очередь целиком (`sortQueue, cardQueue, checkQueue, checkFailed, …`).

**Что сделано хорошо и остаётся:** контент и прогресс в разных сторах; один движок
на все виды; пакеты как единица установки; офлайн; двойной счёт дня.

---

## 2. Что мешает

| # | Проблема | Где | Чем плохо |
|---|---|---|---|
| 1 | Настройки размазаны по коду | `LEVELS` (packs.js + build-packs.py), `LANG_NAMES/FLAGS/LANGS` (packs.js), `KINDS` (session.js), размеры дня (settings.js), `ROUTES` (nav.js) + меню (index.html), `AGAIN_AFTER` (endless.js), параметры перевода (translate.js), `SHELL` (sw.js) | новый язык = правка 3–4 файлов на двух языках программирования |
| 2 | `"phrasal"` захардкожен 14 раз в 7 файлах | `level === "phrasal" ? "phrasal" : "words"` | новый вид карточек (например, «картинка → слово» из TODO) не добавить без раскопок |
| 3 | ~300 строк интерфейса по-русски прямо в коде | все экраны, `packs.js`, `session.stateLine` | нет второго языка интерфейса; домен возвращает готовый русский текст |
| 4 | Слои перемешаны | `session.js` берёт `scoreLine` из `ui.js`; `endless.js`, `review.js` ходят в `db` напрямую; справочники UI в `packs.js` | логику не протестировать без браузера |
| 5 | Этапы дня зашиты | `session.js`: 14 полей очереди, переходы в коде | новый этап = переписать движок |
| 6 | Дубли | 3 модалки в `ui.js`; 3 полосы прогресса (`main.js`, `ui.js`, `screens/packs.js`); «Учить нечего» в `day.js` и `endless.js`; очередь карточек в `session`, `endless`, `review` | правка в одном месте не доезжает до другого |
| 7 | Лишние полные проходы по базе | хаб: `pickLevel` → `poolFor` по каждому уровню, `levelStats` ×2, `history` ×2; `packs.write` делает `get` на каждую запись | медленный хаб, установка «секундами» |
| 8 | Модель повторения — только «выучено навсегда» | `progress.js`; `releaseLearning` удаляет строки вместе с `reviews` | нет интервального повторения, теряется счётчик |
| 9 | `SHELL` в `sw.js` ведётся руками | `sw.js:19` | забыл файл — офлайн сломан |
| 10 | Нет `.gitignore`, тестов, проверок | корень | `.DS_Store` в git, регрессии ловятся глазами |

**Два бага, чинить сразу:**
- `nav.js:92` — пока идёт `render()`, новый `hashchange` просто теряется: быстрый клик
  по меню оставит старый экран при новом адресе. Лечится счётчиком: запомнить
  «нужен ещё рендер» и повторить после `finally`.
- `cards.js:17`, `check.js:17` — `return ctx.refresh()` внутри `render`: из-за флага
  `rendering` вернётся `undefined`, и на экран попадёт текст «undefined»
  (случай: пакет удалили посреди дня). Экран должен вернуть узел, а не звать роутер.

---

## 3. Целевая архитектура

### 3.1. Пять правил

1. **Конфиг — данные, код — поведение.** Всё, что можно перечислить (языки, уровни,
   виды, этапы, размеры, маршруты), лежит в `config.json`. В коде нет литералов
   `"phrasal"`, `"b1"`, `10`.
2. **Зависимости идут вниз:** `screens → ui, data → core`. `core` не импортирует
   ничего, кроме `config`. Проверяется grep’ом (§4, шаг 4).
3. **Расширение — через реестр.** Этап, планировщик, переводчик, экран — модуль
   с одним интерфейсом и строка в реестре. Выбор — по имени из конфига.
4. **Один способ на одно действие:** одна модалка, одна полоса, одна очередь,
   один `t()` для строк.
5. **Настройки пользователя — поверх конфига:** в базе лежит только отличие
   от `config.defaults`.

### 3.2. Папки

```
config.json            всё настраиваемое; читают app и tools/
i18n/ru.json           строки интерфейса (en.json — когда понадобится)
src/
  app.js               сборка: конфиг → база → роутер (бывший main.js)
  core/                чистая логика: без DOM, без IndexedDB, без await
    lang.js            стороны карточки
    day.js             движок дня: step(day, action) → { day, effects }
    stages/            sort.js, cards.js, check.js (+ новые)
    schedulers/        simple.js (как сейчас), leitner.js
    pick.js            пул → набор: фильтр, «сначала с примером», перемешать
    stats.js           счёт дня, стрик, статистика уровня
    i18n.js            t(key, vars), plural и даты через Intl
  data/
    db.js              IndexedDB + миграции по версиям
    repo.js            ЕДИНСТВЕННОЕ место с запросами к сторам
    packs.js           каталог, установка, удаление, локальная сборка
    translators/       google-gtx.js (+ другие провайдеры)
    backup.js
  ui/
    dom.js             el, clear, icon
    kit.js             modal, progressBar, emptyState, chips
    flip.js, swipe.js
    router.js          маршруты и меню — из config.nav
  screens/             index.js (реестр) + по файлу на экран
tests/                 *.test.js — node --test, без зависимостей
tools/                 build-packs.py читает config.json; check.sh — проверки
```

### 3.3. `config.json`

```json
{
  "levels": ["a1", "a2", "b1", "b2", "c1", "c2"],
  "langs": {
    "en": { "flag": "🇬🇧" }, "ru": { "flag": "🇷🇺" }, "es": { "flag": "🇪🇸" },
    "de": { "flag": "🇩🇪" }, "fr": { "flag": "🇫🇷" }
  },
  "kinds": {
    "words":   { "levels": "*",         "flow": ["sort", "cards", "check"],
                 "sizes": [5, 7, 10, 12], "icon": "book" },
    "phrasal": { "levels": ["phrasal"], "flow": ["sort", "cards", "check"],
                 "sizes": [3, 5, 7],      "icon": "link" }
  },
  "defaults": { "study": "en", "lang": "ru", "level": "b1", "theme": "auto", "ui": "ru",
                "perDay": { "words": 10, "phrasal": 5 } },
  "day":      { "recommendedTotal": 15, "examplesFirst": true },
  "endless":  { "againAfter": 4 },
  "scheduler": "simple",
  "translator": { "use": "google-gtx", "batchLines": 20, "batchChars": 900,
                  "parallel": 4, "retries": 3 },
  "packs":    { "schema": 2, "catalog": "packs/index.json",
                "starter": ["{level}", "phrasal"] },
  "nav": [
    { "route": "/home",               "screen": "home",       "chrome": "panel", "menu": "book" },
    { "route": "/day/:kind",          "screen": "day",        "chrome": "top" },
    { "route": "/endless/:kind",      "screen": "endless",    "chrome": "top" },
    { "route": "/history",            "screen": "history",    "chrome": "panel", "menu": "calendar" },
    { "route": "/history/:date",      "screen": "history",    "chrome": "panel" },
    { "route": "/review/:date/:kind", "screen": "review",     "chrome": "top" },
    { "route": "/packs",              "screen": "packs",      "chrome": "panel", "menu": "globe" },
    { "route": "/settings",           "screen": "settings",   "chrome": "panel", "menu": "settings" },
    { "route": "/help",               "screen": "help",       "chrome": "top" },
    { "route": "/onboarding",         "screen": "onboarding", "chrome": "none" }
  ]
}
```

Названия языков, уровней, видов и пунктов меню — не здесь, а в `i18n/ru.json`
по ключам `lang.ru`, `level.b1`, `kind.phrasal`, `nav.home`: конфиг не зависит от
языка интерфейса. Подключение без сборщика:

```js
import config from "../config.json" with { type: "json" };
```

### 3.4. Интерфейсы

```js
// screens/<name>.js — экран
export default {
  title: (ctx) => t("day.title"),
  async render(ctx) { return el("div.day"); },   // всегда Node, роутер не зовёт
  dispose() {},                                  // необязательно: снять слушатели
};

// core/stages/<name>.js — этап дня (чистые функции)
export default {
  start(day, ids)   { return { ...day, queue: ids }; },
  current(day)      { return day.queue[0] ?? null; },
  answer(day, ok)   { return { day, effects: [], next: null }; },
  // next: null — этап идёт; "done" — дальше по flow; { goto: "cards", ids } — вернуться
};

// core/schedulers/<name>.js — когда слово вернётся
export default {
  onAnswer(row, ok, date) { return row; },       // обновить box / due
  isDue(row, date)        { return false; },     // попадёт ли в пул
};

// data/translators/<name>.js — провайдер перевода
export default async function translate(lines, lang, { signal }) { return lines; }
```

**Движок дня** становится редьюсером. `core/day.js` решает, что будет дальше,
а `repo` только записывает:

```js
const { day: next, effects } = step(day, { type: "answer", ok }, config);
await repo.apply(effects);          // [{ mark: id, status }, { touch: id }]
await repo.saveDay(next);
```

Сессия в базе вместо 14 полей: `{ id, date, kind, level, size, stage, queue,
round, set, known, failed }`. Какой этап идёт, решает `kinds[kind].flow[stage]`.

### 3.5. Данные v2

| Что | Было | Станет |
|---|---|---|
| Пакет | `items: [[en,pos,tr,exEn,exTr,src]]` | + `"fields": ["en","pos","tr","exEn","exTr","src"]`; схема 1 читается как раньше |
| `kind` записи | вычисляется из `level` | берётся из `pack.kind` |
| `progress` | `status, reviews, learnedAt` | + `box`, `due`; `releaseLearning` больше не удаляет строки |
| Настройки | полная копия дефолтов | только отличия от `config.defaults` |
| Миграции | нет | `db.js`: `MIGRATIONS = { 2: (tx) => … }`, ключи `en|pos` не меняются → старые копии данных импортируются |

---

## 4. Как переписать руками

Каждый шаг — отдельный коммит, после которого приложение работает. Порядок важен:
сначала переносим и проверяем, потом меняем поведение.

**Шаг 0. Гигиена** (15 мин)
- `.gitignore`: `.DS_Store`, `tools/.venv/`, `tools/.cache/`; `git rm --cached packs/.DS_Store tools/.DS_Store`.
- `tests/smoke.test.js` с одним `assert.ok(true)`; запуск — `node --test tests/`.
- Починить два бага из §2.
- ✔ `python3 serve.py`, пройти день целиком.

**Шаг 1. `config.json`** (1 ч) — только перенос, логика не меняется.
- Перенести `LEVELS, LANGS, LANG_FLAGS, KINDS, WORD_SIZES, PHRASAL_SIZES,
  RECOMMENDED_TOTAL, DEFAULTS, AGAIN_AFTER, ROUTES`, параметры `translate.js`.
- `build-packs.py`: `LEVELS = json.load(open(ROOT/"config.json"))["levels"]`.
- ✔ `grep -rnE 'LEVELS =|LANG_NAMES =|KINDS =|ROUTES =' src` → пусто.

**Шаг 2. Виды из конфига** (1 ч)
- `kindOf(level)` и все `level === "phrasal"` → `pack.kind` / `config.kinds[kind].levels`.
- `perDay(settings, kind)` → `settings.perDay[kind]`; миграция старых
  `wordsPerDay/phrasalPerDay` при чтении настроек.
- ✔ `grep -rn '"phrasal"' src` → пусто.

**Шаг 3. Строки интерфейса** (2–3 ч, по экрану за раз)
- `core/i18n.js`: `t("home.streak", { n })`, `plural` через `Intl.PluralRules("ru")`,
  даты через `Intl.DateTimeFormat` — свои `plural` и `MONTHS` уходят.
- `session.stateLine` возвращает данные (`{ phase, left, size }`), текст собирает экран.
- ✔ `grep -rnE '"[^"]*[А-Яа-яЁё]' src` → пусто.

**Шаг 4. Слой `core/`** (2 ч)
- Вынести без изменений: `lang.js`, `score/streak` → `stats.js`,
  `withExamplesFirst + shuffle` → `pick.js`, `todayISO/shiftDate` → `core/dates.js`.
- `shuffle` принимает `random` параметром — тесты детерминированы.
- Тесты: `lang` (пара en→en), `streak` (вчера не рвёт), `plural` (1, 2, 5, 11, 21).
- ✔ `grep -rnE "from ['\"]\.\./(data|ui)|indexedDB|document\." src/core` → пусто.

**Шаг 5. Движок дня** (3–4 ч) — самый важный шаг.
- `core/day.js` + `core/stages/{sort,cards,check}.js` по интерфейсу §3.4.
- `session.js` становится тонкой обёрткой: загрузить → `step` → `apply` → сохранить.
- Старые сессии: при чтении перевести поля (`phase → stage`, `cardQueue → queue` …).
- Тесты сценариев: всё знакомо → день закрыт; одна ошибка на проверке → новый круг
  карточек; «знаю» на сортировке добирает набор; повторный `present` не считает повтор.
- ✔ тесты зелёные; день в браузере проходится так же, как до шага.

**Шаг 6. `data/repo.js`** (2 ч)
- Все `db.get/getAll/indexAll` из экранов и `session/progress` → методы `repo`:
  `pool(kind, level, pair)`, `levelStats`, `day(kind, date)`, `history()`.
- `packs.write`: один `getAll` по `kind_level`, потом `put` пачкой — без `get` на запись.
- Хаб: один `repo.snapshot()` на рендер вместо 7 проходов.
- ✔ `grep -rn "db\." src/screens` → пусто.

**Шаг 7. `ui/kit.js` и роутер** (2 ч)
- `modal({ title, text, actions, cancelable })` — одна вместо трёх.
- `progressBar()` — одна для старта, модалки и экрана пакетов.
- `emptyState(kind)` — одно «Учить нечего».
- `ui/router.js` строит маршруты и боковое меню из `config.nav`; в `index.html`
  остаётся пустой `<nav class="side__nav">`. Роутер зовёт `dispose()` у старого экрана.
- Убрать проп `html` из `el()` — innerHTML остаётся только в `icon()`.

**Шаг 8. Service worker** (30 мин)
- `tests/sw.test.js`: каждый `.js/.css/.json` из `src/`, `styles/`, `i18n/`, `config.json`
  есть в `SHELL`. Забыл файл — тест красный.

**Шаг 9. Пакеты v2 и переводчики** (1–2 ч)
- `build-packs.py` пишет `"schema": 2, "fields": [...]`; приложение читает обе схемы.
- `translate.js` → `data/translators/google-gtx.js`; выбор по `config.translator.use`.

**Шаг 10. Интервальное повторение** (3 ч) — первая фича на новой архитектуре.
- Миграция БД v2: `progress.box/due`.
- `schedulers/simple.js` — ровно текущее поведение; `leitner.js` — коробки
  через 1, 2, 4, 8, 16 дней.
- `repo.pool` = невыученное + `scheduler.isDue(row, today)`.
- Переключатель в настройках пишет `scheduler` в пользовательские настройки.

**Шаг 11. Уборка**
- `tools/legacy/` и `import-legacy.py` — удалить: импорт разовый, данные уже
  в `tools/data/`, история в git.
- README: раздел «Структура» заменить ссылкой на эту главу.

`tools/check.sh` собирает все grep-проверки из шагов 1–6 и `node --test tests/` —
запускать перед каждым коммитом.

---

## 5. Рецепты после переписывания

| Хочу | Правлю |
|---|---|
| Новый язык | `config.langs` + `i18n/ru.json → lang.xx`. Пакета нет — соберётся в приложении |
| Новый уровень / набор | `config.levels` или `kinds.X.levels` + файл в `packs/` |
| Вид «картинка → слово» | `config.kinds.images` + `core/stages/image.js` + поле `img` в `fields` пакета |
| Этап дня | модуль в `core/stages/` + имя в `kinds.X.flow` |
| Размеры дня | `kinds.X.sizes`, `defaults.perDay` |
| Режим повторения | модуль в `core/schedulers/` + `config.scheduler` |
| Другой переводчик | модуль в `data/translators/` + `config.translator.use` |
| Экран | файл в `screens/` + строка в `screens/index.js` + маршрут в `config.nav` |
| Язык интерфейса | `i18n/en.json` + `defaults.ui` |

## 6. Чего не делаем

- Фреймворк, сборщик, npm-зависимости — текущий размер их не оправдывает.
- TypeScript — вместо него `// @ts-check` и JSDoc-типы в `core/`: VS Code проверит без сборки.
- Синхронизацию через сервер — перенос прогресса описан в Главе II.
- Глобальный стор с подписками — экраны перечитывают `repo`, этого достаточно.
