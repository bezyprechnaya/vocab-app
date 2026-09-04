/* Перевод строк на лету — для сборки пакета прямо в приложении.

   Готовые пакеты собирает офлайновый скрипт, но языков всегда больше, чем
   собранных пакетов. Слова и примеры уровня уже лежат в базе по-английски,
   поэтому недостающий язык — это перевод этих строк и ничего больше.

   Строки уходят пачками: разделитель — перевод строки, ответ приходит сегментами,
   которые склеиваются обратно и режутся по тем же переводам строк. Сервис
   публичный и неофициальный, поэтому пачка, вернувшаяся не тем числом строк,
   переводится построчно, а безнадёжная строка остаётся пустой: пакет соберётся
   и без неё. */

const ENDPOINT = "https://translate.googleapis.com/translate_a/single";
const BATCH_LINES = 20;      // столько строк в одном запросе
const BATCH_CHARS = 900;     // и не длиннее: запрос уходит в адресной строке
const PARALLEL = 4;          // столько запросов одновременно
const RETRIES = 3;

function url(text, lang) {
  const params = new URLSearchParams({ client: "gtx", sl: "en", tl: lang, dt: "t", q: text });
  return `${ENDPOINT}?${params}`;
}

async function ask(text, lang, signal) {
  let wait = 700;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url(text, lang), { signal });
      if (!response.ok) throw new Error(`переводчик ответил ${response.status}`);
      const data = await response.json();
      return (data[0] || []).map((segment) => segment[0] || "").join("");
    } catch (error) {
      if (error.name === "AbortError" || attempt >= RETRIES) throw error;
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait *= 2;
    }
  }
}

/** Пачка одним запросом; не сошлось число строк — переводим её по одной. */
async function translateBatch(lines, lang, signal) {
  try {
    const joined = await ask(lines.join("\n"), lang, signal);
    const parts = joined.split("\n");
    if (parts.length === lines.length) return parts.map((part) => part.trim());
  } catch (error) {
    if (error.name === "AbortError") throw error;
  }
  const out = [];
  for (const line of lines) {
    try {
      out.push((await ask(line, lang, signal)).trim());
    } catch (error) {
      if (error.name === "AbortError") throw error;
      out.push("");
    }
  }
  return out;
}

function chunk(texts) {
  const out = [];
  let batch = [], chars = 0;
  for (const text of texts) {
    if (batch.length >= BATCH_LINES || chars + text.length > BATCH_CHARS) {
      if (batch.length) out.push(batch);
      batch = []; chars = 0;
    }
    batch.push(text);
    chars += text.length + 1;
  }
  if (batch.length) out.push(batch);
  return out;
}

/** Перевод набора строк. Возвращает Map «оригинал → перевод»; строки, которые
    сервис не осилил, в карту не попадают. */
export async function many(texts, lang, { onProgress = () => {}, signal } = {}) {
  const unique = [...new Set(texts.filter(Boolean))];
  const batches = chunk(unique);
  const total = batches.length;
  const out = new Map();
  let done = 0;

  const worker = async () => {
    for (;;) {
      const batch = batches.shift();
      if (!batch) return;
      const parts = await translateBatch(batch, lang, signal);
      // Совпадение с оригиналом не выбрасываем: «hotel» и по-испански «hotel»,
      // а потерянное слово выглядело бы как дырка в пакете.
      batch.forEach((text, i) => {
        if (parts[i]) out.set(text, parts[i]);
      });
      done++;
      onProgress(done / total, out.size, unique.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(PARALLEL, batches.length) }, worker));
  return out;
}
