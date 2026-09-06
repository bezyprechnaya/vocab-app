/* Итог дня — одна и та же деталь в «Готово на сегодня» и в истории.

   День закрывает записи двумя путями, и путь стоит показать: новое прошло
   карточки и проверку, знакомое отсеялось на сортировке одним нажатием.
   Сложить их в одно число — потерять смысл: десять выученных слов и десять
   узнанных стоят разного труда. Поэтому счёт двойной, а список разделён
   на две части со своими заголовками. */

import { el } from "../ui.js";
import * as session from "../session.js";
import * as lang from "../lang.js";

/** Записи дня по частям. Пакет могли удалить — тогда строки просто не будет,
    поэтому считаем по тому, что нашлось, а не по длине списков в сессии. */
export async function split(day) {
  const [fresh, known] = await Promise.all([
    session.items(day.daySet || []),
    session.items(day.knownIds || []),
  ]);
  return { fresh, known, total: fresh.length + known.length };
}

/** Незакрытый день ещё ничего не выучил: набор в работе. Слова об этом честные,
    иначе история пообещает выученным то, что человек только начал. */
const WORDS = {
  done: { fresh: "новых", group: "Выучено сегодня" },
  open: { fresh: "в наборе", group: "Набор дня" },
};

/** Двойной счёт крупными цифрами: «10 новых + 6 знакомых».
    Пустая половина не рисуется — ноль в итоге дня ничего не сообщает. */
export function tally({ fresh, known }, { done = true } = {}) {
  const cell = (kind, n, label) => el(`div.tally__cell.tally__cell--${kind}`, {},
    el("div.tally__num", {}, n),
    el("div.tally__label", {}, label));

  const box = el("div.tally");
  if (fresh.length || !known.length) {
    box.append(cell("fresh", fresh.length, WORDS[done ? "done" : "open"].fresh));
  }
  if (fresh.length && known.length) box.append(el("div.tally__plus", {}, "+"));
  if (known.length) box.append(cell("known", known.length, "знакомых"));
  return box;
}

/** Список дня: две группы со своими заголовками. Знакомое идёт вторым и
    пунктиром — оно тоже закрыто, но взгляду задерживаться на нём незачем. */
export function wordList({ fresh, known }, settings, { done = true } = {}) {
  const row = (item, wasKnown) => el("div.word-row" + (wasKnown ? ".word-row--known" : ""), {},
    el("span.word-row__en", {}, lang.word(item, settings.study)),
    el("span.word-row__tr", {}, lang.meaning(item, settings.lang) || "—"));

  const group = (title, items, wasKnown) => items.length
    ? el("div.words-group", {},
        el("div.words-group__title", {},
          el("span", {}, title),
          el("span.words-group__count", {}, items.length)),
        el("div.words-list", {}, items.map((item) => row(item, wasKnown))))
    : null;

  return el("div.words-groups", {},
    group(WORDS[done ? "done" : "open"].group, fresh, false),
    group("Уже были знакомы", known, true));
}
