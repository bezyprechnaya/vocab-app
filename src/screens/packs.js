/* «Языки и уровни»: выбор пары языков, уровня, загрузка, сборка и удаление
   пакетов (глава I, 3.2).

   Языка два: изучаемый — лицевая сторона карточки, язык перевода — оборот.
   Пара может требовать двух пакетов сразу, поэтому строка уровня показывает
   состояние обеих сторон, а кнопка доводит до готовности сразу обе.

   Нажатие на язык или уровень — законченное действие: нужные пакеты приезжают
   сразу. Готового файла в каталоге может не быть — тогда пакет собирается прямо
   в приложении переводом английских слов и примеров.

   Загруженный пакет живёт в IndexedDB — после установки сеть не нужна.
   Удаление пакета не трогает прогресс: выученное остаётся выученным. */

import { el, formatSize, plural, confirmAction, toast } from "../ui.js";
import * as packs from "../packs.js";
import * as session from "../session.js";
import * as progress from "../progress.js";
import * as settingsStore from "../settings.js";
import { applyChoice, buildMissing, langChips } from "../choose.js";

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
        "Загрузка и сборка пакетов недоступны. Уже загруженные пакеты работают как обычно.")));
  }

  // ── выбор языка и уровня ─────────────────────────────────────────────
  // Начатый день набран на прежнем уровне и сам не поменяется — предложим начать
  // заново, иначе смена уровня выглядит так, будто ничего не произошло.
  const offerRestart = async (level) => {
    const today = await session.load("words");
    if (!today || today.phase === "done" || today.level === level) return;
    const yes = await confirmAction({
      title: "Начать день заново?",
      text: `Сегодняшний набор слов взят с уровня ${today.level.toUpperCase()}. `
        + `Заново — значит новый набор с уровня ${level.toUpperCase()}; `
        + "выученное останется выученным.",
      confirmLabel: "Начать заново",
    });
    if (!yes) return;
    await session.removeDay(today.id);
    toast("День начат заново");
  };

  const bar = el("div.bar", { hidden: true }, el("div.bar__fill", { style: "width:0%" }));

  const choose = async (changes) => {
    bar.hidden = false;
    bar.firstChild.style.width = "5%";
    try {
      await applyChoice(changes, {
        onProgress: (value) => { bar.firstChild.style.width = `${Math.round(value * 100)}%`; },
      });
      if (changes.level) await offerRestart(changes.level);
    } catch (error) {
      toast(`Не получилось загрузить: ${error.message}`);
    }
    ctx.refresh();
  };

  // Показываем все языки первой очереди, даже если пакеты для них ещё не собраны:
  // недостающий язык собирается на месте, и знать о такой возможности нужно заранее.
  const extra = [...new Set(catalog.map((p) => p.lang))];

  screen.append(el("h2.section-title", {}, "Изучаю"));
  screen.append(langChips({
    value: settings.study, other: settings.lang, extra,
    onPick: (study) => choose({ study }),
  }));

  screen.append(el("h2.section-title", {}, "Перевод"));
  screen.append(langChips({
    value: settings.lang, other: settings.study, extra,
    onPick: (lang) => choose({ lang }),
  }));

  screen.append(el("h2.section-title", {}, "Уровень слов дня"));
  screen.append(el("div.chips", {}, packs.LEVELS.map((level) =>
    el("button.chip" + (level === settings.level ? ".chip--on" : ""), {
      type: "button",
      title: packs.LEVEL_HINTS[level],
      onclick: () => choose({ level }),
    }, level.toUpperCase()))));
  screen.append(el("p.screen__lead", {}, packs.LEVEL_HINTS[settings.level] || ""));
  screen.append(bar);

  if (catalogError) {
    screen.append(el("div.card", {},
      el("div.row__title", {}, "Каталог недоступен"),
      el("p.muted", { style: "margin:4px 0 0" }, String(catalogError.message || catalogError))));
  }

  // ── пакеты выбранной пары ────────────────────────────────────────────
  // Строка на каждый уровень. Сторон у пары может быть две, и каждая приходит
  // своим способом: готовый файл из каталога или сборка здесь. Кнопка одна —
  // она закрывает всё, чего не хватает.
  const langName = (code) => packs.LANG_NAMES[code] || code.toUpperCase();
  const entryOf = (lang, level) =>
    catalog.find((p) => p.lang === lang && p.level === level) || null;
  const sides = packs.needed(settings);

  screen.append(el("h2.section-title", {}, "Пакеты"));

  for (const level of [...packs.LEVELS, "phrasal"]) {
    const kind = level === "phrasal" ? "phrasal" : "words";
    const parts = sides.map((lang) => ({
      lang,
      entry: entryOf(lang, level),
      have: installed.get(`${lang}|${level}`) || null,
    }));
    const stats = await progress.levelStats(kind, level);

    // Английская сторона своего файла может не иметь — тогда словам уровня всё
    // равно нужен хоть какой-то пакет: из него берутся сами слова и примеры.
    if (!stats.total && !parts.some((part) => part.have || part.entry)) {
      const best = catalog.filter((p) => p.level === level).sort((a, b) => b.count - a.count)[0];
      if (best) parts.push({ lang: best.lang, entry: best, have: null });
    }

    // Английская сторона без файла не «недостача»: на обороте будет само слово.
    const missing = parts.filter((part) => !part.have
      && !(packs.optional(part.lang) && !part.entry));
    const isActiveLevel = settings.level === level && kind === "words";

    const side = el("span.row__side");
    const rowBar = el("div.bar", { hidden: true }, el("div.bar__fill", { style: "width:0%" }));

    const describe = (part) => {
      if (part.have && part.have.origin === "local") return `собран здесь ${part.have.installedAt}`;
      if (part.have) return `загружен ${part.have.installedAt}`;
      if (part.entry) {
        return `${plural(part.entry.count, "запись", "записи", "записей")}`
          + ` · ${formatSize(part.entry.bytes)}`;
      }
      return packs.optional(part.lang)
        ? "толкования нет — на обороте само слово"
        : "готового файла нет — соберём здесь";
    };
    const sub = [
      parts.length > 1
        ? parts.map((part) => `${langName(part.lang)}: ${describe(part)}`).join(" · ")
        : describe(parts[0]),
      missing.length ? null : `выучено ${stats.learned} из ${stats.total}`,
    ].filter(Boolean).join(" · ");

    const row = el("div.row.row--static", {},
      el("span.row__body", {},
        el("span.row__title", {}, packs.levelLabel(level),
          isActiveLevel ? el("span.badge-mt", { title: "Слова дня берутся отсюда" }, "активный") : null),
        el("span.row__sub", {}, sub)),
      side);

    if (!missing.length) {
      const stale = parts.filter((part) => part.have && part.entry
        && ((part.entry.builtAt && part.have.builtAt && part.entry.builtAt > part.have.builtAt)
          || part.entry.count !== part.have.count));
      if (stale.length) {
        side.append(el("button.btn.btn--small.btn--primary", {
          type: "button",
          disabled: !packs.online(),
          title: stale.map((part) => `${langName(part.lang)}: в каталоге ${part.entry.count},`
            + ` установлено ${part.have.count}`).join("; "),
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            e.currentTarget.textContent = "Обновление…";
            try {
              for (const part of stale) await packs.install(part.entry);
              toast("Пакет обновлён — прогресс сохранён");
            } catch (error) {
              toast(`Не получилось: ${error.message}`);
            }
            ctx.refresh();
          },
        }, "Обновить"));
      }
      if (kind === "words" && !isActiveLevel) {
        side.append(el("button.btn.btn--small", {
          type: "button",
          onclick: () => choose({ level }),
        }, "Сделать активным"));
      }
      const installedParts = parts.filter((part) => part.have);
      if (installedParts.length) {
        side.append(el("button.btn.btn--small.btn--danger", {
          type: "button",
          onclick: async () => {
            const yes = await confirmAction({
              title: `Удалить пакет ${packs.levelLabel(level)}?`,
              text: `Слова этого уровня (${installedParts.map((part) => langName(part.lang)).join(", ")}) `
                + "исчезнут из базы, но прогресс останется: если поставить пакет заново, "
                + "выученное так и будет выученным.",
            });
            if (!yes) return;
            for (const part of installedParts) await packs.uninstall(part.lang, level);
            toast("Пакет удалён");
            ctx.refresh();
          },
        }, "Удалить"));
      }
    } else {
      const bytes = missing.reduce((sum, part) => sum + (part.entry?.bytes || 0), 0);
      const label = missing.every((part) => part.entry) ? "Загрузить" : "Собрать";
      const button = el("button.btn.btn--small.btn--primary", {
        type: "button",
        disabled: !packs.online(),
        onclick: async () => {
          const warning = connectionWarning(bytes);
          if (warning) {
            const go = await confirmAction({
              title: "Загрузить пакет?", text: warning, confirmLabel: "Загрузить",
            });
            if (!go) return;
          }
          button.disabled = true;
          button.textContent = "Загрузка…";
          rowBar.hidden = false;
          try {
            for (const part of missing) {
              if (part.entry) {
                await packs.install(part.entry, (value) => {
                  rowBar.firstChild.style.width = `${Math.round(value * 100)}%`;
                });
              } else if (!await buildMissing(part.lang, level)) {
                break;
              }
            }
            ctx.refresh();
          } catch (error) {
            toast(`Не получилось: ${error.message}`);
            button.disabled = false;
            button.textContent = label;
            rowBar.hidden = true;
          }
        },
      }, label);
      side.append(button);
      row.append(rowBar);
    }

    screen.append(row);
  }

  screen.append(el("p.screen__lead", {},
    "Пакет — это записи одного уровня на одном языке: слово, перевод и пример. "
    + "Карточке нужны две стороны, поэтому пара языков может требовать двух пакетов. "
    + "Готовые пакеты скачиваются файлом, остальные собираются здесь переводом "
    + "английских слов и примеров — такие записи помечены «mt». После этого пакеты "
    + "лежат в браузере, и приложение работает без интернета. Прогресс хранится "
    + "отдельно от пакетов, поэтому смена языков или удаление пакета его не стирают."));

  return screen;
}
