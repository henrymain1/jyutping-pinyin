// Lookup over data/canto.txt (built from CC-Canto by tools/build_data.py), in both
// directions: pinyin -> jyutping (convert) and jyutping -> pinyin (toPinyin).
// Both must stay in step with their mirrors in build_data.py, which relies on them
// to decide which dictionary words can be left out of the data file.
(() => {
  const NS = (globalThis.JyutpingExt ??= {});
  if (NS.Dictionary) return;

  const JYUT_SYLLABLE = /[a-z]+[1-6]/g;
  const toneless = (syl) => syl.replace(/\d$/, '');

  class Dictionary {
    constructor(text) {
      this.syllables = [];
      this.jyutSyllables = [];
      this.charJyut = new Map(); // char -> Map(jyutping -> [pinyin...] best first)
      this.chars = new Map(); // char -> raw "py=j,j;py=j;*=j" (parsed on first use)
      this.charTables = new Map(); // char -> Map(pinyin | '*' -> [jyutping...])
      this.charBases = new Map(); // char -> Set(toneless pinyin)
      this.words = new Map(); // hanzi -> [[pinyin, [[jyutping syllables], ...]], ...]
      this.maxWord = 1;

      for (const line of text.split(/\r?\n/)) {
        const kind = line[0];
        if (kind === 'C') {
          const [, ch, body] = line.split('\t');
          this.chars.set(ch, body);
        } else if (kind === 'W') {
          const [, trad, simp, pinyin, jyut] = line.split('\t');
          const entry = [pinyin, jyut.split('|').map((j) => j.match(JYUT_SYLLABLE))];
          this.addWord(trad, entry);
          if (simp !== '-') this.addWord(simp, entry);
        } else if (kind === 'S') {
          this.syllables = line.slice(2).split(' ');
        } else if (kind === 'J') {
          this.jyutSyllables = line.slice(2).split(' ');
        }
      }
    }

    addWord(hanzi, entry) {
      const list = this.words.get(hanzi);
      if (list) list.push(entry);
      else this.words.set(hanzi, [entry]);
      this.maxWord = Math.max(this.maxWord, [...hanzi].length);
    }

    charTable(ch) {
      let table = this.charTables.get(ch);
      if (table) return table;
      const body = this.chars.get(ch);
      if (!body) return null;
      table = new Map();
      for (const part of body.split(';')) {
        const eq = part.indexOf('=');
        table.set(part.slice(0, eq), part.slice(eq + 1).split(','));
      }
      this.charTables.set(ch, table);
      this.charBases.set(ch, new Set([...table.keys()].filter((k) => k !== '*').map(toneless)));
      return table;
    }

    // 2 = this pinyin is a known reading, 1 = right syllable but different tone
    // (tone sandhi, neutral tone), 0 = character not in the data, -1 = no match.
    charMatch(ch, syl) {
      const table = this.charTable(ch);
      if (!table) return 0;
      if (table.has(syl)) return 2;
      return this.charBases.get(ch).has(toneless(syl)) ? 1 : -1;
    }

    // Cantonese readings for one character read as `syl`, best first.
    charReadings(ch, syl) {
      const table = this.charTable(ch);
      if (!table) return null;
      if (table.has(syl)) return { readings: table.get(syl), guess: false };
      const base = toneless(syl);
      for (const [key, readings] of table) {
        if (key !== '*' && toneless(key) === base) return { readings, guess: false };
      }
      return table.has('*') ? { readings: table.get('*'), guess: true } : null;
    }

    // Reading for a hanzi string with one pinyin syllable per character.
    // Greedy longest-match over dictionary words whose pinyin agrees with the page,
    // falling back to per-character readings chosen by each syllable.
    convert(hanzi, sylls, corrections) {
      const fixed = corrections?.[`${hanzi}|${sylls.join(' ')}`];
      if (fixed) return { reading: fixed.match(JYUT_SYLLABLE), alts: [], guess: false, corrected: true };

      const chars = [...hanzi];
      const n = chars.length;
      const reading = [];
      let alts = [];
      let guess = false;
      for (let i = 0; i < n; ) {
        let matched = 0;
        for (let len = Math.min(n - i, this.maxWord); len >= 2 && !matched; len--) {
          const entries = this.words.get(chars.slice(i, i + len).join(''));
          if (!entries) continue;
          const variants = pickEntry(entries, sylls.slice(i, i + len));
          if (!variants) continue;
          reading.push(...variants[0]);
          if (len === n) alts = variants.slice(1);
          matched = len;
        }
        if (matched) {
          i += matched;
          continue;
        }
        const found = this.charReadings(chars[i], sylls[i]);
        if (found) {
          reading.push(found.readings[0]);
          if (n === 1) alts = found.readings.slice(1).map((r) => [r]);
          guess ||= found.guess;
        } else {
          reading.push('?');
          guess = true;
        }
        i += 1;
      }
      return { reading, alts, guess, corrected: false };
    }

    // ------------------------------------------------- jyutping -> pinyin

    // Mandarin readings of `ch` grouped by Cantonese syllable. Within a group the
    // Mandarin reading that ranks that syllable highest comes first; ties keep the
    // data file's order, which lists the most-used Mandarin reading first.
    jyutTable(ch) {
      let byJyut = this.charJyut.get(ch);
      if (byJyut) return byJyut;
      const table = this.charTable(ch);
      if (!table) return null;
      const ranked = new Map(); // jyutping -> [[rank, order, pinyin]]
      let order = 0;
      for (const [pinyin, readings] of table) {
        if (pinyin === '*') continue;
        readings.forEach((jyut, rank) => {
          if (!ranked.has(jyut)) ranked.set(jyut, []);
          ranked.get(jyut).push([rank, order, pinyin]);
        });
        order += 1;
      }
      byJyut = new Map();
      for (const [jyut, list] of ranked) {
        list.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        byJyut.set(jyut, list.map((item) => item[2]));
      }
      byJyut.firstPinyin = [...table.keys()].find((k) => k !== '*') || null;
      this.charJyut.set(ch, byJyut);
      return byJyut;
    }

    // Same scale as charMatch(), for a Cantonese syllable.
    charMatchJyut(ch, jyut) {
      const byJyut = this.jyutTable(ch);
      if (!byJyut) return 0;
      if (byJyut.has(jyut)) return 2;
      const base = toneless(jyut);
      for (const key of byJyut.keys()) if (toneless(key) === base) return 1;
      return -1;
    }

    // Best Mandarin syllable for `ch` read as `jyut` in Cantonese.
    charPinyin(ch, jyut) {
      const byJyut = this.jyutTable(ch);
      if (!byJyut) return null;
      if (byJyut.has(jyut)) return { pinyin: byJyut.get(jyut)[0], guess: false };
      // Toneless: pick the reading where a same-syllable jyutping ranks highest.
      const base = toneless(jyut);
      let best = null;
      for (const [pinyin, readings] of this.charTable(ch)) {
        if (pinyin === '*') continue;
        const rank = readings.findIndex((r) => toneless(r) === base);
        if (rank >= 0 && (!best || rank < best.rank)) best = { rank, pinyin };
      }
      if (best) return { pinyin: best.pinyin, guess: false };
      return byJyut.firstPinyin ? { pinyin: byJyut.firstPinyin, guess: true } : null;
    }

    // Pinyin syllables for a hanzi string with one jyutping syllable per character.
    toPinyin(hanzi, jsylls) {
      const chars = [...hanzi];
      const n = chars.length;
      const reading = [];
      let guess = false;
      for (let i = 0; i < n; ) {
        let matched = 0;
        for (let len = Math.min(n - i, this.maxWord); len >= 2 && !matched; len--) {
          const entries = this.words.get(chars.slice(i, i + len).join(''));
          if (!entries) continue;
          const pinyin = pickByJyutping(entries, jsylls.slice(i, i + len));
          if (!pinyin) continue;
          reading.push(...pinyin.match(/[a-zv:]+[1-5]/g));
          matched = len;
        }
        if (matched) {
          i += matched;
          continue;
        }
        const found = this.charPinyin(chars[i], jsylls[i]);
        reading.push(found ? found.pinyin : '?');
        guess ||= !found || found.guess;
        i += 1;
      }
      return { reading, alts: [], guess, corrected: false };
    }
  }

  // Pinyin of the word entry with this jyutping, else one matching without tones.
  function pickByJyutping(entries, jsylls) {
    const want = jsylls.join('');
    const exact = entries.find(([, variants]) => variants.some((v) => v.join('') === want));
    if (exact) return exact[0];
    const plain = jsylls.map(toneless).join('');
    const loose = entries.find(([, variants]) => variants.some((v) => v.map(toneless).join('') === plain));
    return loose ? loose[0] : null;
  }

  // Word entry whose pinyin equals the page's, else one that matches without tones.
  function pickEntry(entries, sylls) {
    const want = sylls.join('');
    const exact = entries.find(([pinyin]) => pinyin === want);
    if (exact) return exact[1];
    const plain = sylls.map(toneless).join('');
    const loose = entries.find(([pinyin]) => pinyin.replace(/\d/g, '') === plain);
    return loose ? loose[1] : null;
  }

  NS.Dictionary = Dictionary;
})();
