/* Настройки: размер дня, копия данных, удаление (глава I, 3.3 и 3.6).
   Разрушительные действия — только через подтверждение и с предложением
   сначала сделать экспорт. */

import { el, plural, toast, confirmAction } from "../ui.js";
import * as db from "../db.js";
import * as backup from "../backup.js";
import * as settingsStore from "../settings.js";
import * as progress from "../progress.js";

export const title = () => "Настройки";

const SIZES = [5, 10, 15, 20];

export async function render(ctx) {
  const settings = await settingsStore.get();
  const totals = await progress.totals();
  const sessions = await db.count("sessions");
  const screen = el("div.list");

  // ── размер дня ───────────────────────────────────────────────────────
  screen.append(el("h2.section-title", {}, "Размер дня"));
  screen.append(el("div.card", {},
    el("div.row__title", {}, "Слов в день"),
    el("div.chips", { style: "margin-top:8px" }, SIZES.map((n) =>
      el("button.chip" + (settings.wordsPerDay === n ? ".chip--on" : ""), {
        type: "button",
        onclick: async () => { await settingsStore.patch({ wordsPerDay: n }); ctx.refresh(); },
      }, String(n)))),
    el("div.row__title", { style: "margin-top:14px" }, "Фразовых глаголов в день"),
    el("div.chips", { style: "margin-top:8px" }, SIZES.map((n) =>
      el("button.chip" + (settings.phrasalPerDay === n ? ".chip--on" : ""), {
        type: "button",
        onclick: async () => { await settingsStore.patch({ phrasalPerDay: n }); ctx.refresh(); },
      }, String(n)))),
    el("p.muted", { style: "margin:10px 0 0;font-size:13px" },
      "Новый размер применится к следующему дню — начатый день не меняется.")));

  // ── мои данные ───────────────────────────────────────────────────────
  screen.append(el("h2.section-title", {}, "Мои данные"));
  const fileInput = el("input", { type: "file", accept: "application/json,.json", hidden: true });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      const parsed = backup.parse(await backup.readFile(file));
      if (parsed.type === "pack") {
        await backup.importPack(parsed.data);
        toast(`Пакет ${parsed.data.lang}/${parsed.data.level} установлен из файла`);
        ctx.refresh();
        return;
      }
      const box = el("div.modal__text", {},
        `В файле: ${plural(parsed.data.items.length, "запись", "записи", "записей")}, `
        + `прогресс по ${plural((parsed.data.progress || []).length, "слову", "словам", "словам")}, `
        + `${plural((parsed.data.sessions || []).length, "день", "дня", "дней")} истории.`);
      const replace = await confirmAction({
        title: "Как импортировать?",
        text: "«Объединить» — победит более продвинутый статус, ничего не потеряется. "
          + "«Заменить всё» — текущая база будет стёрта целиком.",
        confirmLabel: "Заменить всё",
        extra: box,
      });
      if (replace) {
        const sure = await confirmAction({
          title: "Стереть текущую базу?",
          text: "Слова, прогресс и история будут заменены содержимым файла. Отменить нельзя.",
          confirmLabel: "Заменить",
        });
        if (!sure) return;
        await backup.replaceAll(parsed.data);
        toast("База заменена");
      } else {
        await backup.merge(parsed.data);
        toast("Данные объединены");
      }
      ctx.refresh();
    } catch (error) {
      toast(`Импорт не удался: ${error.message}`);
    }
  });

  screen.append(el("div.card", {},
    el("div.row__title", {}, "Копия данных"),
    el("p.muted", { style: "margin:4px 0 10px;font-size:13px" },
      `В базе: ${plural(totals.items, "запись", "записи", "записей")}, `
      + `выучено ${totals.learned}, дней в истории ${sessions}.`),
    el("div.actions", { style: "margin-top:0" },
      el("button.btn", {
        type: "button",
        onclick: async () => { await backup.download(); toast("Файл копии сохранён"); },
      }, "Экспорт"),
      el("button.btn", { type: "button", onclick: () => fileInput.click() }, "Импорт")),
    fileInput));

  // ── удаление ─────────────────────────────────────────────────────────
  screen.append(el("h2.section-title", {}, "Удаление"));
  screen.append(el("div.card", {},
    el("button.btn.btn--wide.btn--danger", {
      type: "button",
      onclick: async () => {
        const yes = await confirmAction({
          title: "Удалить всю историю?",
          text: "Исчезнут все дни. Выученные слова останутся выученными: прогресс "
            + "хранится отдельно от истории. Перед удалением можно сделать экспорт.",
          extra: exportHint(),
        });
        if (!yes) return;
        await db.clear("sessions");
        toast("История удалена");
        ctx.refresh();
      },
    }, "Удалить всю историю"),
    el("button.btn.btn--wide.btn--danger", {
      type: "button", style: "margin-top:10px",
      onclick: async () => {
        const yes = await confirmAction({
          title: "Полный сброс?",
          text: "База удаляется целиком: слова, прогресс, история и настройки. "
            + "После перезапуска останется только стартовый пакет. Отменить нельзя.",
          confirmLabel: "Сбросить всё",
          extra: exportHint(),
        });
        if (!yes) return;
        await db.destroy();
        settingsStore.forget();
        location.replace("#/home");
        location.reload();
      },
    }, "Полный сброс")));

  // ── прочее ───────────────────────────────────────────────────────────
  screen.append(el("div.card", {},
    el("button.btn.btn--wide.btn--ghost", {
      type: "button",
      onclick: async () => {
        await settingsStore.patch({ onboarded: false });
        ctx.navigate("#/onboarding");
      },
    }, "Показать вводные экраны заново")));

  return screen;
}

function exportHint() {
  return el("p.modal__text", {},
    "Совет: сначала «Экспорт» — копия займёт секунду и всё вернёт.");
}
