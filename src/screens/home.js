/* Хаб — стартовый экран. У каждого пункта видно состояние, чтобы попасть
   в нужное место одним нажатием (глава I, 3.1).

   Чему учусь — флаг и уровень в углу панели: это подпись ко всему экрану,
   а не пункт списка. Карточка под ней отвечает на два оставшихся вопроса:
   насколько продвинулся (полоса) и не разорвана ли привычка (стрик).
   «Выучено» и «в базе» — две точки одной шкалы, поэтому они стоят не порознь,
   а по краям полосы. */

import { el, plural, setTopbarMark } from "../ui.js";
import * as session from "../session.js";
import * as progress from "../progress.js";
import * as packs from "../packs.js";
import * as settingsStore from "../settings.js";

export const title = "VOCAB";

function hubItem({ icon, name, state, hash, navigate, done, disabled }) {
  return el("button.hub__item" + (done ? ".hub__item--done" : ""), {
    type: "button",
    disabled: !!disabled,
    onclick: () => !disabled && navigate(hash),
  },
    el("span.hub__icon", {}, icon),
    el("span.hub__body", {},
      el("span.hub__name", {}, name),
      el("span.hub__state", {}, state)),
    el("span.hub__chev", {}, "›"));
}

/** Карточка прогресса: полоса, шкала под ней и стрик. Над полосой пусто —
    что именно учится, сказано флагом и уровнем в углу панели. */
function header({ totals, streak, closedDays }) {
  const share = totals.items ? totals.learned / totals.items : 0;

  return el("div.card.overview", {},
    el("div.bar", {},
      el("div.bar__fill", { style: `width:${Math.round(share * 100)}%` })),

    el("div.overview__scale", {},
      el("span", {}, `Выучено ${totals.learned}`),
      el("span.muted", {}, `из ${totals.items} в базе`)),

    el("div.overview__streak", {},
      el("span.overview__fire", {}, streak ? "🔥" : "·"),
      el("span", {}, streak
        ? plural(streak, "день подряд", "дня подряд", "дней подряд")
        : closedDays
          ? "Стрик прервался — закройте день, чтобы начать заново"
          : "Стрик начнётся с первого закрытого дня")));
}

export async function render({ navigate }) {
  const [words, phrasal, totals, streak, settings] = await Promise.all([
    session.stateLine("words"),
    session.stateLine("phrasal"),
    progress.totals(),
    session.streak(),
    settingsStore.get(),
  ]);

  // Бесконечный режим идёт по тому же пулу, что и день: покажем, сколько там осталось.
  const endlessLevel = await session.pickLevel("words", settings.level, settings);
  const endlessStats = endlessLevel ? await progress.levelStats("words", endlessLevel) : null;

  const closed = (await session.history()).filter(session.isDone);

  const screen = el("div.hub");

  // Флаг и уровень — в левом углу панели: на хабе кнопки «назад» нет, угол свободен.
  setTopbarMark([
    el("span.topbar__flag", {}, packs.langFlag(settings.study)),
    el("span.topbar__level", {}, settings.level.toUpperCase()),
  ]);

  screen.append(header({ totals, streak, closedDays: closed.length }));

  screen.append(
    hubItem({ icon: "📘", name: "Слова дня", state: words.text, done: words.done,
      hash: "#/day/words", navigate }),
    hubItem({ icon: "🔗", name: "Фразовые глаголы", state: phrasal.text, done: phrasal.done,
      hash: "#/day/phrasal", navigate }),
    hubItem({ icon: "♾️", name: "Бесконечный режим",
      state: endlessStats
        ? `Без дневного лимита · впереди ${endlessStats.total - endlessStats.learned}`
        : "Нет загруженных слов",
      disabled: !endlessStats,
      hash: "#/endless/words", navigate }),
    // Повторение живёт внутри истории: день выбирается там же, где и виден.
    hubItem({ icon: "🗓", name: "История и повторение",
      state: closed.length
        ? plural(closed.length, "закрытый день", "закрытых дня", "закрытых дней")
        : "Пока пусто",
      hash: "#/history", navigate }),
    hubItem({ icon: "🌍", name: "Языки и уровни",
      state: `${packs.langFlag(settings.study)} → ${packs.langFlag(settings.lang)}`
        + ` · уровень ${settings.level.toUpperCase()}`,
      hash: "#/packs", navigate }),
    hubItem({ icon: "⚙️", name: "Настройки", state: "Размер дня, тема, копия данных",
      hash: "#/settings", navigate }));

  return screen;
}
