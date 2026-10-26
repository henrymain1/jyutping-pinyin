// Settings shared by the content scripts and the popup.
(() => {
  const NS = (globalThis.JyutpingExt ??= {});
  if (NS.settings) return;

  NS.settings = {
    // Firefox's promise-based `browser` namespace when present, else Chrome's.
    api: globalThis.browser ?? globalThis.chrome,

    isFirefox: (globalThis.browser ?? globalThis.chrome).runtime.getURL('').startsWith('moz-extension:'),

    DEFAULTS: {
      showPinyin: true,
      showJyutping: true,
      toneStyle: 'number', // 'number' | 'superscript' | 'color'
      layout: 'below', // 'below' | 'inline'
      color: '#0f766e',
      scale: 90, // percent of the pinyin's font size
      showAlternates: true,
      speakOnClick: true,
      offSites: [], // origins the user switched it off for, e.g. "https://example.com"
    },

    // Corrections live in storage.local under this key: { "東京|dong1 jing1": "dung1 ging1" }.
    CORRECTIONS_KEY: 'corrections',

    safeColor(value) {
      return /^#[0-9a-f]{6}$/i.test(value) ? value : NS.settings.DEFAULTS.color;
    },

    // A Cantonese text-to-speech voice, if the browser or OS has one.
    findCantoneseVoice(voices) {
      return (
        voices.find((v) => /^(zh|yue)[-_]hk/i.test(v.lang) || /^yue/i.test(v.lang)) ||
        voices.find((v) => /cantonese|粵|粤|hong kong/i.test(v.name))
      );
    },
  };
})();
