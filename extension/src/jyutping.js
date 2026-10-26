// Jyutping recognition: "ngan4 hong4" or "ngan4hong4" -> ["ngan4", "hong4"].
// Valid syllables come from the data file; every syllable needs a tone number.
(() => {
  const NS = (globalThis.JyutpingExt ??= {});
  if (NS.jyutping) return;

  const JYUT_TEXT = /^[a-z1-6\s​ '’·,.;:!?()[\]\-/]+$/;
  const SYLLABLE = /[a-z]+[1-6]/g;

  let syllables = new Set();

  function setSyllables(list) {
    syllables = new Set(list);
  }

  // Returns { sylls } when the whole text is jyutping, otherwise null.
  function parse(raw) {
    if (!raw || raw.length > 160 || !syllables.size) return null;
    const text = raw.normalize('NFC').trim().toLowerCase();
    if (!JYUT_TEXT.test(text)) return null;
    const sylls = text.match(SYLLABLE);
    if (!sylls || sylls.length > 40) return null;
    // Nothing but separators may be left once the syllables are removed.
    if (/[a-z0-9]/.test(text.replace(SYLLABLE, ''))) return null;
    if (!sylls.every((s) => syllables.has(s.slice(0, -1)))) return null;
    return { sylls };
  }

  NS.jyutping = { setSyllables, parse };
})();
