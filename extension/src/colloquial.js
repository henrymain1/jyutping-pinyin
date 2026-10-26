// Everyday Cantonese words for Mandarin ones (data/colloquial.tsv): 是 → 係, 看 → 睇.
(() => {
  const NS = (globalThis.JyutpingExt ??= {});
  if (NS.Colloquial) return;

  const toneless = (pinyin) => pinyin.replace(/\d/g, '');

  class Colloquial {
    constructor(text) {
      this.byForm = new Map(); // Mandarin word -> [{ pinyin, exact, words }]
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim() || line.startsWith('#')) continue;
        const [forms, rawPinyin = '', cantonese = ''] = line.split('\t');
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
        }
      }
    }

    // Cantonese words for `hanzi` read as `sylls` (numbered pinyin), or null. Rows
    // without pinyin match any reading; the rest match without tones unless marked exact.
    lookup(hanzi, sylls) {
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
