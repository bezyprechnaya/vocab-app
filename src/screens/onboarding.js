/* Онбординг при первом запуске: что это, три этапа дня, выбор языков и уровня,
   где живут данные (глава I, 3.5).

   Третий шаг — не рассказ, а действие: языки и уровень выбираются прямо здесь,
   и нужные пакеты ставятся сразу. Иначе первый день пришлось бы начинать
   на чужом уровне и идти менять его в другом разделе. */

import { el, toast } from "../ui.js";
import * as settingsStore from "../settings.js";
import * as packs from "../packs.js";
import { applyChoice, langChips } from "../choose.js";

export const title = () => "Знакомство";

const STEPS = [
  {
    mark: "📘",
    title: "Слова по уровням",
    text: "Каждый день — небольшой набор слов вашего уровня CEFR. "
      + "Фразовые глаголы идут отдельным занятием, устроенным точно так же.",
  },
  {
    mark: "1 · 2 · 3",
    title: "Три этапа дня",
    text: "Сначала отсеиваете знакомое, потом учите карточками, потом проверяете себя. "
      + "Что не вспомнилось — вернётся в карточки, пока круг не будет чистым.",
  },
  {
    mark: "🎯",
    title: "Языки и уровень",
    text: "Выберите язык, который изучаете, язык перевода и свой уровень — "
      + "нужные пакеты загрузятся сразу. Менять выбор можно когда угодно, "
      + "прогресс при этом не сбрасывается.",
    build: choiceBlock,
  },
  {
    mark: "🔒",
    title: "Данные остаются у вас",
    text: "Прогресс и история хранятся в этом браузере, без аккаунта и без отправки наружу. "
      + "Копию можно сохранить файлом в настройках — и перенести на другое устройство.",
  },
];

/** Выбор языков и уровня с немедленной установкой пакетов. Узел живёт сам:
    перерисовывает только ряды кнопок, чтобы не терять строку состояния. */
function choiceBlock(state) {
  const box = el("div.choice");
  const studySlot = el("div");
  const langSlot = el("div");
  const levelRow = el("div.chips");
  const hint = el("p.choice__hint");
  const bar = el("div.bar", { hidden: true }, el("div.bar__fill", { style: "width:0%" }));
  const status = el("p.choice__status");

  let busy = false;

  const pick = async (changes) => {
    if (busy) return;
    busy = true;
    bar.hidden = false;
    bar.firstChild.style.width = "5%";
    status.textContent = "Загружаем пакеты…";
    draw();
    try {
      const result = await applyChoice(changes, {
        onProgress: (value) => { bar.firstChild.style.width = `${Math.round(value * 100)}%`; },
      });
      state.study = result.settings.study;
      state.lang = result.settings.lang;
      state.level = result.settings.level;
      state.installed = await packs.installed();
      const ready = packs.needed(state)
        .every((code) => state.installed.has(`${code}|${state.level}`));
      status.textContent = ready
        ? `Готово: ${packs.LANG_NAMES[state.study] || state.study} → `
          + `${packs.LANG_NAMES[state.lang] || state.lang}, ${packs.levelLabel(state.level)}.`
        : `Пакет ${packs.levelLabel(state.level)} пока не получен — `
          + "попробуйте ещё раз или выберите другой уровень.";
    } catch (error) {
      status.textContent = `Не получилось загрузить: ${error.message}`;
    } finally {
      busy = false;
      bar.hidden = true;
      draw();
    }
  };

  const draw = () => {
    studySlot.replaceChildren(langChips({
      value: state.study, other: state.lang, disabled: busy, extra: state.langs,
      onPick: (study) => pick({ study }),
    }));
    langSlot.replaceChildren(langChips({
      value: state.lang, other: state.study, disabled: busy, extra: state.langs,
      onPick: (lang) => pick({ lang }),
    }));

    levelRow.textContent = "";
    for (const level of packs.LEVELS) {
      levelRow.append(el("button.chip" + (level === state.level ? ".chip--on" : ""), {
        type: "button",
        disabled: busy,
        title: packs.LEVEL_HINTS[level],
        onclick: () => pick({ level }),
      }, level.toUpperCase()));
    }

    hint.textContent = packs.LEVEL_HINTS[state.level] || "";
  };

  draw();
  box.append(
    el("div.choice__label", {}, "Изучаю"), studySlot,
    el("div.choice__label", {}, "Перевод"), langSlot,
    el("div.choice__label", {}, "Ваш уровень"), levelRow,
    hint, bar, status);
  return box;
}

export async function render(ctx) {
  const settings = await settingsStore.get();
  const state = {
    study: settings.study,
    lang: settings.lang,
    level: settings.level,
    catalog: [],
    installed: await packs.installed(),
    langs: [],
  };
  try {
    state.catalog = await packs.catalog();
  } catch (error) {
    console.warn("каталог пакетов недоступен:", error);
  }
  state.langs = [...new Set(state.catalog.map((p) => p.lang))];

  let step = 0;
  const box = el("div.onboarding");

  const finish = async () => {
    await settingsStore.patch({ onboarded: true });
    ctx.navigate("#/home", { replace: true });
    ctx.refresh();
  };

  const draw = () => {
    const current = STEPS[step];
    box.textContent = "";
    box.append(
      el("div.onboarding__mark", {}, current.mark),
      el("h2.onboarding__title", {}, current.title),
      el("p.onboarding__text", {}, current.text),
      // append() превращает null в строку «null» — узла тут может и не быть.
      ...(current.build ? [current.build(state)] : []),
      el("div.onboarding__dots", {}, STEPS.map((_, i) =>
        el("span.dot" + (i === step ? ".active" : i < step ? ".done" : "")))),
      el("div.actions", {},
        el("button.btn", { type: "button", onclick: finish }, "Пропустить"),
        el("button.btn.btn--primary", {
          type: "button",
          onclick: () => { if (step + 1 < STEPS.length) { step++; draw(); } else finish(); },
        }, step + 1 < STEPS.length ? "Дальше" : "Начать")));
  };

  // Пакет мог не поставиться при первом запуске — тогда об этом лучше сказать сразу.
  if (!state.installed.size) toast("Пакеты ещё не загружены — выберите языки и уровень");

  draw();
  return box;
}
