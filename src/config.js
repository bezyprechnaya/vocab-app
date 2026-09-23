/* Всё настраиваемое — здесь. Новый язык, уровень или вид карточек добавляются
   правкой этого файла, а не поиском по src/. */

export const CONFIG = {
  levels: ["a1", "a2", "b1", "b2", "c1", "c2"],

  langs: {
    en: { name: "Английский", flag: "🇬🇧" },
    ru: { name: "Русский", flag: "🇷🇺" },
    es: { name: "Испанский", flag: "🇪🇸" },
    de: { name: "Немецкий", flag: "🇩🇪" },
    fr: { name: "Французский", flag: "🇫🇷" },
  },

  /* Вид пакета: свои уровни, свой размер набора, общий движок дня. */
  kinds: {
    words: { title: "Слова дня", short: "Слова", icon: "book", levels: "*", sizes: [5, 7, 10, 12] },
    phrasal: { title: "Фразовые глаголы", short: "Фразовые", icon: "link", levels: ["phrasal"], sizes: [3, 5, 7] },
  },

  levelNames: {
    a1: "A1 · начальный", a2: "A2 · базовый", b1: "B1 · средний",
    b2: "B2 · выше среднего", c1: "C1 · продвинутый", c2: "C2 · владение",
    phrasal: "Фразовые глаголы",
  },

  levelHints: {
    a1: "Первые слова: приветствия, числа, простые вещи вокруг.",
    a2: "Быт и простые темы: работа, покупки, дорога, семья.",
    b1: "Разговор без словаря на знакомые темы, новости в общих чертах.",
    b2: "Свободное общение, фильмы и статьи почти без пропусков.",
    c1: "Сложные тексты и оттенки смысла, профессиональная речь.",
    c2: "Редкие и книжные слова, уровень носителя.",
  },

  pos: {
    n: "сущ.", v: "глаг.", adj: "прил.", adv: "нареч.", prep: "предлог",
    conj: "союз", pron: "мест.", det: "опред.", num: "числ.",
  },

  themes: [["auto", "Как в системе"], ["light", "Светлая"], ["dark", "Тёмная"]],

  defaults: {
    id: "app", study: "en", lang: "ru", level: "b1",
    theme: "auto", onboarded: false, per: { words: 10, phrasal: 5 },
  },

  /* Боковая панель: маршрут, значок, подпись. */
  nav: [
    ["/home", "book", "Обучение"],
    ["/history", "calendar", "История"],
    ["/packs", "globe", "Языки"],
    ["/settings", "settings", "Настройки"],
  ],

  recommendedTotal: 15,   // потолок набора дня: больше — не быстрее
  againAfter: 4,          // через сколько карточек вернётся «ещё раз» в бесконечном
};

/** Вид по уровню: «phrasal» — свой вид, остальные уровни — слова. */
export const kindOf = (level) =>
  Object.keys(CONFIG.kinds).find((k) => CONFIG.kinds[k].levels !== "*"
    && CONFIG.kinds[k].levels.includes(level)) || "words";

export const langName = (code) => CONFIG.langs[code]?.name || code.toUpperCase();
export const langFlag = (code) => CONFIG.langs[code]?.flag || "🏳️";
export const levelName = (level) => CONFIG.levelNames[level] || level.toUpperCase();
export const posName = (pos) => (pos.startsWith("phr") ? "фразовый глагол" : CONFIG.pos[pos] || pos);
