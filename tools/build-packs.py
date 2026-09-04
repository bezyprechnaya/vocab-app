#!/usr/bin/env python3
"""Сборка словарных пакетов: уровень (cefrpy) + пример (словарное API) + перевод.

Скрипт офлайновый инструмент разработчика, в приложение не входит. Результат его работы —
готовые JSON-пакеты в `packs/`, которые приложение просто скачивает и кладёт в IndexedDB.

Конвейер (глава I, 3.4):

  1. Уровень      cefrpy, офлайн, с учётом части речи, A1–C2.
  2. Пример       freedictionaryapi.com — смысл с совпадающей частью речи и его пример.
  3. Перевод      tools/data/overrides-<lang>.csv (ручной, метка `ok`), остальное —
                  deep-translator (метка `mt`). Пример переводится целым предложением.
  4. Запись       packs/<lang>/<level>.json и packs/index.json.

Запуск:

  python3 tools/build-packs.py --lang ru --level b1
  python3 tools/build-packs.py --lang ru --kind phrasal
  python3 tools/build-packs.py --lang es --level all
  python3 tools/build-packs.py --lang de --level b2 --engine mymemory

Свойства: возобновляемость (всё скачанное и переведённое лежит в tools/.cache/, повторный
запуск не делает работу заново), работа без сети (`--offline`: уровни считаются всегда,
остальное берётся из кэша, недостающее уходит в отчёт), отчёт в конце каждого прогона.

Зависимости: см. tools/requirements.txt.
"""
import argparse
import csv
import json
import math
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "tools" / "data"
CACHE = ROOT / "tools" / ".cache"
PACKS = ROOT / "packs"

SCHEMA = 1
LEVELS = ["a1", "a2", "b1", "b2", "c1", "c2"]
UA = "vocab-app-build-packs/1.0 (+https://github.com/bezyprechnaya/vocab-app)"

# Наши части речи → теги Penn Treebank, на которых работает cefrpy.
PENN = {"n": "NN", "v": "VB", "adj": "JJ", "adv": "RB", "prep": "IN",
        "conj": "CC", "pron": "PRP", "det": "DT", "num": "CD"}

# Наши части речи → названия в словарном API (для выбора примера по части речи).
POS_NAME = {"n": "noun", "v": "verb", "adj": "adjective", "adv": "adverb",
            "prep": "preposition", "conj": "conjunction", "pron": "pronoun",
            "det": "determiner", "num": "numeral"}

EM_SPACE = " "


# ─────────────────────────────────────────────────────────────── общие мелочи

def log(msg):
    print(msg, flush=True)


def norm_space(s):
    return " ".join((s or "").split()).strip()


def load_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def save_json(path, data, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    sep = (",", ":") if compact else (",", ": ")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=None if compact else 1,
                              separators=sep), encoding="utf-8")
    tmp.replace(path)


def safe_name(word):
    """Имя файла кэша для слова: пробелы и косые в путь не пускаем."""
    return re.sub(r"[^a-z0-9._-]", "_", word.lower())


# ───────────────────────────────────────────────────────────────── словник

def read_wordlist(kind):
    path = DATA / "wordlist-en.csv"
    if not path.exists():
        sys.exit(f"нет словника {path}\nсначала: python3 tools/import-legacy.py")
    out = []
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            en, pos = norm_space(r["en"]).lower(), norm_space(r["pos"])
            if not en or not pos:
                continue
            if kind != "all" and r["kind"] != kind:
                continue
            out.append({"en": en, "pos": pos, "kind": r["kind"]})
    # снятие дублей по слово+часть речи
    seen, uniq = set(), []
    for it in out:
        key = (it["en"], it["pos"])
        if key in seen:
            continue
        seen.add(key)
        uniq.append(it)
    return uniq


def read_overrides(lang):
    """Ручные переводы: (en, pos) → {tr, ex_en, ex_tr}. Перекрывают автоперевод."""
    path = DATA / f"overrides-{lang}.csv"
    if not path.exists():
        return {}
    out = {}
    with path.open(encoding="utf-8") as f:
        for r in csv.DictReader(f):
            en, pos = norm_space(r.get("en", "")).lower(), norm_space(r.get("pos", ""))
            tr = norm_space(r.get("tr", ""))
            if not en or not pos or not tr:
                continue
            out[(en, pos)] = {"tr": tr,
                              "ex_en": norm_space(r.get("ex_en", "")),
                              "ex_tr": norm_space(r.get("ex_tr", ""))}
    return out


# ───────────────────────────────────────────────────────────── шаг 1: уровень

class Levels:
    """Уровень CEFR по слову и части речи. Дробный результат cefrpy округляется
    до буквы в одном месте с зафиксированными границами: пересборка обязана давать
    тот же пакет."""

    def __init__(self):
        from cefrpy import CEFRAnalyzer
        self.analyzer = CEFRAnalyzer()
        self.cache_path = CACHE / "levels.json"
        self.cache = load_json(self.cache_path, {})
        self.dirty = False

    def value(self, en, pos):
        key = f"{en}|{pos}"
        if key in self.cache:
            return self.cache[key]
        penn = PENN.get(pos)
        val = self.analyzer.get_word_pos_level_float(en, penn) if penn else None
        if val is None:
            val = self.analyzer.get_average_word_level_float(en)
        self.cache[key] = val
        self.dirty = True
        return val

    def letter(self, en, pos):
        val = self.value(en, pos)
        if val is None:
            return None
        idx = int(math.floor(val + 0.5)) - 1        # 1.0→a1 … 6.0→c2, ровно .5 вверх
        return LEVELS[min(len(LEVELS) - 1, max(0, idx))]

    def flush(self):
        if self.dirty:
            save_json(self.cache_path, self.cache, compact=True)
            self.dirty = False


# ───────────────────────────────────────────────────────── шаг 2: пример

class Dictionary:
    """Примеры употребления из freedictionaryapi.com.

    Ответы кэшируются пофайлово, поэтому повторный прогон сети не касается.
    Лимит сервиса — 1000 запросов в час; между запросами держим паузу, на 429
    отступаем по экспоненте и уважаем Retry-After.
    """

    def __init__(self, lang="en", delay=0.5, offline=False):
        self.lang = lang
        self.delay = delay
        self.offline = offline
        self.dir = CACHE / "dict" / lang
        self.dir.mkdir(parents=True, exist_ok=True)
        self.stats = {"cache": 0, "net": 0, "miss": 0, "error": 0}

    def entry(self, word):
        path = self.dir / (safe_name(word) + ".json")
        if path.exists():
            self.stats["cache"] += 1
            return load_json(path, None)
        if self.offline:
            self.stats["miss"] += 1
            return None
        data = self._fetch(word)
        if data is not None:
            save_json(path, data, compact=True)
        return data

    def _fetch(self, word):
        url = ("https://freedictionaryapi.com/api/v1/entries/"
               f"{self.lang}/{urllib.parse.quote(word)}")
        backoff = 5
        for attempt in range(5):
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=30) as resp:
                    self.stats["net"] += 1
                    time.sleep(self.delay)
                    return json.loads(resp.read().decode("utf-8"))
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    self.stats["miss"] += 1
                    save_json(self.dir / (safe_name(word) + ".json"),
                              {"word": word, "entries": []}, compact=True)
                    time.sleep(self.delay)
                    return {"word": word, "entries": []}
                if e.code in (429, 503):
                    wait = int(e.headers.get("Retry-After") or backoff)
                    log(f"    лимит сервиса, пауза {wait} с")
                    time.sleep(wait)
                    backoff = min(backoff * 2, 300)
                    continue
                self.stats["error"] += 1
                return None
            except Exception:
                time.sleep(backoff)
                backoff = min(backoff * 2, 60)
        self.stats["error"] += 1
        return None

    # ── выбор примера ──────────────────────────────────────────────────────

    @staticmethod
    def _candidates(data):
        for entry in data.get("entries", []):
            pos = entry.get("partOfSpeech")
            for sense in entry.get("senses", []):
                definition = norm_space(sense.get("definition") or "")
                for raw in sense.get("examples") or []:
                    for part in re.split(f"[{EM_SPACE}\n]", raw or ""):
                        text = norm_space(part)
                        if text:
                            yield pos, definition, text

    def example(self, word, pos):
        """Лучший пример: слово в нём обязано встретиться (иначе пример не о нём),
        дальше — совпадение части речи и похожесть на живое предложение.
        Возвращает (пример, определение)."""
        data = self.entry(word)
        if not data:
            return "", ""
        want = POS_NAME.get(pos)
        stem = self._stem(word)
        best, best_score = None, -1e9
        for cand_pos, definition, text in self._candidates(data):
            if not (15 <= len(text) <= 120):
                continue
            low = text.lower()
            if stem and stem not in low:
                continue                       # пример не про это слово — не берём
            score = 0.0
            if want and cand_pos == want:
                score += 6
            elif want:
                score -= 3
            if text[0].isupper() and text[-1] in ".!?":
                score += 3                     # цельное предложение, а не обрывок
            if ";" in text:
                score -= 4                     # перечисление словосочетаний, не пример
            score -= abs(len(text) - 60) / 60.0
            if score > best_score:
                best, best_score = (text, definition), score
        if not best:
            return "", ""
        return best

    @staticmethod
    def _stem(word):
        """Огрубленная основа слова: пример ищем по ней, чтобы поймать словоформы
        (`afford` → `affor`, поймает `afforded`, `affording`)."""
        first = re.split(r"[^a-z]+", word.lower())[0]
        if len(first) <= 4:
            return first
        return first[:max(4, len(first) - 2)]

    def definition(self, word, pos):
        """Определение на английском — для одноязычного режима (--lang en)."""
        data = self.entry(word)
        if not data:
            return ""
        want = POS_NAME.get(pos)
        fallback = ""
        for entry in data.get("entries", []):
            for sense in entry.get("senses", []):
                text = norm_space(sense.get("definition") or "")
                if not text:
                    continue
                text = re.sub(r"^\((?:obsolete|archaic|rare|dated)\)\s*", "", text)
                if entry.get("partOfSpeech") == want:
                    return text
                fallback = fallback or text
        return fallback


# ─────────────────────────────────────────────────────── шаг 3: перевод

class Translator:
    """deep-translator с кэшем на диске.

    Переводим построчно: `translate_batch` внутри библиотеки — это тот же цикл по
    одному запросу на строку, но одна осечка роняет всю пачку и теряет уже сделанное.
    Построчно с сохранением кэша каждые 20 строк прогон становится по-настоящему
    возобновляемым. Бесплатный Google-эндпоинт неофициальный, поэтому между строками
    держим паузу, а на ошибке отступаем по экспоненте.
    """

    FLUSH_EVERY = 20

    # MyMemory принимает не коды, а названия языков.
    MYMEMORY = {"en": "english", "ru": "russian", "es": "spanish",
                "de": "german", "fr": "french"}

    def __init__(self, lang, engine="google", offline=False, delay=0.2):
        self.lang = lang
        self.engine = engine
        self.offline = offline
        self.delay = delay
        self.path = CACHE / f"tr-{engine}-{lang}.json"
        self.cache = load_json(self.path, {})
        self.stats = {"cache": 0, "net": 0, "fail": 0}
        self._engine = None

    def _make_engine(self):
        if self._engine is not None:
            return self._engine
        import deep_translator as dt
        engines = {"google": dt.GoogleTranslator, "mymemory": dt.MyMemoryTranslator,
                   "libre": dt.LibreTranslator, "deepl": dt.DeeplTranslator}
        cls = engines.get(self.engine)
        if cls is None:
            sys.exit(f"неизвестный движок перевода: {self.engine}")
        source, target = "en", self.lang
        if self.engine == "mymemory":
            if self.lang not in self.MYMEMORY:
                sys.exit(f"для движка mymemory не задано название языка {self.lang}")
            source, target = "english", self.MYMEMORY[self.lang]
        self._engine = cls(source=source, target=target)
        supported = self._engine.get_supported_languages(as_dict=True)
        if target not in supported and target not in supported.values():
            sys.exit(f"движок {self.engine} не знает язык {target}")
        return self._engine

    def prime(self, texts):
        """Переводит всё, чего ещё нет в кэше."""
        todo = [t for t in dict.fromkeys(texts) if t and t not in self.cache]
        self.stats["cache"] += len(texts) - len(todo)
        if not todo:
            return
        if self.offline:
            self.stats["fail"] += len(todo)
            return
        engine = self._make_engine()
        for n, text in enumerate(todo, 1):
            backoff = 5
            for attempt in range(4):
                try:
                    result = norm_space(engine.translate(text) or "")
                    if result and result.lower() != text.lower():
                        self.cache[text] = result
                        self.stats["net"] += 1
                    else:
                        self.stats["fail"] += 1
                    break
                except Exception as e:
                    if attempt == 3:
                        self.stats["fail"] += 1
                        log(f"    не переведено: {text[:50]!r} ({type(e).__name__})")
                        break
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 120)
            if n % self.FLUSH_EVERY == 0 or n == len(todo):
                self.flush()
                log(f"    перевод {n}/{len(todo)} (не удалось {self.stats['fail']})")
            time.sleep(self.delay)

    def get(self, text):
        return self.cache.get(text, "")

    def flush(self):
        save_json(self.path, self.cache, compact=True)


# ───────────────────────────────────────────────────────────── сборка пакета

def build(args):
    CACHE.mkdir(parents=True, exist_ok=True)
    lang = args.lang
    mono = lang == "en"

    wordlist = read_wordlist(args.kind)
    overrides = read_overrides(lang)
    levels = Levels()
    report = {"no_level": [], "no_example": [], "no_translation": [], "dropped": []}

    # ── шаг 1: раскладываем словник по уровням ────────────────────────────
    graded = []
    for item in wordlist:
        if item["kind"] == "phrasal":
            level = "phrasal"          # фразовые глаголы — отдельный пакет, не уровень
        else:
            level = levels.letter(item["en"], item["pos"])
            if level is None:
                report["no_level"].append(f"{item['en']}|{item['pos']}")
                continue
        graded.append(dict(item, level=level))
    levels.flush()

    wanted = args.levels
    selected = [it for it in graded if it["level"] in wanted]
    if args.limit:
        selected = selected[:args.limit]
    if not selected:
        sys.exit(f"по запросу ничего не выбрано: уровни {sorted(wanted)}, вид {args.kind}")

    log(f"словник: {len(wordlist)}, с уровнем: {len(graded)}, "
        f"к сборке: {len(selected)} ({', '.join(sorted(wanted))})")

    # ── шаг 2: примеры ────────────────────────────────────────────────────
    dictionary = Dictionary(delay=args.delay, offline=args.offline)
    for n, item in enumerate(selected, 1):
        src = overrides.get((item["en"], item["pos"]), {})
        if src.get("ex_en"):
            item["ex_en"] = src["ex_en"]
            item["ex_tr"] = src.get("ex_tr", "")
            item["definition"] = ""
            continue
        example, definition = dictionary.example(item["en"], item["pos"])
        item["ex_en"] = example
        item["ex_tr"] = ""
        item["definition"] = definition or (dictionary.definition(item["en"], item["pos"])
                                            if mono else "")
        if not example:
            report["no_example"].append(f"{item['en']}|{item['pos']}")
        if n % 100 == 0 or n == len(selected):
            log(f"  примеры {n}/{len(selected)} "
                f"(кэш {dictionary.stats['cache']}, сеть {dictionary.stats['net']})")

    # ── шаг 3: переводы ───────────────────────────────────────────────────
    translator = None
    if not mono:
        translator = Translator(lang, engine=args.engine, offline=args.offline,
                                delay=args.pause)
        need = []
        for item in selected:
            src = overrides.get((item["en"], item["pos"]), {})
            if not src.get("tr"):
                need.append(item["en"])
            if item["ex_en"] and not (src.get("ex_tr") or "").strip():
                need.append(item["ex_en"])
        log(f"  к переводу: {len(set(need))} строк "
            f"(в кэше уже {sum(1 for t in set(need) if t in translator.cache)})")
        translator.prime(need)
        translator.flush()

    # ── шаг 4: запись пакетов ─────────────────────────────────────────────
    by_level = {}
    for item in selected:
        src = overrides.get((item["en"], item["pos"]), {})
        tr = src.get("tr", "")
        origin = "ok" if tr else "mt"
        if not tr:
            tr = translator.get(item["en"]) if translator else item["definition"]
        ex_tr = src.get("ex_tr", "")
        if item["ex_en"] and not ex_tr:
            if mono:
                ex_tr = ""
            else:
                ex_tr = translator.get(item["ex_en"]) if translator else ""
                if ex_tr:
                    origin = "mt"      # в записи есть машинный перевод — честно помечаем
        if not tr:
            report["no_translation"].append(f"{item['en']}|{item['pos']}")
            report["dropped"].append(f"{item['en']}|{item['pos']} — нет перевода")
            continue
        if tr.lower() == item["en"].lower():
            report["dropped"].append(f"{item['en']}|{item['pos']} — перевод совпал с оригиналом")
            continue
        by_level.setdefault(item["level"], []).append(
            [item["en"], item["pos"], tr, item["ex_en"], ex_tr, origin])

    PACKS.mkdir(parents=True, exist_ok=True)
    written = []
    for level, items in sorted(by_level.items()):
        items.sort(key=lambda r: (r[0], r[1]))
        pack = {"schema": SCHEMA,
                "kind": "phrasal" if level == "phrasal" else "words",
                "lang": lang,
                "level": level,
                "count": len(items),
                "builtAt": time.strftime("%Y-%m-%d"),
                "engine": "manual" if mono else args.engine,
                "items": items}
        path = PACKS / lang / f"{level}.json"
        save_json(path, pack, compact=True)
        written.append(path)
        log(f"  записан {path.relative_to(ROOT)} — {len(items)} записей, "
            f"{path.stat().st_size // 1024} КБ")

    write_index()
    print_report(selected, by_level, report, dictionary, translator)
    return written


def write_index():
    """packs/index.json — каталог всех собранных пакетов."""
    entries = []
    for path in sorted(PACKS.glob("*/*.json")):
        if path.name == "index.json":
            continue
        pack = load_json(path, None)
        if not pack or "items" not in pack:
            continue
        entries.append({"lang": pack["lang"], "level": pack["level"],
                        "kind": pack.get("kind", "words"), "count": pack["count"],
                        "bytes": path.stat().st_size, "builtAt": pack.get("builtAt", ""),
                        "path": f"{pack['lang']}/{path.name}"})
    save_json(PACKS / "index.json", {"schema": SCHEMA, "packs": entries})
    log(f"  каталог packs/index.json — {len(entries)} пакетов")


def print_report(selected, by_level, report, dictionary, translator):
    total = len(selected)
    kept = sum(len(v) for v in by_level.values())
    ok = sum(1 for items in by_level.values() for r in items if r[5] == "ok")
    with_ex = sum(1 for items in by_level.values() for r in items if r[3])
    log("\n──── отчёт ────")
    log(f"  на сборку        {total}")
    log(f"  в пакетах        {kept}" + "".join(
        f"\n      {lvl}: {len(items)}" for lvl, items in sorted(by_level.items())))
    log(f"  с примером       {with_ex} ({with_ex * 100 // max(kept, 1)} %)")
    log(f"  выверено (ok)    {ok}   машинных (mt) {kept - ok}")
    log(f"  словарь          кэш {dictionary.stats['cache']}, сеть {dictionary.stats['net']}, "
        f"нет статьи {dictionary.stats['miss']}, ошибок {dictionary.stats['error']}")
    if translator:
        log(f"  переводчик       кэш {translator.stats['cache']}, "
            f"сеть {translator.stats['net']}, не переведено {translator.stats['fail']}")
    log(f"  без уровня       {len(report['no_level'])}"
        + (f"  например: {', '.join(report['no_level'][:5])}" if report["no_level"] else ""))
    log(f"  без примера      {len(report['no_example'])}"
        + (f"  например: {', '.join(report['no_example'][:5])}" if report["no_example"] else ""))
    log(f"  отброшено        {len(report['dropped'])}"
        + (f"  например: {', '.join(report['dropped'][:3])}" if report["dropped"] else ""))
    path = CACHE / "last-report.json"
    save_json(path, report)
    log(f"  полный список причин: {path.relative_to(ROOT)}")


def parse_args(argv):
    p = argparse.ArgumentParser(description="Сборка словарных пакетов для vocab-app")
    p.add_argument("--lang", default="ru", help="язык перевода: ru, es, de, fr, en (одноязычный)")
    p.add_argument("--level", default="b1",
                   help="уровень: a1…c2, all (все уровни) или phrasal")
    p.add_argument("--kind", default=None, choices=["words", "phrasal", "all"],
                   help="вид словника; по умолчанию выводится из --level")
    p.add_argument("--engine", default="google",
                   choices=["google", "mymemory", "libre", "deepl"])
    p.add_argument("--limit", type=int, default=0, help="взять только N записей (для проверки)")
    p.add_argument("--delay", type=float, default=0.5, help="пауза между запросами к словарю, с")
    p.add_argument("--pause", type=float, default=0.2, help="пауза между запросами к переводчику, с")
    p.add_argument("--offline", action="store_true",
                   help="не ходить в сеть: только кэш и overrides")
    args = p.parse_args(argv)

    level = args.level.lower()
    if level == "all":
        args.levels = set(LEVELS)
    elif level == "phrasal":
        args.levels = {"phrasal"}
    elif level in LEVELS:
        args.levels = {level}
    else:
        p.error(f"неизвестный уровень: {args.level}")
    if args.kind is None:
        args.kind = "phrasal" if args.levels == {"phrasal"} else "words"
    if args.kind == "phrasal":
        args.levels = {"phrasal"}
    return args


if __name__ == "__main__":
    build(parse_args(sys.argv[1:]))
