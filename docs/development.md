# Development

## Run from source

- Chrome / Edge: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
- Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `extension/manifest.json`.

## Package

```
python tools/package.py
```

Writes `dist/jyutping-pinyin-firefox-<version>.zip` and `dist/jyutping-pinyin-chrome-<version>.zip`.
Raise `"version"` in `extension/manifest.json` before uploading a new version. Store listing
text and screenshots are in `store/`.

## Everyday Cantonese words

`extension/data/colloquial.tsv` is the reviewed list behind the Cantonese word tags
(看 → 睇). The file's header explains the columns. To find more words, download the
sources once and generate suggestions:

```
python tools/fetch_colloquial_sources.py path/to/sources
python tools/suggest_colloquial.py path/to/sources
```

`path/to/sources/suggestions.tsv` lists the Mandarin words not reviewed yet, HSK words
first, with the evidence for each suggestion (the script's docstring explains the
columns). Copy the rows you agree with into colloquial.tsv, fixing them as needed, and
add the words you leave out to `tools/colloquial_skip.tsv`. Then check every reading
against CC-Canto:

```
python tools/check_colloquial.py
```

The word counts that rank the suggestions come from [words.hk](https://words.hk)
(public domain) and the Hong Kong Cantonese Corpus (CC BY 4.0); they aren't shipped.

## Rebuild the dictionary

`extension/data/canto.txt` is generated from the CC-Canto release
(`cccanto-170202.zip` and `cccedict-canto-readings-150923.zip` from
<https://cantonese.org/download.html>):

```
python tools/build_data.py path/to/cccanto-webdist.txt path/to/cccedict-canto-readings-150923.txt
```

Hand fixes for single-character readings go in `tools/char_overrides.tsv`. The build keeps
only the words the extension can't reconstruct from their characters, checked with the same
lookups the extension runs, so `convert()` / `convert_reverse()` in `tools/build_data.py`
must stay in step with `convert()` / `toPinyin()` in `extension/src/dict.js`.
