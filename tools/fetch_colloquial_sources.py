"""Download the sources that tools/suggest_colloquial.py reads.

Usage:
    python tools/fetch_colloquial_sources.py <dir>

Files already in <dir> are kept; delete one to download it again.

    kfcd-cidian_zhyue.zip   開放粵語詞典, Cantonese words with Mandarin meanings (CC BY 3.0)
                            https://kaifangcidian.com/xiazai/
    dial-syn.jsonl          Wiktionary's dialectal synonym tables, Module:zh/data/dial-syn/*
                            (CC BY-SA 4.0), fetched page by page through the API
    cedict.txt.gz           CC-CEDICT (CC BY-SA 4.0), for Mandarin readings and simplified forms
    wordshk-counts.json     words.hk corpus word counts (public domain)
    wordshk-words.json      words.hk word list with jyutping (public domain)
    hkcancor.zip            Hong Kong Cantonese Corpus, spoken Cantonese (CC BY 4.0)
    hsk.json                HSK 2.0 and 3.0 word lists, only used to order the suggestions
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = "jyutping-pinyin/1.0 (https://github.com/henrymain1/jyutping-pinyin)"
FILES = {
    "kfcd-cidian_zhyue.zip": "https://kaifangcidian.com/xiazai/cidian_zhyue-kfcd.zip",
    "cedict.txt.gz": "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz",
    "wordshk-counts.json": "https://words.hk/faiman/analysis/existingwordcount.json",
    "wordshk-words.json": "https://words.hk/faiman/analysis/wordslist.json",
    "hkcancor.zip": "https://github.com/fcbond/hkcancor/archive/refs/heads/master.zip",
    "hsk.json": "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.min.json",
}
WIKTIONARY_API = "https://en.wiktionary.org/w/api.php"


def get(url):
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as res:
                return res.read()
        except OSError as err:
            print(f"  retrying ({err})")
            time.sleep(5 * (attempt + 1))
    sys.exit(f"could not download {url}")


def fetch_dial_syn(path):
    params = {
        "action": "query", "format": "json", "formatversion": "2",
        "generator": "allpages", "gapnamespace": "828", "gapprefix": "zh/data/dial-syn/", "gaplimit": "50",
        "prop": "revisions", "rvprop": "content", "rvslots": "main",
    }
    pages = 0
    with open(path.with_suffix(".part"), "w", encoding="utf-8") as out:
        while True:
            data = json.loads(get(WIKTIONARY_API + "?" + urllib.parse.urlencode(params)))
            for page in data.get("query", {}).get("pages", []):
                if page.get("revisions"):
                    text = page["revisions"][0]["slots"]["main"]["content"]
                    out.write(json.dumps({"title": page["title"], "text": text}, ensure_ascii=False) + "\n")
                    pages += 1
            print(f"  {pages} pages", end="\r")
            if "continue" not in data:
                break
            params.update(data["continue"])
            time.sleep(0.5)
    path.with_suffix(".part").replace(path)
    print(f"  {pages} pages")


def main(folder):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    for name, url in FILES.items():
        path = folder / name
        if path.exists():
            continue
        print(f"{name} <- {url}")
        path.write_bytes(get(url))
    path = folder / "dial-syn.jsonl"
    if not path.exists():
        print(f"dial-syn.jsonl <- {WIKTIONARY_API}")
        fetch_dial_syn(path)
    print("done")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
