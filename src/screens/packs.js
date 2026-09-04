/* «Языки и уровни»: каталог пакетов, загрузка и удаление, выбор активного языка
   и уровня (глава I, 3.2).

   Загруженный пакет живёт в IndexedDB — после установки сеть не нужна.
   Удаление пакета не трогает прогресс: выученное остаётся выученным. */

import { el, formatSize, plural, confirmAction, toast } from "../ui.js";
import * as packs from "../packs.js";
import * as progress from "../progress.js";
import * as settingsStore from "../settings.js";

export const title = () => "Языки и уровни";

function connectionWarning(bytes) {
  const conn = navigator.connection;
  if (!conn || !bytes) return null;
  const slow = conn.saveData || /2g/.test(conn.effectiveType || "");
  if (!slow) return null;
  return `Соединение медленное или включена экономия трафика: пакет весит ${formatSize(bytes)}.`;
}

export async function render(ctx) {
  const settings = await settingsStore.get();
  const screen = el("div.list");

  let catalog = [];
  let catalogError = null;
  try {
    catalog = await packs.catalog();
  } catch (error) {
    catalogError = error;
  }

  const installed = await packs.installed();

  if (!packs.online()) {
    screen.append(el("div.card", {},
      el("div.row__title", {}, "Нет подключения"),
      el("p.muted", { style: "margin:4px 0 0" },
        "Загрузка пакетов недоступна. Уже загруженные пакеты работают как обычно.")));
  }

  // ── активный язык ────────────────────────────────────────────────────
  const langs = [...new Set(catalog.map((p) => p.lang))];
  if (!langs.includes(settings.lang)) langs.unshift(settings.lang);

  screen.append(el("h2.section-title", {}, "Язык перевода"));
  screen.append(el("div.chips", {}, langs.map((lang) =>
    el("button.chip" + (lang === settings.lang ? ".chip--on" : ""), {
      type: "button",
      onclick: async () => {
        await settingsStore.patch({ lang });
        toast("Язык переключён. Прогресс сохранён — он не привязан к языку.");
        ctx.refresh();
      },
    }, packs.LANG_NAMES[lang] || lang.toUpperCase()))));

  if (catalogError) {
    screen.append(el("div.card", {},
      el("div.row__title", {}, "Каталог недоступен"),
      el("p.muted", { style: "margin:4px 0 0" }, String(catalogError.message || catalogError))));
  }

  // ── пакеты активного языка ───────────────────────────────────────────
  const mine = catalog.filter((p) => p.lang === settings.lang);
  const order = [...packs.LEVELS, "phrasal"];
  mine.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));

  screen.append(el("h2.section-title", {}, "Пакеты"));
  if (!mine.length) {
    screen.append(el("div.card", {}, el("p.muted", {},
      "Для этого языка пакетов пока нет. Их собирает tools/build-packs.py.")));
  }

  for (const entry of mine) {
    const key = `${entry.lang}|${entry.level}`;
    const have = installed.get(key);
    const stats = have ? await progress.levelStats(entry.kind, entry.level) : null;
    const isActiveLevel = settings.level === entry.level && entry.kind === "words";

    const side = el("span.row__side");
    const row = el("div.row.row--static", {},
      el("span.row__body", {},
        el("span.row__title", {}, packs.levelLabel(entry.level),
          isActiveLevel ? el("span.badge-mt", { title: "Слова дня берутся отсюда" }, "активный") : null),
        el("span.row__sub", {}, have
          ? `Загружено ${have.installedAt} · выучено ${stats.learned} из ${stats.total}`
          : `${plural(entry.count, "запись", "записи", "записей")} · ${formatSize(entry.bytes)}`)),
      side);

    if (have) {
      const updated = (entry.builtAt && have.builtAt && entry.builtAt > have.builtAt)
        || entry.count !== have.count;
      if (updated) {
        side.append(el("button.btn.btn--small.btn--primary", {
          type: "button",
          disabled: !packs.online(),
          title: `В каталоге ${entry.count} записей, установлено ${have.count}`,
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            e.currentTarget.textContent = "Обновление…";
            try {
              await packs.install(entry);
              toast("Пакет обновлён — прогресс сохранён");
              ctx.refresh();
            } catch (error) {
              toast(`Не получилось: ${error.message}`);
              ctx.refresh();
            }
          },
        }, "Обновить"));
      }
      if (entry.kind === "words" && !isActiveLevel) {
        side.append(el("button.btn.btn--small", {
          type: "button",
          onclick: async () => {
            await settingsStore.patch({ level: entry.level });
            toast(`Активный уровень: ${entry.level.toUpperCase()}`);
            ctx.refresh();
          },
        }, "Сделать активным"));
      }
      side.append(el("button.btn.btn--small.btn--danger", {
        type: "button",
        onclick: async () => {
          const yes = await confirmAction({
            title: `Удалить пакет ${packs.levelLabel(entry.level)}?`,
            text: "Слова этого пакета исчезнут из базы, но прогресс останется: "
              + "если поставить пакет заново, выученное так и будет выученным.",
          });
          if (!yes) return;
          await packs.uninstall(entry.lang, entry.level);
          toast("Пакет удалён");
          ctx.refresh();
        },
      }, "Удалить"));
    } else {
      const bar = el("div.bar", { hidden: true }, el("div.bar__fill", { style: "width:0%" }));
      const button = el("button.btn.btn--small.btn--primary", {
        type: "button",
        disabled: !packs.online(),
        onclick: async () => {
          const warning = connectionWarning(entry.bytes);
          if (warning) {
            const go = await confirmAction({
              title: "Загрузить пакет?", text: warning, confirmLabel: "Загрузить",
            });
            if (!go) return;
          }
          button.disabled = true;
          button.textContent = "Загрузка…";
          bar.hidden = false;
          try {
            await packs.install(entry, (value) => {
              bar.firstChild.style.width = `${Math.round(value * 100)}%`;
            });
            toast("Пакет загружен — дальше сеть не нужна");
            ctx.refresh();
          } catch (error) {
            toast(`Не получилось: ${error.message}`);
            button.disabled = false;
            button.textContent = "Загрузить";
            bar.hidden = true;
          }
        },
      }, "Загрузить");
      side.append(button);
      row.append(bar);
    }

    screen.append(row);
  }

  screen.append(el("p.screen__lead", {},
    "Пакет — это один файл с записями уровня. После загрузки он лежит в браузере, "
    + "и приложение работает без интернета. Прогресс хранится отдельно от пакетов, "
    + "поэтому переключение языка или удаление пакета его не стирают."));

  return screen;
}
