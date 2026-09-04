/* Онбординг при первом запуске: четыре экрана — что это, три этапа дня,
   язык и уровень, где живут данные (глава I, 3.5). */

import { el } from "../ui.js";
import * as settingsStore from "../settings.js";
import * as packs from "../packs.js";

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
    mark: "🌍",
    title: "Язык и уровень",
    text: "Слова приходят пакетами: один язык, один уровень. Пакет скачивается один раз "
      + "и дальше работает без интернета. Менять язык и уровень можно когда угодно — "
      + "прогресс при этом не сбрасывается.",
  },
  {
    mark: "🔒",
    title: "Данные остаются у вас",
    text: "Прогресс и история хранятся в этом браузере, без аккаунта и без отправки наружу. "
      + "Копию можно сохранить файлом в настройках — и перенести на другое устройство.",
  },
];

export async function render(ctx) {
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
      el("div.onboarding__dots", {}, STEPS.map((_, i) =>
        el("span.dot" + (i === step ? ".active" : i < step ? ".done" : "")))),
      el("div.actions", {},
        el("button.btn", { type: "button", onclick: finish }, "Пропустить"),
        el("button.btn.btn--primary", {
          type: "button",
          onclick: () => { if (step + 1 < STEPS.length) { step++; draw(); } else finish(); },
        }, step + 1 < STEPS.length ? "Дальше" : "Начать")));
  };

  // Стартовые пакеты уже стоят — покажем, с чем начинаем.
  const installed = await packs.installed();
  if (installed.size) {
    STEPS[2].text += ` Сейчас загружено пакетов: ${installed.size}.`;
  }

  draw();
  return box;
}
