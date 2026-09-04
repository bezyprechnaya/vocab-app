/* Повторение дня: те же карточки, но прогресс не меняется — это перечитывание,
   а не новый день. Очередь живёт только на экране и никуда не пишется. */

import { el, posLabel, exampleBlock, originBadge, formatDate, shuffle, toast } from "../ui.js";
import * as db from "../db.js";
import * as session from "../session.js";
import * as settingsStore from "../settings.js";
import * as lang from "../lang.js";

export const title = () => "Повторение";

export async function render(ctx) {
  const { date, kind } = ctx.params;
  const day = await db.get("sessions", db.sessionKey(date, kind));
  if (!day || !day.daySet.length) {
    return el("div.card", {}, el("p", {}, "Нечего повторять: набор этого дня пуст."));
  }

  const settings = await settingsStore.get();
  const items = await session.items(day.daySet);
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
    const flip = el("div.flip__inner");
    const turn = () => flip.classList.toggle("flipped");

    const word = lang.word(item, settings.study);
    flip.append(
      el("div.flip__face", {},
        el("div.word-card", { onclick: turn },
          el("div.word-card__en", {}, word),
          el("div.word-card__pos", {}, posLabel(item.pos)),
          el("div.word-card__hint", {}, "Нажмите, чтобы посмотреть перевод"))),
      el("div.flip__face.flip__face--back", {},
        el("div.word-card", { onclick: turn },
          el("div.word-card__en", {}, word),
          el("div.word-card__tr", {}, lang.meaning(item, settings.lang) || "—",
            originBadge(lang.origin(item, settings))),
          exampleBlock(lang.example(item, settings.study), lang.example(item, settings.lang)))));

    box.append(
      el("div.day__head", {},
        el("span", {}, `${session.KINDS[kind]?.title || kind} · ${index + 1} из ${queue.length}`),
        el("span", {}, formatDate(date))),
      el("div.flip", {}, flip),
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
