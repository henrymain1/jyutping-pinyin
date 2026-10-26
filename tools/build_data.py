"""Build extension/data/canto.txt from the CC-Canto release files.

Usage:
    python tools/build_data.py <cccanto-webdist.txt> <cccedict-canto-readings.txt>

Both files come from https://cantonese.org/download.html (CC BY-SA 3.0, Pleco Inc.).

Output format (UTF-8, one record per line, tab separated):
    S <syllable> <syllable> ...
        Every toneless Mandarin syllable seen in the sources ("v" for ü).
    J <syllable> <syllable> ...
        Every toneless Cantonese (jyutping) syllable seen in the sources.
    W <trad> <simp|-> <pinyin> <jyutping>[|<jyutping>...]
        A dictionary word of two or more characters. Pinyin and jyutping are
        written without spaces ("dong1jing1", "dung1ging1"); ü is written "v".
    C <char> <pinyin>=<jyut>,<jyut>;<pinyin>=...;*=<jyut>,...
        Per-character readings keyed by the Mandarin syllable, best first.
        Mandarin syllables are listed most-used first. "*" lists every known
        Cantonese reading of the character.

Per-character readings are inferred mainly from multi-character words, because
the single-character entries in the source files usually repeat one Cantonese
reading for every Mandarin reading (e.g. 行 háng is listed as hang4, not hong4).
tools/char_overrides.tsv fixes the cases the statistics still get wrong.
"""

import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "extension" / "data" / "canto.txt"
OVERRIDES = ROOT / "tools" / "char_overrides.tsv"

LINE_RE = re.compile(r"^(\S+) (\S+) \[([^\]]*)\] \{([^}]*)\}")
SYL_RE = re.compile(r"[a-zv:]+[1-5]")
JYUT_SYL_RE = re.compile(r"^[a-z]+[1-6]$")
JYUT_SYL_FIND = re.compile(r"[a-z]+[1-6]")


def is_han(ch):
    cp = ord(ch)
    return (
        0x3400 <= cp <= 0x4DBF
        or 0x4E00 <= cp <= 0x9FFF
        or 0xF900 <= cp <= 0xFAFF
        or 0x20000 <= cp <= 0x3134F
        or ch == "〇"
    )


def parse_pinyin(raw):
    """'Dong1 jing1' -> ['dong1', 'jing1']; returns None for anything odd."""
    s = raw.lower().replace("u:", "v").replace("ü", "v")
    sylls = SYL_RE.findall(s)
    # Reject entries with leftovers such as Latin letters ("A A zhi4") or commas.
    if SYL_RE.sub("", s).strip(" ·-") != "":
        return None
    return sylls


def parse_jyutping(raw):
    sylls = raw.lower().split()
    if not sylls or not all(JYUT_SYL_RE.match(s) for s in sylls):
        return None
    return sylls


def read_entries(path):
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            m = LINE_RE.match(line)
            if not m:
                continue
            trad, simp, py_raw, jy_raw = m.groups()
            if not all(is_han(c) for c in trad) or not all(is_han(c) for c in simp):
                continue
            py = parse_pinyin(py_raw)
            jy = parse_jyutping(jy_raw)
            if not py or not jy:
                continue
            if not (len(trad) == len(simp) == len(py) == len(jy)):
                continue
            yield trad, simp, py, jy


def load_overrides():
    """char -> {pinyin: [jyutping, ...]} from the hand-maintained table."""
    table = defaultdict(dict)
    if not OVERRIDES.exists():
        return table
    for line in OVERRIDES.read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        chars, py, jys = line.split("\t")[:3]
        for ch in chars.split(","):
            table[ch.strip()][py.strip()] = [j.strip() for j in jys.split(",")]
    return table


def split_sylls(s):
    return SYL_RE.findall(s) if s else []


def toneless(s):
    return re.sub(r"[1-6]", "", s)


def parse_char_lines(char_lines):
    chars = {}
    for line in char_lines:
        _, ch, body = line.split("\t")
        chars[ch] = {k: v.split(",") for k, v in (p.split("=") for p in body.split(";"))}
    return chars


def char_reading(chars, ch, py):
    """Mirror of charReadings() in dict.js: best Cantonese reading for ch read as py."""
    table = chars.get(ch)
    if not table:
        return None
    if py in table:
        return table[py][0]
    base = toneless(py)
    for key in table:
        if key != "*" and toneless(key) == base:
            return table[key][0]
    return table.get("*", [None])[0]


def char_pinyin(chars, ch, jy):
    """Mirror of charPinyin() in dict.js: the Mandarin reading whose Cantonese list
    ranks jy highest; ties go to the more common Mandarin reading (listed first)."""
    table = chars.get(ch)
    if not table:
        return None
    keys = [k for k in table if k != "*"]
    for same in (lambda j: j == jy, lambda j: toneless(j) == toneless(jy)):
        best = None
        for key in keys:
            rank = next((r for r, j in enumerate(table[key]) if same(j)), None)
            if rank is not None and (best is None or rank < best[0]):
                best = (rank, key)
        if best:
            return best[1]
    return keys[0] if keys else None


def convert_reverse(word_index, chars, max_len, hanzi, jsylls):
    """Mirror of toPinyin() in dict.js: Mandarin pinyin for hanzi read as jsylls."""
    out, i, n = [], 0, len(hanzi)
    while i < n:
        for length in range(min(n - i, max_len), 1, -1):
            entries = word_index.get(hanzi[i:i + length])
            if not entries:
                continue
            want = "".join(jsylls[i:i + length])
            pick = next((p for p, js in entries if want in js), None)
            if pick is None:
                pick = next((p for p, js in entries if any(toneless(j) == toneless(want) for j in js)), None)
            if pick is not None:
                out.append(pick)
                i += length
                break
        else:
            out.append(char_pinyin(chars, hanzi[i], jsylls[i]) or "?")
            i += 1
    return "".join(out)


def convert(word_index, chars, max_len, hanzi, sylls):
    """Mirror of convert() in dict.js (greedy longest match, pinyin-checked)."""
    out, i, n = [], 0, len(hanzi)
    while i < n:
        for length in range(min(n - i, max_len), 1, -1):
            entries = word_index.get(hanzi[i:i + length])
            if not entries:
                continue
            want = "".join(sylls[i:i + length])
            pick = next((j for p, j in entries if p == want), None)
            if pick is None:
                pick = next((j for p, j in entries if toneless(p) == toneless(want)), None)
            if pick is not None:
                out.append(pick[0])
                i += length
                break
        else:
            out.append(char_reading(chars, hanzi[i], sylls[i]) or "?")
            i += 1
    return "".join(out)


def build_index(words):
    # Sorted to match the line order content.js sees in canto.txt.
    index = defaultdict(list)
    for (trad, simp, py), jys in sorted(words.items()):
        for form in {trad, simp}:
            index[form].append((py, jys))
    return index


def prune_words(words, chars):
    """Drop words that the character data already reproduces in both directions
    (pinyin -> jyutping and jyutping -> pinyin).

    Removing a word can change how a longer phrase segments, so every original
    word is re-converted against the pruned set and restored on any mismatch,
    repeating until nothing changes.
    """
    max_len = max(len(t) for t, _, _ in words)

    def reproduced(form, py, jy, convert_py, convert_jy):
        return convert_py(form, split_sylls(py)) == jy and convert_jy(form, JYUT_SYL_FIND.findall(jy)) == py

    per_char_py = lambda form, sylls: "".join(char_reading(chars, c, s) or "?" for c, s in zip(form, sylls))
    per_char_jy = lambda form, jsylls: "".join(char_pinyin(chars, c, j) or "?" for c, j in zip(form, jsylls))
    keep = {}
    for key, jys in words.items():
        trad, simp, py = key
        if len(jys) > 1 or not all(reproduced(f, py, jys[0], per_char_py, per_char_jy) for f in {trad, simp}):
            keep[key] = jys
    while True:
        index = build_index(keep)
        full_py = lambda form, sylls: convert(index, chars, max_len, form, sylls)
        full_jy = lambda form, jsylls: convert_reverse(index, chars, max_len, form, jsylls)
        restored = 0
        for key, jys in words.items():
            if key in keep:
                continue
            trad, simp, py = key
            if not all(reproduced(f, py, jys[0], full_py, full_jy) for f in {trad, simp}):
                keep[key] = jys
                restored += 1
        if not restored:
            break
    print(f"words kept after pruning: {len(keep)} of {len(words)}")
    return keep


def main(cccanto_path, readings_path):
    # (trad, simp, pinyin) -> ordered list of jyutping strings
    words = {}
    # char -> pinyin syllable -> Counter(jyutping) gathered from multi-char words
    stats = defaultdict(lambda: defaultdict(Counter))
    # char -> pinyin syllable -> ordered jyutping from single-character entries
    singles = defaultdict(lambda: defaultdict(list))
    # char -> Counter of every jyutping seen (for the "*" fallback order)
    any_reading = defaultdict(Counter)
    # Every toneless Mandarin / Cantonese syllable in the sources; the extension uses
    # them to recognise pinyin and jyutping on a page.
    syllables = set()
    jyut_syllables = set()

    # The readings file mirrors CC-CEDICT (which dong-chinese.com displays), so it
    # goes first; CC-Canto adds Cantonese-specific words and colloquial variants.
    for path in (readings_path, cccanto_path):
        for trad, simp, py, jy in read_entries(path):
            syllables.update(toneless(s) for s in py)
            jyut_syllables.update(toneless(s) for s in jy)
            if len(trad) == 1:
                for ch in {trad, simp}:
                    lst = singles[ch][py[0]]
                    if jy[0] not in lst:
                        lst.append(jy[0])
                    any_reading[ch][jy[0]] += 1
                continue
            key = (trad, simp, "".join(py))
            lst = words.setdefault(key, [])
            j = "".join(jy)
            if j not in lst:
                lst.append(j)
            for k in range(len(py)):
                for ch in {trad[k], simp[k]}:
                    stats[ch][py[k]][jy[k]] += 1
                    any_reading[ch][jy[k]] += 1

    overrides = load_overrides()

    char_lines = []
    for ch in sorted(set(singles) | set(stats) | set(overrides)):
        pinyins = set(singles[ch]) | set(stats[ch]) | set(overrides.get(ch, {}))

        def usage(py):
            return sum(stats[ch].get(py, Counter()).values()) + len(singles[ch].get(py, []))

        parts = []
        # Most-used Mandarin reading first: lookups that fall back to "first match"
        # (toneless pinyin, jyutping -> pinyin ties) then pick the common reading.
        for py in sorted(pinyins, key=lambda p: (-usage(p), p)):
            ranked = []
            if py in overrides.get(ch, {}):
                ranked = list(overrides[ch][py])
            counts = stats[ch].get(py, Counter())
            total = sum(counts.values())
            single = singles[ch].get(py, [])
            if total >= 3:
                # Trust usage in real words; keep minor readings only if they
                # account for a meaningful share.
                top = counts.most_common()
                best = top[0][1]
                from_stats = [j for j, n in top if n >= max(2, best * 0.25)] or [top[0][0]]
                order = from_stats + single
            else:
                order = single + [j for j, _ in counts.most_common()]
            for j in order:
                if j not in ranked:
                    ranked.append(j)
            if ranked:
                parts.append(f"{py}={','.join(ranked[:4])}")
        all_j = [j for j, _ in any_reading[ch].most_common()]
        for py_map in overrides.get(ch, {}).values():
            for j in py_map:
                if j not in all_j:
                    all_j.append(j)
        if all_j:
            parts.append("*=" + ",".join(all_j[:6]))
        if parts:
            char_lines.append(f"C\t{ch}\t{';'.join(parts)}")

    words = prune_words(words, parse_char_lines(char_lines))

    word_lines = []
    for (trad, simp, py), jys in sorted(words.items()):
        word_lines.append(f"W\t{trad}\t{simp if simp != trad else '-'}\t{py}\t{'|'.join(jys)}")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("# Generated by tools/build_data.py from CC-Canto (cantonese.org), CC BY-SA 3.0, Pleco Inc.\n")
        f.write("S\t" + " ".join(sorted(syllables)) + "\n")
        f.write("J\t" + " ".join(sorted(jyut_syllables)) + "\n")
        f.write("\n".join(char_lines))
        f.write("\n")
        f.write("\n".join(word_lines))
        f.write("\n")

    print(f"chars: {len(char_lines)}  words: {len(word_lines)}  size: {OUT.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
