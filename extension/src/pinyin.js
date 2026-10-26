// Pinyin parsing: turns text such as "dōng​jīng" or "Nǐ hǎo" into numbered
// syllables (["dong1", "jing1"]). Valid syllables come from the data file.
(() => {
  const NS = (globalThis.JyutpingExt ??= {});
  if (NS.pinyin) return;

  // Marked letter -> [plain letter, tone]. ü is written "v", as in the data file.
  const MARKS = new Map();
  const MARKED_VOWELS = { a: 'āáǎà', e: 'ēéěè', i: 'īíǐì', o: 'ōóǒò', u: 'ūúǔù', v: 'ǖǘǚǜ', n: 'ńňǹ' };
  for (const [plain, marked] of Object.entries(MARKED_VOWELS)) {
    [...marked].forEach((ch, i) => MARKS.set(ch, [plain, i + 1]));
  }
  MARKS.set('ḿ', ['m', 2]);
  MARKS.set('ü', ['v', 0]);

  const LETTERS = 'a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ';
  const SEPARATORS = '\\s\\u200b\\u00a0\'’‘·,.;:!?()\\[\\]\\-–—…"“”';
  const PINYIN_TEXT = new RegExp(`^[${LETTERS}${SEPARATORS}]+$`);
  const HAS_LETTER = new RegExp(`[${LETTERS}]`);
  const HAS_MARK = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜńňǹḿ]/;
  const NOT_LETTERS = new RegExp(`[^${LETTERS}]+`);
  const LONGEST_SYLLABLE = 6;

  let syllables = new Set();

  function setSyllables(list) {
    syllables = new Set(list);
  }

  // Splits a run of letters into syllables, using as few as possible ("xian" stays
  // one syllable) and allowing at most one tone mark per syllable ("xīān" -> xi + an).
  function segment(chunk) {
    const plain = [];
    const tones = [];
    for (const ch of chunk) {
      const mark = MARKS.get(ch);
      plain.push(mark ? mark[0] : ch);
      tones.push(mark ? mark[1] : 0);
    }
    const s = plain.join('');
    const n = s.length;
    const fewest = new Array(n + 1).fill(Infinity);
    const next = new Array(n + 1);
    fewest[n] = 0;
    for (let i = n - 1; i >= 0; i--) {
      for (let len = Math.min(LONGEST_SYLLABLE, n - i); len >= 1; len--) {
        const j = i + len;
        if (fewest[j] + 1 >= fewest[i]) continue;
        const syl = s.slice(i, j);
        // Erhua "r" (as in "huàr") only ever follows another syllable.
        if (!syllables.has(syl) || (syl === 'r' && i === 0)) continue;
        let marks = 0;
        for (let k = i; k < j; k++) if (tones[k]) marks++;
        if (marks > 1) continue;
        fewest[i] = fewest[j] + 1;
        next[i] = j;
      }
    }
    if (fewest[0] === Infinity) return null;
    const out = [];
    for (let i = 0; i < n; i = next[i]) {
      let tone = 5;
      for (let k = i; k < next[i]; k++) if (tones[k]) tone = tones[k];
      out.push(s.slice(i, next[i]) + tone);
    }
    return out;
  }

  // Returns { sylls, marked } when the whole text is pinyin, otherwise null.
  function parse(raw) {
    if (!raw || raw.length > 160 || !syllables.size) return null;
    const text = raw.normalize('NFC').trim();
    const lower = text.toLowerCase();
    if (!PINYIN_TEXT.test(lower) || !HAS_LETTER.test(lower)) return null;
    const marked = HAS_MARK.test(lower);
    // Unmarked text is only considered when it is short and lowercase, like the
    // neutral-tone "de" or "men" that dong-chinese shows under particles. English
    // labels are usually capitalised or longer. Callers still require matching hanzi.
    if (!marked && (lower !== text || text.length > 12)) return null;
    const sylls = [];
    for (const chunk of lower.split(NOT_LETTERS)) {
      if (!chunk) continue;
      const part = segment(chunk);
      if (!part) return null;
      sylls.push(...part);
    }
    if (!sylls.length || sylls.length > 40) return null;
    return { sylls, marked };
  }

  // ["yin2", "hang2"] -> "yínháng". The mark goes on a or e, else the o of "ou",
  // else the last vowel; syllables starting with a vowel get an apostrophe ("xī'ān").
  // Longer strings are spaced per syllable, since word boundaries are unknown.
  const COMBINING = ['̄', '́', '̌', '̀'];
  function markSyllable(syl) {
    const tone = Number(syl.slice(-1));
    const s = syl.slice(0, -1).replace(/v/g, 'ü');
    if (!(tone >= 1 && tone <= 4)) return s;
    let at = s.search(/[ae]/);
    if (at < 0) at = s.indexOf('ou');
    if (at < 0) at = Math.max(...['i', 'o', 'u', 'ü'].map((v) => s.lastIndexOf(v)));
    if (at < 0) at = 0; // m, n, ng
    return (s.slice(0, at + 1) + COMBINING[tone - 1] + s.slice(at + 1)).normalize('NFC');
  }

  function format(sylls) {
    const marked = sylls.map(markSyllable);
    if (sylls.length > 4) return marked.join(' ');
    return marked.map((m, i) => (i && /^[aeo]/.test(m.normalize('NFD')) ? `'${m}` : m)).join('');
  }

  NS.pinyin = { setSyllables, parse, format };
})();
