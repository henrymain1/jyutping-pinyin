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
