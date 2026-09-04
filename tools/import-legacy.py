#!/usr/bin/env python3
"""Разовый импорт данных старого приложения в исходники сборщика пакетов.

Читает `words-b1.js`, `words-b2.js`, `words-c1.js` и `phrasal-verbs.js` — 3610 слов
и 208 фразовых глаголов с выверенными вручную русскими переводами — и раскладывает их
по двум файлам, с которыми дальше работает `build-packs.py`:

    tools/data/wordlist-en.csv     en,pos,kind      — словник (уровень назначает cefrpy)
    tools/data/overrides-ru.csv    en,pos,tr,ex_en,ex_tr,note
                                                    — ручные переводы, метка `ok`

Уровни из имён старых файлов НЕ переносятся: их заново считает cefrpy при сборке.
Из старых файлов берётся только ручная работа — переводы и примеры.

Части речи фразовых глаголов: `phr`, а для повторов одного глагола с разными значениями
`phr2`, `phr3` и т.д. — ключ записи `en|pos` обязан быть уникальным.

Запуск:  python3 tools/import-legacy.py
"""
import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "tools" / "data"

WORD_FILES = ["words-b1.js", "words-b2.js", "words-c1.js"]
PHRASAL_FILE = "phrasal-verbs.js"

ROW_RE = re.compile(r"^\[.*\],?$")


def read_rows(path):
    """Достаёт из js-файла массив записей: каждая строка вида ["a","b",...],"""
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not ROW_RE.match(line):
            continue
        rows.append(json.loads(line.rstrip(",")))
    return rows


def norm(s):
    return " ".join(s.split()).strip()


def main():
    DATA.mkdir(parents=True, exist_ok=True)

    wordlist = []        # (en, pos, kind)
    overrides = []       # (en, pos, tr, ex_en, ex_tr)
    seen = set()
    dropped = 0

    for name in WORD_FILES:
        path = ROOT / name
        if not path.exists():
            sys.exit(f"нет файла {path}")
        for row in read_rows(path):
            en, pos, tr = norm(row[0]).lower(), norm(row[1]), norm(row[2])
            if not en or not tr:
                dropped += 1
                continue
            key = (en, pos)
            if key in seen:
                dropped += 1
                continue
            seen.add(key)
            wordlist.append((en, pos, "words"))
            overrides.append((en, pos, tr, "", ""))

    senses = {}
    for row in read_rows(ROOT / PHRASAL_FILE):
        en, tr, ex_en, ex_tr = (norm(x) for x in row[:4])
        en = en.lower()
        if not en or not tr:
            dropped += 1
            continue
        n = senses.get(en, 0) + 1
        senses[en] = n
        pos = "phr" if n == 1 else f"phr{n}"
        wordlist.append((en, pos, "phrasal"))
        overrides.append((en, pos, tr, ex_en, ex_tr))

    with (DATA / "wordlist-en.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["en", "pos", "kind"])
        w.writerows(wordlist)

    with (DATA / "overrides-ru.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["en", "pos", "tr", "ex_en", "ex_tr", "note"])
        for en, pos, tr, ex_en, ex_tr in overrides:
            w.writerow([en, pos, tr, ex_en, ex_tr, ""])

    words = sum(1 for _, _, k in wordlist if k == "words")
    phrasal = len(wordlist) - words
    print(f"словник:   {words} слов + {phrasal} фразовых глаголов")
    print(f"переводы:  {len(overrides)} записей в overrides-ru.csv")
    print(f"отброшено: {dropped} (дубли по слово+часть речи, пустые переводы)")
    print(f"записано:  {DATA/'wordlist-en.csv'}\n           {DATA/'overrides-ru.csv'}")


if __name__ == "__main__":
    main()
