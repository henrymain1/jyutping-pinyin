"""Check extension/data/colloquial.tsv against the CC-Canto data in extension/data/canto.txt.

Usage:
    python tools/check_colloquial.py

For every row it checks that:
  - each Cantonese word has one jyutping syllable per character, and every syllable is a
    reading CC-Canto gives for that character (or for the whole word);
  - each Mandarin form has one pinyin syllable per character, and every syllable (ignoring
    tones) is a reading CC-Canto gives for that character;
  - no Mandarin form and pinyin pair appears twice.
Exits with status 1 if anything fails.
"""

import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "extension" / "data"
SYL = re.compile(r"[a-zv]+[1-6]")


def load_canto():
    char_jyut = defaultdict(set)  # char -> every jyutping syllable
    char_pinyin = defaultdict(set)  # char -> toneless pinyin syllables
    words = defaultdict(set)  # hanzi -> joined jyutping variants
    for line in (DATA / "canto.txt").read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if parts[0] == "C":
            _, ch, body = parts
            for item in body.split(";"):
                key, readings = item.split("=")
                char_jyut[ch].update(readings.split(","))
                if key != "*":
                    char_pinyin[ch].add(re.sub(r"\d", "", key))
        elif parts[0] == "W":
            _, trad, simp, _, jyut = parts
            for form in {trad, simp} - {"-"}:
                words[form].update(jyut.split("|"))
    return char_jyut, char_pinyin, words


def main():
    sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles default to a code page without Chinese
    char_jyut, char_pinyin, words = load_canto()
    problems, seen, rows = [], set(), 0
    for number, line in enumerate((DATA / "colloquial.tsv").read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip() or line.startswith("#"):
            continue
        rows += 1
        forms, pinyin, cantonese = (line.split("\t") + ["", ""])[:3]
        where = f"line {number}"
        sylls = SYL.findall(pinyin.rstrip("!").lower())
        for form in forms.split(","):
            key = (form, re.sub(r"\d", "", pinyin))
            if key in seen:
                problems.append(f"{where}: {form} {pinyin or '(any)'} is listed twice")
            seen.add(key)
            if not sylls:
                continue
            if len(sylls) != len(form):
                problems.append(f"{where}: {form} has {len(form)} characters but pinyin {pinyin} has {len(sylls)} syllables")
                continue
            for ch, syl in zip(form, sylls):
                if re.sub(r"\d", "", syl) not in char_pinyin.get(ch, set()):
                    problems.append(f"{where}: {form}: {ch} isn't read {syl} in CC-Canto")
        alternatives = [alt.strip() for alt in cantonese.split("|") if alt.strip()]
        if not alternatives:
            problems.append(f"{where}: no Cantonese word")
        for alt in alternatives:
            match = re.match(r"^(\S+)\s+([a-z0-9 ]+?)(?:\s*\((.+)\))?$", alt)
            if not match:
                problems.append(f"{where}: can't read {alt!r}")
                continue
            hanzi, jyut = match.group(1), match.group(2).split()
            if len(jyut) != len(hanzi):
                problems.append(f"{where}: {hanzi} has {len(hanzi)} characters but {len(jyut)} jyutping syllables")
                continue
            if "".join(jyut) in words.get(hanzi, set()):
                continue
            for ch, syl in zip(hanzi, jyut):
                if ch not in char_jyut:
                    problems.append(f"{where}: {hanzi}: {ch} isn't in CC-Canto")
                elif syl not in char_jyut[ch]:
                    known = ", ".join(sorted(char_jyut[ch]))
                    problems.append(f"{where}: {hanzi}: {ch} isn't read {syl} in CC-Canto (it has {known})")
    for problem in problems:
        print(problem)
    print(f"{rows} rows checked, {len(problems)} problems")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
