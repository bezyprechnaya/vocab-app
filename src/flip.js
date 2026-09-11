/* Карточка-переворот — общая грань для трёх экранов: карточек дня, бесконечного
   режима и повторения. Лицо — слово; оборот — перевод, пометка «mt» и пример.

   Высоту коробки задаёт оборот: он единственный лежит в потоке (лицо накрыто
   абсолютом), поэтому перевод и пример учтены в размере заранее, и при
   перевороте карточка не меняет ни высоты, ни места на экране. */

import { el, posLabel, exampleBlock, originBadge } from "./ui.js";
import * as lang from "./lang.js";

/** `onTurn(флип?)` — чтобы экран карточек дня мог показать свои кнопки. */
export function flipCard(item, settings, onTurn) {
  const flip = el("div.flip__inner");
  const turn = () => {
    const flipped = flip.classList.toggle("flipped");
    if (onTurn) onTurn(flipped);
  };
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
  return flip;
}
