/* День закрыт: итог и список того, что выучено. Набор дня больше не меняется. */

import { el, plural, formatDate } from "../ui.js";
import * as session from "../session.js";
import * as settingsStore from "../settings.js";

export async function render(ctx, current) {
  const settings = await settingsStore.get();
  const items = await session.items(current.daySet);

  return el("div.day", {},
    el("div.done-hero", {},
      el("div.done-hero__mark", {}, "✓"),
      el("h2.done-hero__title", {}, "Готово на сегодня"),
      el("p.muted", {}, `${formatDate(current.date)} · `
        + plural(current.learnedToday || 0, "запись", "записи", "записей") + " закрыто")),

    items.length
      ? el("div.words-list", {}, items.map((item) => el("div.word-row", {},
          el("span.word-row__en", {}, item.en),
          el("span.word-row__tr", {}, item.tr?.[settings.lang] || "—"))))
      : el("p.muted.center", {}, "Все слова набора оказались знакомыми."),

    el("div.actions", {},
      el("button.btn", {
        type: "button",
        onclick: () => ctx.navigate(`#/review/${current.date}/${current.kind}`),
      }, "Повторить"),
      el("button.btn.btn--primary", {
        type: "button", onclick: () => ctx.navigate("#/home"),
      }, "На главную")));
}
