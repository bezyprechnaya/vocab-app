/* Этап 3 — проверка: «помнишь перевод?». Провалы возвращаются в карточки
   новым кругом, чистый круг закрывает день. */

import { el, posLabel, exampleBlock, formatDate } from "../ui.js";
import * as session from "../session.js";
import * as settingsStore from "../settings.js";
import * as lang from "../lang.js";

export async function render(ctx, current) {
  const item = await session.currentItem(current);
  if (!item) {
    await session.answerCheck(current, true);
    return ctx.refresh();
  }
  await session.present(current);

  const settings = await settingsStore.get();
  const shown = current.checkRoundTotal - current.checkQueue.length + 1;
  const answerBox = el("div.word-card__tr", { hidden: true });
  // Подсказка — это не только перевод: пример показывает, как слово живёт в речи.
  const exampleBox = el("div.example-slot", { hidden: true });

  const answer = async (remembered) => {
    await session.answerCheck(current, remembered);
    ctx.refresh();
  };

  return el("div.day", {},
    el("div.day__head", {},
      el("span", {}, `Этап 3 из 3 · проверка ${shown} из ${current.checkRoundTotal}`),
      el("span", {}, formatDate(current.date))),
    el("div.word-card", {},
      el("div.word-card__en", {}, lang.word(item, settings.study)),
      el("div.word-card__pos", {}, posLabel(item.pos)),
      answerBox,
      exampleBox,
      el("button.btn.btn--small.btn--ghost", {
        type: "button",
        onclick: (e) => {
          answerBox.textContent = lang.meaning(item, settings.lang) || "—";
          answerBox.hidden = false;
          const example = exampleBlock(lang.example(item, settings.study),
            lang.example(item, settings.lang));
          if (example) {
            exampleBox.append(example);
            exampleBox.hidden = false;
          }
          e.currentTarget.hidden = true;
        },
      }, "Подсмотреть")),
    el("p.screen__lead.center", {}, "Помните перевод?"),
    el("div.actions", {},
      el("button.btn.btn--bad", { type: "button", onclick: () => answer(false) }, "Нет"),
      el("button.btn.btn--good", { type: "button", onclick: () => answer(true) }, "Да")));
}
