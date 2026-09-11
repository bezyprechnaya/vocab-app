/* Повторение дня: те же карточки, но прогресс не меняется — это перечитывание,
   а не новый день. Очередь живёт только на экране и никуда не пишется. */

import { el, formatDate, shuffle, toast } from "../ui.js";
import { flipCard } from "../flip.js";
import * as db from "../db.js";
import * as session from "../session.js";
import * as settingsStore from "../settings.js";

export const title = () => "Повторение";

export async function render(ctx) {
  const { date, kind } = ctx.params;
  const day = await db.get("sessions", db.sessionKey(date, kind));
  const closed = day ? session.closedIds(day) : [];
  if (!closed.length) {
    return el("div.card", {}, el("p", {}, "Нечего повторять: набор этого дня пуст."));
  }

  const settings = await settingsStore.get();
  const items = await session.items(closed);
  if (!items.length) {
    return el("div.card", {},
      el("p", {}, "Слова этого дня больше не загружены."),
      el("p.muted", {}, "Пакет был удалён. Прогресс сохранён, вернуть слова можно на экране «Языки и уровни»."));
  }

  let queue = shuffle(items);
  let index = 0;

  const box = el("div.day");
  const draw = () => {
    box.textContent = "";
    const item = queue[index];
    // Кнопки «Назад»/«Дальше» на месте всегда, а высоту коробки задаёт оборот —
    // поэтому при перевороте карточка стоит там же, где стояла.
    const flip = flipCard(item, settings);

    box.append(
      el("div.day__head", {},
        el("span", {}, `${session.KINDS[kind]?.title || kind} · ${index + 1} из ${queue.length}`),
        el("span", {}, formatDate(date))),
      el("div.flip-stage", {}, el("div.flip", {}, flip)),
      el("div.actions", {},
        el("button.btn", { type: "button", disabled: index === 0, onclick: () => { index--; draw(); } },
          "Назад"),
        el("button.btn.btn--primary", { type: "button", onclick: () => {
          if (index + 1 < queue.length) { index++; draw(); return; }
          toast("Круг пройден");
          queue = shuffle(items);
          index = 0;
          draw();
        } }, index + 1 < queue.length ? "Дальше" : "Ещё круг")));
  };

  draw();
  return box;
}
