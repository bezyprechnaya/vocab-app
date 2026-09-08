/* Экран дня: один маршрут `#/day/:kind` на слова и на фразовые глаголы.
   Что показать, решает этап сессии — сам движок общий (глава I, этап 4). */

import { el } from "../ui.js";
import * as session from "../session.js";
import * as sort from "./sort.js";
import * as cards from "./cards.js";
import * as check from "./check.js";
import * as done from "./done.js";

export const title = (params) => session.KINDS[params.kind]?.title || "День";

export async function render(ctx) {
  const kind = ctx.params.kind;
  if (!session.KINDS[kind]) {
    return el("div.card", {}, el("p", {}, "Неизвестный вид занятия."));
  }

  const current = await session.loadOrStart(kind);
  if (!current) {
    return el("div.card", {},
      el("h2", {}, "Учить нечего"),
      el("p.muted", {}, kind === "phrasal"
        ? "Все загруженные фразовые глаголы уже выучены."
        : "На загруженных уровнях не осталось невыученных слов. "
          + "Загрузите следующий уровень — прогресс при этом не сбрасывается."),
      el("button.btn.btn--primary.btn--wide", {
        type: "button", onclick: () => ctx.navigate("#/packs"),
      }, "Языки и уровни"));
  }

  const screens = { sort, cards, check, done };
  return screens[current.phase].render(ctx, current);
}
