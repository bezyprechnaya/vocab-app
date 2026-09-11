/* Хаб — стартовый экран. У каждого пункта видно состояние, чтобы попасть
   в нужное место одним нажатием (глава I, 3.1).

   Экран отвечает на три вопроса сразу и в том порядке, в каком они возникают.
   Что я учу — заголовок с языком, уровнем и стриком. Куда идти сегодня —
   крупная карточка «Слова дня» с полосой прогресса внутри: это то, зачем
   приложение открывают, и вес на экране у неё соответствующий. Что ещё
   бывает — два спутника рядом и спокойный список ниже: история, языки
   и настройки заходят реже, им хватает строки.

   «Выучено» и «осталось» — две точки одной шкалы, поэтому они стоят не порознь,
   а по краям полосы: слева пройденное, справа остаток пути. Считаются только
   слова текущего уровня — соседние уровни и фразовые глаголы идут своим счётом
   и о том, сколько осталось пройти здесь, ничего не говорят. */

import { el, icon, plural } from "../ui.js";
import * as session from "../session.js";
import * as progress from "../progress.js";
import * as packs from "../packs.js";
import * as settingsStore from "../settings.js";

export const title = "VOCAB";

/** Строка списка: значок, название, состояние. */
function hubItem({ mark, name, state, hash, navigate }) {
  return el("button.hub__item", {
    type: "button",
    onclick: () => navigate(hash),
  },
    el("span.hub__icon", {}, icon(mark)),
    el("span.hub__body", {},
      el("span.hub__name", {}, name),
      el("span.hub__state", {}, state)),
    el("span.hub__chev", {}, "→"));
}

/** Спутник главной карточки: тот же жест, вес поменьше. Карточки всегда
    живые — пустое поле экран режима расскажет сам, «бледная» кнопка только
    путала бы с остальными. */
function tile({ mark, name, state, hash, navigate }) {
  return el("button.tile", {
    type: "button",
    onclick: () => navigate(hash),
  },
    el("span.tile__icon", {}, icon(mark)),
    el("div.tile__body", {},
      el("h3.tile__title", {}, name),
      el("div.tile__state", {}, state)));
}

/** Шапка: язык крупно, уровень и стрик под ним капителью. Это подпись ко
    всему экрану — всё, что ниже, относится к этому языку и этому уровню. */
function header({ study, level, streak, closedDays }) {
  const streakText = streak
    ? `Стрик: ${plural(streak, "день", "дня", "дней")}`
    : closedDays ? "Стрик прерван" : "Стрик ещё не начат";

  return el("header.home__head", {},
    el("h1.home__title", {}, packs.LANG_NAMES[study] || study.toUpperCase()),
    el("div.home__meta", {},
      el("span.home__meta-item", {}, `Уровень ${level.toUpperCase()}`),
      el("span.home__dot"),
      el("span.home__meta-item", {}, streak ? icon("flame") : null, streakText)));
}

/** Главная карточка: режим дня и полоса прогресса по уровню внутри неё. */
function hero({ state, stats, level, navigate }) {
  const share = stats.total ? stats.learned / stats.total : 0;

  return el("button.hero", { type: "button", onclick: () => navigate("#/day/words") },
    el("div.hero__top", {},
      el("div", {},
        el("div.hero__label", {}, "Основной режим"),
        el("h2.hero__title", {}, "Слова дня"),
        el("div.hero__state", {}, state)),
      el("span.hero__icon", {}, icon("book"))),
    el("div.hero__foot", {},
      el("div.hero__scale", {},
        el("span", {}, `Прогресс ${level.toUpperCase()}`),
        el("span", {}, `${stats.learned} / ${stats.total}`)),
      el("div.bar", {},
        el("div.bar__fill", { style: `width:${Math.round(share * 100)}%` }))));
}

export async function render({ navigate }) {
  const [words, phrasal, streak, settings] = await Promise.all([
    session.stateLine("words"),
    session.stateLine("phrasal"),
    session.streak(),
    settingsStore.get(),
  ]);

  // Шкала — про выбранный уровень, поэтому считаем слова только его.
  const levelTotals = await progress.levelStats("words", settings.level);

  // Бесконечный режим идёт по тому же пулу, что и день: покажем, сколько там осталось.
  const endlessLevel = await session.pickLevel("words", settings.level, settings);
  const endlessStats = endlessLevel ? await progress.levelStats("words", endlessLevel) : null;

  const closed = (await session.history()).filter(session.isDone);

  const screen = el("div.home");

  screen.append(header({
    study: settings.study, level: settings.level, streak, closedDays: closed.length,
  }));

  screen.append(hero({
    state: words.text, stats: levelTotals, level: settings.level, navigate,
  }));

  screen.append(el("div.tiles", {},
    tile({ mark: "link", name: "Фразовые глаголы", state: phrasal.text,
      hash: "#/day/phrasal", navigate }),
    tile({ mark: "infinity", name: "Бесконечный режим",
      state: endlessStats
        ? `Без дневного лимита · впереди ${endlessStats.total - endlessStats.learned}`
        : "Нет загруженных слов",
      hash: "#/endless/words", navigate })));

  screen.append(el("div.hub", {},
    // Повторение живёт внутри истории: день выбирается там же, где и виден.
    hubItem({ mark: "calendar", name: "История и повторение",
      state: closed.length
        ? plural(closed.length, "закрытый день", "закрытых дня", "закрытых дней")
        : "Пока пусто",
      hash: "#/history", navigate }),
    hubItem({ mark: "globe", name: "Языки и уровни",
      state: `${packs.langFlag(settings.study)} → ${packs.langFlag(settings.lang)}`
        + ` · уровень ${settings.level.toUpperCase()}`,
      hash: "#/packs", navigate }),
    hubItem({ mark: "settings", name: "Настройки", state: "Размер дня, тема, копия данных",
      hash: "#/settings", navigate })));

  return screen;
}
