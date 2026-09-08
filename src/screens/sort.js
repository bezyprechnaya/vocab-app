/* Этап 1 — сортировка: знакомое слово уходит в выученные сразу, незнакомое
   остаётся в наборе дня. Набор добирается до нужного размера автоматически. */

import { el, posLabel, formatDate, attachSwipe } from "../ui.js";
import * as session from "../session.js";
import * as settingsStore from "../settings.js";
import * as lang from "../lang.js";

export async function render(ctx, current) {
  const item = await session.currentItem(current);
  if (!item) {                       // слова из набора нет в базе — пакет удалён
    await session.answerSort(current, false);
    return ctx.refresh();
  }

  const settings = await settingsStore.get();
  const answer = async (know) => {
    await session.answerSort(current, know);
    ctx.refresh();
  };

  const card = el("div.word-card", {},
    el("div.word-card__en", {}, lang.word(item, settings.study)),
    el("div.word-card__pos", {}, posLabel(item.pos)),
    el("div.word-card__hint", {}, `В наборе дня: ${current.daySet.length} из ${current.size}`));
  attachSwipe(card, { onLeft: () => answer(false), onRight: () => answer(true) });

  return el("div.day", {},
    el("div.day__head", {},
      el("span", {}, "Этап 1 из 3 · знакомо?"),
      el("span", {}, formatDate(current.date))),
    card,
    el("p.screen__lead.center", {},
      "«Знаю» — слово сразу считается выученным и заменяется другим."),
    el("div.actions", {},
      el("button.btn.btn--bad", { type: "button", onclick: () => answer(false) }, "Не знаю"),
      el("button.btn.btn--good", { type: "button", onclick: () => answer(true) }, "Знаю")));
}
