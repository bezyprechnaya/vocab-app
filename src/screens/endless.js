/* Бесконечный режим: карточки без дневного набора и без трёх этапов.

   День — про дозировку и закрытие: набор фиксирован, в конце его подводят итог.
   Здесь наоборот: очередь не кончается, пока на уровне есть невыученное, а когда
   уровень заканчивается — берётся следующий, где ещё есть что учить.

   Прогресс общий с днями: «знаю» отмечает слово выученным, и день его больше
   не предложит. Сессия дня при этом не создаётся — история остаётся про дни. */

import {
  el, posLabel, exampleBlock, originBadge, plural, toast, todayISO, attachSwipe, shuffle,
} from "../ui.js";
import * as db from "../db.js";
import * as session from "../session.js";
import * as progress from "../progress.js";
import * as settingsStore from "../settings.js";
import * as lang from "../lang.js";
import { levelLabel } from "../packs.js";

export const title = () => "Бесконечный режим";

const AGAIN_AFTER = 4;      // через сколько карточек вернётся «ещё раз»

export async function render(ctx) {
  const kind = ctx.params.kind;
  if (!session.KINDS[kind]) {
    return el("div.card", {}, el("p", {}, "Неизвестный вид занятия."));
  }

  const settings = await settingsStore.get();
  const box = el("div.day");

  let level = null;
  let queue = [];             // id, ближайшая карточка первой
  let learned = 0;
  let again = 0;
  let left = 0;

  /** Добор очереди. Уровень кончился — переходим на следующий с невыученным. */
  const refill = async () => {
    const next = await session.pickLevel(kind, level || settings.level, settings);
    if (!next) return false;
    if (level && next !== level) toast(`Уровень ${level.toUpperCase()} пройден — дальше ${next.toUpperCase()}`);
    level = next;
    const pool = await progress.poolFor(kind, level, settings);
    left = pool.length;
    const busy = new Set(queue);
    const fresh = session.withExamplesFirst(shuffle(pool.filter((item) => !busy.has(item.id))));
    queue = queue.concat(fresh.map((item) => item.id));
    return queue.length > 0;
  };

  const nothingLeft = () => el("div.card", {},
    el("h2", {}, "Учить нечего"),
    el("p.muted", {}, kind === "phrasal"
      ? "Все загруженные фразовые глаголы выучены."
      : "На загруженных уровнях не осталось невыученных слов. "
        + "Загрузите следующий уровень — прогресс при этом не сбрасывается."),
    el("button.btn.btn--primary.btn--wide", {
      type: "button", onclick: () => ctx.navigate("#/packs"),
    }, "Языки и уровни"));

  const switcher = () => el("div.chips.chips--center", {},
    Object.entries(session.KINDS).map(([name, meta]) =>
      el("button.chip" + (name === kind ? ".chip--on" : ""), {
        type: "button",
        onclick: () => ctx.navigate(`#/endless/${name}`, { replace: true }),
      }, meta.short || meta.title)));

  const draw = async () => {
    box.textContent = "";

    if (!queue.length && !(await refill())) {
      box.append(switcher(), nothingLeft());
      return;
    }

    const item = await db.get("items", queue[0]);
    if (!item) {                       // слова нет в базе — пакет удалён
      queue.shift();
      return draw();
    }
    await progress.touch(item.id, todayISO());

    const known = async () => {
      queue.shift();
      await progress.mark(item.id, progress.LEARNED, todayISO());
      learned++;
      left = Math.max(left - 1, 0);
      await draw();
    };

    const repeat = async () => {
      const id = queue.shift();
      queue.splice(Math.min(AGAIN_AFTER, queue.length), 0, id);
      again++;
      await draw();
    };

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
    attachSwipe(flip, { onLeft: repeat, onRight: known });

    box.append(
      switcher(),
      el("div.day__head", {},
        el("span", {}, kind === "phrasal" ? "Фразовые глаголы" : levelLabel(level)),
        el("span", {}, `выучено ${learned} · осталось ${left}`)),
      el("div.flip", {}, flip),
      el("p.screen__lead.center", {}, again
        ? plural(again, "карточка вернётся", "карточки вернутся", "карточек вернутся") + " ещё раз"
        : "Режим без дневного лимита: карточки идут, пока не остановитесь."),
      el("div.actions", {},
        el("button.btn", { type: "button", onclick: repeat }, "Ещё раз"),
        el("button.btn.btn--good", { type: "button", onclick: known }, "Знаю")));
  };

  await draw();
  return box;
}
