/* Этап 2 — карточки: переворот, перевод и пример. «Повторить» отправляет
   карточку в конец круга, «Знаю» убирает её из него.

   Кнопки занимают своё место с самого начала и лишь меняют видимость:
   их появление при перевороте не должно сдвигать карточку — взгляд
   остаётся на слове. */

import { el, formatDate, attachSwipe } from "../ui.js";
import { flipCard } from "../flip.js";
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
  const repeat = async () => { await session.cardRepeat(current); ctx.refresh(); };
  const known = async () => { await session.cardKnown(current); ctx.refresh(); };

  const actions = el("div.actions.idle", {},
    el("button.btn", { type: "button", onclick: repeat }, "Повторить"),
    el("button.btn.btn--good", { type: "button", onclick: known }, "Знаю"));

  const flip = flipCard(item, settings, (flipped) => actions.classList.toggle("idle", !flipped));
  attachSwipe(flip, { onLeft: repeat, onRight: known });

  const dots = el("div.dots", {}, Array.from({ length: current.cardRoundTotal }, (_, i) =>
    el("span.dot" + (i < current.cardsDone ? ".done" : i === current.cardsDone ? ".active" : ""))));

  return el("div.day", {},
    el("div.day__head", {},
      el("span", {}, "Этап 2 из 3 · карточки"),
      el("span", {}, formatDate(current.date))),
    el("div.flip-stage", {}, el("div.flip", {}, flip)),
    dots,
    actions);
}
