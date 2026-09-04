/* Этап 2 — карточки: переворот, перевод и пример. «Повторить» отправляет
   карточку в конец круга, «Знаю» убирает её из него. */

import { el, posLabel, exampleBlock, originBadge, formatDate } from "../ui.js";
import * as session from "../session.js";
import * as settingsStore from "../settings.js";

export async function render(ctx, current) {
  const item = await session.currentItem(current);
  if (!item) {
    await session.cardKnown(current);
    return ctx.refresh();
  }
  await session.present(current);

  const settings = await settingsStore.get();
  const lang = settings.lang;
  const flip = el("div.flip__inner");
  const actions = el("div.actions", { hidden: true },
    el("button.btn", { type: "button", onclick: async () => {
      await session.cardRepeat(current); ctx.refresh();
    } }, "Повторить"),
    el("button.btn.btn--good", { type: "button", onclick: async () => {
      await session.cardKnown(current); ctx.refresh();
    } }, "Знаю"));

  const turn = () => {
    const flipped = flip.classList.toggle("flipped");
    actions.hidden = !flipped;
  };

  const dots = el("div.dots", {}, Array.from({ length: current.cardRoundTotal }, (_, i) =>
    el("span.dot" + (i < current.cardsDone ? ".done" : i === current.cardsDone ? ".active" : ""))));

  flip.append(
    el("div.flip__face", {},
      el("div.word-card", { onclick: turn },
        el("div.word-card__en", {}, item.en),
        el("div.word-card__pos", {}, posLabel(item.pos)),
        el("div.word-card__hint", {}, "Нажмите, чтобы посмотреть перевод"))),
    el("div.flip__face.flip__face--back", {},
      el("div.word-card", { onclick: turn },
        el("div.word-card__en", {}, item.en),
        el("div.word-card__tr", {}, item.tr?.[lang] || "—", originBadge(item.src?.[lang])),
        exampleBlock(item.exEn, item.exTr?.[lang]))));

  return el("div.day", {},
    el("div.day__head", {},
      el("span", {}, "Этап 2 из 3 · карточки"),
      el("span", {}, formatDate(current.date))),
    el("div.flip", {}, flip),
    dots,
    actions);
}
