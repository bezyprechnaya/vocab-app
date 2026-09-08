/* История — единая лента дней: слова и фразовые глаголы вперемешку, новые сверху.
   День можно открыть, повторить или удалить; слова при удалении дня остаются
   выученными (глава I, 3.6). */

import { el, icon, formatDate, scoreLine, confirmAction, toast } from "../ui.js";
import * as session from "../session.js";
import * as settingsStore from "../settings.js";
import * as summary from "./summary.js";

export const title = (params) => (params.date ? formatDate(params.date) : "История");

const PHASE_TEXT = { sort: "сортировка", cards: "карточки", check: "проверка", done: "закрыт" };

export async function render(ctx) {
  return ctx.params.date ? renderDay(ctx) : renderList(ctx);
}

async function renderList(ctx) {
  const days = await session.history();
  if (!days.length) {
    return el("div.card.center", {},
      el("p", {}, "История пока пуста."),
      el("p.muted", {}, "Закройте первый день — он появится здесь."),
      el("button.btn.btn--primary.btn--wide", {
        type: "button", onclick: () => ctx.navigate("#/day/words"),
      }, "Начать день"));
  }

  const byDate = new Map();
  for (const day of days) {
    if (!byDate.has(day.date)) byDate.set(day.date, []);
    byDate.get(day.date).push(day);
  }

  const list = el("div.list");
  for (const [date, entries] of byDate) {
    list.append(el("h2.section-title", {}, formatDate(date)));
    for (const day of entries) {
      const meta = session.KINDS[day.kind];
      list.append(el("button.row", {
        type: "button", onclick: () => ctx.navigate(`#/history/${day.date}`),
      },
        el("span.hub__icon", {}, icon(meta?.icon || "book")),
        el("span.row__body", {},
          el("span.row__title", {}, meta?.title || day.kind),
          el("span.row__sub", {}, day.phase === "done"
            ? scoreLine(session.score(day))
            : `не закончен · ${PHASE_TEXT[day.phase] || day.phase}`)),
        el("span.row__chev", {}, "→")));
    }
  }
  return list;
}

async function renderDay(ctx) {
  const date = ctx.params.date;
  const all = await session.history();
  const entries = all.filter((day) => day.date === date);
  if (!entries.length) {
    return el("div.card", {}, el("p", {}, "Этого дня в истории нет."));
  }
  const settings = await settingsStore.get();
  const screen = el("div.list");

  for (const day of entries) {
    const meta = session.KINDS[day.kind];
    const parts = await summary.split(day);
    const done = day.phase === "done";
    screen.append(el("div.card", {},
      el("div.row__title", {}, meta?.title || day.kind),
      el("div.row__sub", {}, done ? "День закрыт" : "День не закончен"),
      parts.total
        ? el("div", { style: "margin-top:12px" },
            summary.tally(parts, { done }),
            summary.wordList(parts, settings, { done }))
        : el("p.muted", { style: "margin-top:10px" }, "Набор этого дня пуст."),
      el("div.actions", {},
        el("button.btn", {
          type: "button", disabled: !parts.total,
          onclick: () => ctx.navigate(`#/review/${day.date}/${day.kind}`),
        }, "Повторить"),
        el("button.btn.btn--danger", {
          type: "button",
          onclick: async () => {
            const yes = await confirmAction({
              title: "Удалить этот день?",
              text: "Запись о дне исчезнет из истории. Выученные слова останутся выученными — "
                + "прогресс хранится отдельно от истории.",
            });
            if (!yes) return;
            await session.removeDay(day.id);
            toast("День удалён");
            ctx.navigate("#/history", { replace: true });
          },
        }, "Удалить день"))));
  }
  return screen;
}
