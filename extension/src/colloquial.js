// Everyday Cantonese words for Mandarin ones (data/colloquial.tsv): 是 → 係, 看 → 睇.
(() => {
  const NS = (globalThis.JyutpingExt ??= {});
  if (NS.Colloquial) return;

  const toneless = (pinyin) => pinyin.replace(/\d/g, '');
  const MAX_PART_TAGS = 4;

  class Colloquial {
    // `keepText` (data/colloquial-keep.txt) lists words Cantonese says the same way, which
    // are never split into parts.
    constructor(text, keepText = '') {
      this.byForm = new Map(); // Mandarin word -> [{ pinyin, exact, words }]
      this.parts = new Set(); // single characters whose swap holds inside other words
      this.longest = 1;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim() || line.startsWith('#')) continue;
        const [forms, rawPinyin = '', cantonese = '', part = ''] = line.split('\t');
        const words = cantonese.split('|').map(parseWord).filter(Boolean);
        if (!words.length) continue;
        const rule = {
          pinyin: rawPinyin.replace(/!$/, '').toLowerCase(),
          exact: rawPinyin.endsWith('!'),
          words,
        };
        for (const form of forms.split(',')) {
          if (!this.byForm.has(form)) this.byForm.set(form, []);
          this.byForm.get(form).push(rule);
          if (part === 'part') this.parts.add(form);
          this.longest = Math.max(this.longest, [...form].length);
        }
      }
      this.keep = new Set(keepText.split(/\r?\n/).filter((line) => line && !line.startsWith('#')));
    }

    // Cantonese words for `hanzi` read as `sylls` (numbered pinyin), or null. A word or
    // phrase that isn't listed whole gets the words for its parts instead, each with `from`
    // set to the Mandarin part (不想 → 不 → 唔): listed words, longest first, and single
    // characters marked "part". Words in the keep list stay whole and get nothing.
    lookup(hanzi, sylls) {
      const whole = this.match(hanzi, sylls);
      if (whole) return whole;
      const chars = [...hanzi];
      if (chars.length < 2 || chars.length !== sylls.length || this.keep.has(hanzi)) return null;
      const found = [];
      const seen = new Set();
      for (let i = 0; i < chars.length && found.length < MAX_PART_TAGS; ) {
        let step = 1;
        for (let length = Math.min(this.longest, chars.length - i); length >= 1; length--) {
          const piece = chars.slice(i, i + length).join('');
          if (length > 1 && this.keep.has(piece)) {
            step = length; // said the same way in Cantonese: nothing inside it is tagged
            break;
          }
          if (length === 1 && !this.parts.has(piece)) continue;
          const words = this.match(piece, sylls.slice(i, i + length));
          if (!words) continue;
          // One tag per part, its first Cantonese word, so a sentence doesn't fill up.
          if (!seen.has(piece)) found.push({ ...words[0], from: piece });
          seen.add(piece);
          step = length;
          break;
        }
        i += step;
      }
      return found.length ? found : null;
    }

    // The words of the first row for `hanzi` whose pinyin fits `sylls`. Rows without
    // pinyin match any reading; the rest match without tones unless marked exact.
    match(hanzi, sylls) {
      const rules = this.byForm.get(hanzi);
      if (!rules) return null;
      const shown = sylls.join('');
      for (const rule of rules) {
        if (!rule.pinyin) return rule.words;
        if (rule.exact ? rule.pinyin === shown : toneless(rule.pinyin) === toneless(shown)) return rule.words;
      }
      return null;
    }
  }

  // "唔好 m4 hou2 (don't)" -> { hanzi: '唔好', jyut: ['m4', 'hou2'], note: "don't" }
  function parseWord(text) {
    const match = text.trim().match(/^(\S+)\s+([a-z0-9 ]+?)(?:\s*\((.+)\))?$/);
    return match ? { hanzi: match[1], jyut: match[2].trim().split(/\s+/), note: match[3] || '' } : null;
  }

  NS.Colloquial = Colloquial;
})();
