/* День закрыт: итог и список того, что закрыто. Набор дня больше не меняется.

   Счёт двойной — новое и уже знакомое считаются порознь (`screens/summary.js`),
   поэтому «10 новых + 6 знакомых» видно и в цифрах, и в самом списке. */

import { el, icon, formatDate } from "../ui.js";
import * as settingsStore from "../settings.js";
import * as summary from "./summary.js";

export async function render(ctx, current) {
  const settings = await settingsStore.get();
  const parts = await summary.split(current);

  return el("div.day", {},
    el("div.done-hero", {},
      el("div.done-hero__mark", {}, icon("check")),
      el("h2.done-hero__title", {}, "Готово на сегодня"),
      el("p.muted.done-hero__date", {}, formatDate(current.date))),

    parts.total
      ? summary.tally(parts)
      : el("p.muted.center", {}, "Сегодня закрывать было нечего."),

    parts.total ? summary.wordList(parts, settings) : null,

    el("div.actions", {},
      el("button.btn", {
        type: "button",
        onclick: () => ctx.navigate(`#/review/${current.date}/${current.kind}`),
      }, "Повторить"),
      el("button.btn.btn--primary", {
        type: "button", onclick: () => ctx.navigate("#/home"),
      }, "На главную")));
}
