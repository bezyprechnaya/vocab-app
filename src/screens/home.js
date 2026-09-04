/* Хаб — стартовый экран. У каждого пункта видно состояние, чтобы попасть
   в нужное место одним нажатием (глава I, 3.1). */

import { el, plural, formatDate } from "../ui.js";
import * as session from "../session.js";
import * as progress from "../progress.js";
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

export async function render({ navigate }) {
  const [words, phrasal, totals, days, settings] = await Promise.all([
    session.stateLine("words"),
    session.stateLine("phrasal"),
    progress.totals(),
    session.history(),
    settingsStore.get(),
  ]);

  const closed = days.filter((d) => d.phase === "done");
  const lastClosed = closed[0];

  const screen = el("div.hub");

  screen.append(el("div.card.stats", {},
    el("div", {}, el("div.stats__num", {}, totals.learned), el("div.stats__label", {}, "выучено")),
    el("div", {}, el("div.stats__num", {}, closed.length), el("div.stats__label", {}, "закрытых дней")),
    el("div", {}, el("div.stats__num", {}, totals.items), el("div.stats__label", {}, "в базе"))));

  screen.append(
    hubItem({ icon: "📘", name: "Слова дня", state: words.text, done: words.done,
      hash: "#/day/words", navigate }),
    hubItem({ icon: "🔗", name: "Фразовые глаголы", state: phrasal.text, done: phrasal.done,
      hash: "#/day/phrasal", navigate }),
    hubItem({ icon: "🗓", name: "История",
      state: closed.length ? plural(closed.length, "закрытый день", "закрытых дня", "закрытых дней")
        : "Пока пусто",
      hash: "#/history", navigate }),
    hubItem({ icon: "🔁", name: "Повторить",
      state: lastClosed
        ? `Последний день: ${formatDate(lastClosed.date)}`
        : "Нет закрытых дней",
      disabled: !lastClosed,
      hash: lastClosed ? `#/review/${lastClosed.date}/${lastClosed.kind}` : "#/history",
      navigate }),
    hubItem({ icon: "🌍", name: "Языки и уровни",
      state: `${settings.lang.toUpperCase()} · уровень ${settings.level.toUpperCase()}`,
      hash: "#/packs", navigate }),
    hubItem({ icon: "❓", name: "Как это работает", state: "Три этапа дня, пакеты, данные",
      hash: "#/help", navigate }),
    hubItem({ icon: "⚙️", name: "Настройки", state: "Размер дня, копия данных, удаление",
      hash: "#/settings", navigate }));

  return screen;
}
