/* Выбор языков и уровня — одно действие для всех экранов.

   Нажатие обязано закончиться готовыми пакетами. Пара «изучаю → перевод» может
   требовать двух языков сразу: есть файл в каталоге — качаем его, файла нет —
   собираем пакет прямо здесь, переводя английские слова и примеры
   (`packs.buildLocal`), и всё это время на экране полоса и кнопка отмены.
   Так знакомство и «Языки и уровни» ведут себя одинаково. */

import { el, plural, toast, progressModal } from "./ui.js";
import * as packs from "./packs.js";

/** Сборка недостающего пакета с экраном загрузки. `true` — пакет появился. */
export async function buildMissing(lang, level) {
  if (!packs.online()) {
    toast("Нет сети: пакет для этого языка нельзя ни скачать, ни собрать");
    return false;
  }
  const controller = new AbortController();
  const dialog = progressModal({
    title: `Собираем ${packs.LANG_NAMES[lang] || lang.toUpperCase()} · ${packs.levelLabel(level)}`,
    text: "Готовим слова…",
  });
  dialog.onCancel(() => controller.abort());
  try {
    const result = await packs.buildLocal(lang, level, {
      signal: controller.signal,
      onProgress: (value, message) => dialog.set(value, message),
    });
    toast(`Пакет собран: ${plural(result.count, "запись", "записи", "записей")}`);
    return true;
  } catch (error) {
    toast(error.name === "AbortError"
      ? "Сборка отменена"
      : `Собрать не вышло: ${error.message}`);
    return false;
  } finally {
    dialog.close();
  }
}

/** Записать выбор и довести его до пакетов: скачать готовые, собрать недостающие. */
export async function applyChoice(changes, { onProgress } = {}) {
  const result = await packs.apply(changes, onProgress);
  const built = [];
  for (const gap of result.missing) {
    if (await buildMissing(gap.lang, gap.level)) built.push(gap);
  }
  if (!result.missing.length) {
    toast(result.added.length
      ? "Пакет загружен — прогресс сохранён, он не привязан к языку"
      : "Готово — пакет уже был загружен");
  }
  return { ...result, built };
}

/** Одинаковая пара бессмысленна: слово и перевод совпали бы. Исключение —
    английский: English → English это толкование, а не тот же самый текст. */
export function sameSides(code, other) {
  return code === other && code !== "en";
}

/** Ряд языков — общий для знакомства и «Языков и уровней»: подсветка выбранного
    и запрет пары, в которой обе стороны карточки одинаковы. */
export function langChips({ value, other, disabled = false, extra = [], onPick }) {
  const langs = [...new Set([...packs.LANGS, ...extra, value])];
  return el("div.chips", {}, langs.map((code) => {
    const blocked = sameSides(code, other);
    return el("button.chip" + (code === value ? ".chip--on" : ""), {
      type: "button",
      disabled: disabled || blocked,
      title: blocked ? "Слово и перевод совпали бы" : "",
      onclick: () => onPick(code),
    }, packs.LANG_NAMES[code] || code.toUpperCase());
  }));
}
