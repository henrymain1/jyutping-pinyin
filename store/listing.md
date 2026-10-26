# Store listing

Copy each block into the matching field. Firefox Add-ons (addons.mozilla.org) and the
Chrome Web Store / Edge Add-ons ask for mostly the same things; where they differ it says so.

Packages (build with `python tools/package.py`):
- Firefox: `dist/jyutping-pinyin-firefox-<version>.zip`
- Chrome and Edge: `dist/jyutping-pinyin-chrome-<version>.zip`

---

## Name

Jyutping & Pinyin

## Summary

Firefox "Summary" (250 characters max):

> Learn Cantonese from Mandarin resources: shows the jyutping under the pinyin on any web page, matched to the pinyin shown (行 xíng → hang4, háng → hong4).

Chrome "Short description" (132 characters max):

> Learn Cantonese from Mandarin resources: see jyutping under the pinyin on any web page, matched to the pinyin shown.

## Description

Firefox "Description" (Markdown allowed; the first 250 characters carry the main points). Chrome / Edge use the same text.

> Adds the Cantonese reading (jyutping) wherever a web page shows Mandarin pinyin, so you can learn Cantonese from Mandarin dictionaries and courses. The pinyin on the page picks the right reading: 行 xíng is hang4, but 行 háng is hong4.
>
> Readings come from the CC-Canto dictionary. It works on dictionaries such as MDBG and Wiktionary, on Wikipedia, and on learning sites like Dong Chinese. On pages that show jyutping, it adds the pinyin instead.
>
> Two switches choose what you see: pinyin, jyutping, both, or neither. Turn pinyin off and jyutping takes its place, for Cantonese-only reading.
>
> You can also:
>
> - colour each syllable by its tone, or show tones as numbers (dung1) or superscripts (dung¹)
> - place the reading below or beside the pinyin, at any size and colour
> - see a word's other Cantonese readings, such as both forms of 生 (sang1 / saang1)
> - click a reading to hear the word, using your browser's voices
> - Shift+click a reading to fix it; your correction applies wherever that word appears
> - press Alt+J or Alt+P to turn jyutping or pinyin on and off
> - turn it off on sites where you don't want it
>
> It stays idle on pages without Chinese text. The dictionary is built in, so nothing you read is sent anywhere.
>
> CC-Canto and the CC-CEDICT Cantonese readings © Pleco Inc. (cantonese.org), CC BY-SA 3.0. Not affiliated with any site named here.

## Category

- Firefox: Language Support
- Chrome / Edge: Education

## Licence (Firefox asks)

MIT License. The dictionary data inside keeps its own licence (CC BY-SA 3.0), noted in `LICENSE`.

## Support

Optional. Leave the email and website empty to keep your address private, or add a
project page later.

## Screenshots

In `store/screenshots/`, 1280 × 800. Upload them in the order 1, 5, 2, 3, 4 so they read as a story: the core idea, other sites, the media reader, replacing pinyin, then the panel. Captions:

1. `1-dictionary.png`: Jyutping under the pinyin in a dictionary entry: 行 xíng → hang4, 行 háng → hong4.
2. `2-media-reader.png`: Words tapped in a video transcript, each with its Cantonese reading.
3. `3-replace.png`: Pinyin switched off: the jyutping takes its place.
4. `4-panel.png`: The panel: pinyin and jyutping switches, a switch for the current site, tone style, position, size and colour.
5. `5-other-sites.png`: Works on other sites too, here the MDBG dictionary: 銀行 yínháng → ngan4 hong4.

Chrome also wants a small promo tile: `store/screenshots/promo-440x280.png`.

---

## Privacy

Firefox: the manifest already declares that no data is collected, so there's nothing to fill in.

Chrome "Privacy practices" tab:

**Single purpose**

> Shows Cantonese (jyutping) and Mandarin (pinyin) readings next to each other on web pages that show one of them.

**Permission justifications**

| Permission | Justification |
| --- | --- |
| Host permission (all http/https sites) | Readings are added on whatever page shows pinyin or jyutping, so the extension has to be able to read pages. It stays idle on pages without Chinese text, and nothing it reads leaves the browser. Users can turn it off for any site from the panel. |
| storage | Saves the user's display settings, the sites they turned it off for, and their corrections to readings. |
| scripting | Starts the extension in tabs that were already open when it is installed, or when the user grants access to a site, so they don't have to reload. |
| activeTab | Reads the current tab's address when the panel opens, to show that site's on/off switch. |

**Remote code:** No. All code is in the package.

**Data usage:** tick none of the data types. Certify that data isn't sold, isn't used for
unrelated purposes, and isn't used for creditworthiness or lending.

**Privacy policy** (if a store asks for one, paste this or host it as a page):

> Jyutping & Pinyin does not collect, store or send personal data. It reads the pages you visit only to find pinyin and jyutping, inside your browser. Your display settings and reading corrections are saved in your browser's own extension storage; settings sync through your browser account only if you have browser sync turned on. The dictionary is part of the extension and it makes no network requests of its own. "Click to hear" uses your browser's speech voices; some of those voices (for example Chrome's Google voices) run online, so the word being spoken goes to that voice provider.

---

## Notes for reviewers (Firefox "Notes to Reviewer")

> There is no build step: all JavaScript is hand-written and not minified, so no source code upload is needed. data/canto.txt is a plain-text dictionary generated from the CC-Canto release (CC BY-SA 3.0) by a Python script; I can provide the script on request.
>
> The content script runs on all http/https pages but stays idle unless the page contains Chinese characters and text that parses as pinyin or jyutping; only then does it ask the background script for the dictionary. It sends nothing off the device.
>
> To try it: open https://www.mdbg.net/chinese/dictionary?page=worddict&wdqb=銀行 or https://en.wikipedia.org/wiki/Hong_Kong (the infobox). The Cantonese reading appears under the pinyin, and on Wikipedia the pinyin also appears under the jyutping. The toolbar panel has the Pinyin and Jyutping switches and an on/off switch for the current site.
