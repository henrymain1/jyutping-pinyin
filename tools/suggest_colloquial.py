"""Suggest everyday Cantonese words for Mandarin ones, to review into extension/data/colloquial.tsv.

Usage:
    python tools/suggest_colloquial.py <dir>

<dir> holds the files from tools/fetch_colloquial_sources.py. Writes <dir>/suggestions.tsv
with one row per Mandarin word that isn't in colloquial.tsv or tools/colloquial_skip.tsv yet:
HSK words first (lowest level first), then other words that both sources agree on.

Columns (tab separated):
    1-3  As in colloquial.tsv: Mandarin forms, pinyin, Cantonese words. Where CC-CEDICT
         gives several readings they are all listed ("hai2 / huan2"); keep the one the
         row is for.
    4    HSK level: "2.0:3" is HSK 2.0 level 3, "3.0:4" is HSK 3.0 level 4.
    5    Evidence for each Cantonese word: its sources (wikt = Wiktionary, kfcd =
         開放粵語詞典, kfcd1 = its first Mandarin meaning) and how often it occurs in
         written / spoken Cantonese. After "vs", the same counts for the Mandarin word:
         high counts there mean Cantonese uses the Mandarin word too.
    6    Meaning, from Wiktionary or CC-CEDICT.

To review, copy the rows you agree with into colloquial.tsv (columns 1-3, edited as
needed) and add the Mandarin words you leave out to tools/colloquial_skip.tsv.
"""

import gzip
import io
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "extension" / "data"
SKIP = ROOT / "tools" / "colloquial_skip.tsv"

# Wiktionary labels for words a learner shouldn't be given as the everyday word.
BAD_LABELS = {"dated", "rare", "obsolete", "archaic", "literary", "derogatory", "vulgar", "humorous"}
LECTS = ("Hong Kong", "Guangzhou")
JYUT = re.compile(r"^[a-z]+[1-6]$")
PINYIN = re.compile(r"^[a-zv]+[1-5]$")
SPLIT_GLOSS = re.compile(r"[，,；;、]")


def is_han(text):
    return bool(text) and all(0x3400 <= ord(c) <= 0x9FFF or 0x20000 <= ord(c) <= 0x3134F for c in text)


def load_cedict(path):
    """trad -> {"simp": [...], "pinyin": [...], "defs": first definition}. Proper-noun
    readings (capitalised) only count for words that have no other reading."""
    words, proper = {}, {}
    for line in gzip.open(path, "rt", encoding="utf-8"):
        m = re.match(r"(\S+) (\S+) \[([^\]]+)\] /(.*)/", line)
        if not m:
            continue
        trad, simp, raw, defs = m.groups()
        sylls = [s.lower() for s in raw.replace("u:", "v").split()]
        if not all(PINYIN.match(s) for s in sylls):
            continue
        entry = (proper if raw[:1].isupper() else words).setdefault(trad, {"simp": [], "pinyin": [], "defs": defs.split("/")[0]})
        if simp != trad and simp not in entry["simp"]:
            entry["simp"].append(simp)
        if "".join(sylls) not in entry["pinyin"]:
            entry["pinyin"].append("".join(sylls))
    return {**proper, **words}


def load_kfcd(path):
    """[(Cantonese word, jyutping, [Mandarin meanings])]. The file is one JSON array of
    tokens: a word, its jyutping syllables, then its Mandarin meaning if it has one."""
    raw = zipfile.ZipFile(path).read("cidian_zhyue-ft-kfcd-yp-2021714.txt").decode("utf-8")
    tokens = json.loads(max(raw.split("\n"), key=len))
    entries, i = [], 0
    while i < len(tokens):
        word, sylls = tokens[i], []
        i += 1
        while i < len(tokens) and JYUT.match(tokens[i]):
            sylls.append(tokens[i])
            i += 1
        meanings = []
        if i < len(tokens) and not JYUT.match(tokens[i]) and (i + 1 >= len(tokens) or not JYUT.match(tokens[i + 1])):
            meanings = [g.strip() for g in SPLIT_GLOSS.split(tokens[i]) if g.strip()]
            i += 1
        entries.append((word, " ".join(sylls), meanings))
    return entries


def load_dial_syn(path):
    """[(Mandarin head word, meaning, [(Cantonese word, labels)])]"""
    tables = []
    for line in open(path, encoding="utf-8"):
        page = json.loads(line)
        name = page["title"].split("dial-syn/", 1)[1]
        if "/" in name or name in ("all-lects", "template", "documentation"):
            continue
        text = page["text"]
        meaning = re.search(r'\["meaning"\]\s*=\s*"((?:[^"\\]|\\.)*)"', text)
        words = []
        for lect, body in re.findall(r'\["([^"]+)"\]\s*=\s*\{([^}]*)\}', text):
            if lect not in LECTS:
                continue
            for value in re.findall(r'"((?:[^"\\]|\\.)*)"', body):
                word, _, labels = value.partition(":")
                word = re.sub(r"_\d+$", "", word).strip()
                if word and (word, labels) not in words:
                    words.append((word, labels))
        tables.append((re.sub(r"-\d+$", "", name), meaning.group(1) if meaning else "", words))
    return tables


def load_spoken(path):
    """Word counts in the Hong Kong Cantonese Corpus (tokens look like 官司/n/gun1si1/)."""
    counts = Counter()
    outer = zipfile.ZipFile(path)
    inner_name = next(n for n in outer.namelist() if n.endswith("hkcancor-utf8.zip"))
    inner = zipfile.ZipFile(io.BytesIO(outer.read(inner_name)))
    for name in inner.namelist():
        if not name.endswith("/"):
            text = inner.read(name).decode("utf-8", "replace")
            counts.update(re.findall(r"^\s*([^/\s]+)/[^/]*/[^/]*/\s*$", text, flags=re.M))
    return counts


def load_canto():
    """CC-Canto word readings and each character's commonest reading, from canto.txt."""
    words, chars = defaultdict(list), {}
    for line in (DATA / "canto.txt").read_text(encoding="utf-8").splitlines():
        parts = line.split("\t")
        if parts[0] == "W":
            _, trad, simp, _, jyut = parts
            for form in {trad, simp} - {"-"}:
                for j in jyut.split("|"):
                    words[form].append(" ".join(re.findall(r"[a-z]+[1-6]", j)))
        elif parts[0] == "C":
            star = re.search(r"\*=([^;]+)", parts[2])
            if star:
                chars[parts[1]] = star.group(1).split(",")[0]
    return words, chars


def load_hsk(path):
    """trad or simplified form -> (HSK 2.0 level, HSK 3.0 level, frequency rank)"""
    levels = {}
    for word in json.load(open(path, encoding="utf-8")):
        old = [int(x[1:]) for x in word["l"] if x[0] == "o"]
        new = [int(x[1:]) for x in word["l"] if x[0] == "n"]
        info = (min(old) if old else None, min(new) if new else None, word.get("q") or 10**6)
        key = (info[0] or 9, info[1] or 9, info[2])
        for form in {word["s"], *(f["t"] for f in word["f"])}:
            if form not in levels or key < levels[form][0]:
                levels[form] = (key, info)
    return {form: info for form, (_, info) in levels.items()}


def load_reviewed():
    """Mandarin forms already in colloquial.tsv or the skip list."""
    done = set()
    for path in (DATA / "colloquial.tsv", SKIP):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.startswith("#"):
                done.update(line.split("\t")[0].split(","))
    return done


def main(folder):
    folder = Path(folder)
    sys.stdout.reconfigure(encoding="utf-8")
    cedict = load_cedict(folder / "cedict.txt.gz")
    kfcd = load_kfcd(folder / "kfcd-cidian_zhyue.zip")
    tables = load_dial_syn(folder / "dial-syn.jsonl")
    written = {k: v for k, v in json.load(open(folder / "wordshk-counts.json", encoding="utf-8")).items() if isinstance(v, int)}
    wordshk = json.load(open(folder / "wordshk-words.json", encoding="utf-8"))
    spoken = load_spoken(folder / "hkcancor.zip")
    canto_words, canto_chars = load_canto()
    hsk = load_hsk(folder / "hsk.json")
    reviewed = load_reviewed()

    kfcd_jyut = defaultdict(list)
    pair_jyut = {}  # (Mandarin, Cantonese) -> the reading of the entry that pairs them (嘅 ge3 = 的)
    sources = defaultdict(lambda: defaultdict(set))  # Mandarin -> Cantonese -> {"wikt", "kfcd", "kfcd1"}
    meanings = {}
    for word, jyut, glosses in kfcd:
        if jyut:
            kfcd_jyut[word].append(jyut)
        for i, gloss in enumerate(glosses):
            if is_han(gloss) and is_han(word) and gloss != word:
                sources[gloss][word].add("kfcd1" if i == 0 else "kfcd")
                pair_jyut.setdefault((gloss, word), jyut)
    for head, meaning, words in tables:
        meanings.setdefault(head, meaning)
        for word, labels in words:
            if is_han(word) and word != head and not set(labels.split(",")) & BAD_LABELS:
                sources[head][word].add("wikt")

    def count(word):
        return written.get(word, 0), spoken.get(word, 0)

    def weight(word):
        w, s = count(word)
        return w + 20 * s  # the spoken corpus is about a twentieth the size

    def jyutping(mandarin, word):
        paired = [pair_jyut[(mandarin, word)]] if (mandarin, word) in pair_jyut else []
        for options in (paired, kfcd_jyut.get(word), wordshk.get(word), canto_words.get(word)):
            for option in options or []:
                sylls = option.split()
                if len(sylls) == len(word) and all(JYUT.match(s) for s in sylls):
                    return option
        if all(c in canto_chars for c in word):
            return " ".join(canto_chars[c] for c in word)
        return "?"

    rows = []
    for mandarin, found in sources.items():
        if mandarin in reviewed or len(mandarin) > 6:
            continue
        level = hsk.get(mandarin) or next((hsk[s] for s in cedict.get(mandarin, {}).get("simp", []) if s in hsk), None)
        if not level and mandarin not in cedict:
            continue
        kept = []
        for canto, src in found.items():
            if not (weight(canto) or canto in wordshk):
                continue  # not seen in Cantonese
            both = "wikt" in src and bool(src & {"kfcd", "kfcd1"})
            if level:
                ok = both or "wikt" in src or "kfcd1" in src or weight(canto) >= 2 * weight(mandarin)
            else:
                ok = both and weight(canto) >= 5
            if ok:
                kept.append((not both, "kfcd1" not in src, -weight(canto), canto, src))
        if not kept:
            continue
        kept.sort()
        entry = cedict.get(mandarin, {"simp": [], "pinyin": [], "defs": ""})
        best = kept[:3]
        evidence = " · ".join(
            f"{c} {'+'.join(sorted(src))} {'/'.join(map(str, count(c)))}" for *_, c, src in kept[:5]
        ) + f" vs {mandarin} {'/'.join(map(str, count(mandarin)))}"
        old, new, rank = level or (None, None, 10**6)
        rows.append((
            (0 if level else 1, old or 9, new or 9, rank, kept[0][2]),
            [
                ",".join([mandarin, *entry["simp"]]),
                " / ".join(entry["pinyin"]),
                " | ".join(f"{c} {jyutping(mandarin, c)}" for *_, c, _ in best),
                f"2.0:{old}" if old else f"3.0:{new}" if new else "",
                evidence,
                (meanings.get(mandarin) or entry["defs"])[:60],
            ],
        ))
    rows.sort(key=lambda r: r[0])
    out = folder / "suggestions.tsv"
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("# Generated by tools/suggest_colloquial.py. Columns are explained in its docstring.\n")
        for _, cells in rows:
            f.write("\t".join(cells) + "\n")
    by_level = Counter(cells[3].split(":")[0] + ":" + cells[3].split(":")[1] if cells[3] else "other" for _, cells in rows)
    print(f"{len(rows)} suggestions in {out}: " + ", ".join(f"{k} {v}" for k, v in sorted(by_level.items())))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
