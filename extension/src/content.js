// Finds romanisation on any page (pinyin, or jyutping on sites that show it),
// works out which hanzi it belongs to, and shows or hides each kind according
// to the Pinyin / Jyutping switches:
//   - the kind the page already shows stays visible while its switch is on, and is
//     hidden while it is off;
//   - the other kind is added next to it while its switch is on.
// Works from text alone, so it does not depend on any site's class names.
(() => {
  const NS = (globalThis.JyutpingExt ??= {});
  if (NS.contentStarted) return;
  NS.contentStarted = true;

  const { api, DEFAULTS, CORRECTIONS_KEY, safeColor, findCantoneseVoice } = NS.settings;

  const STYLE_ID = 'jyutping-ext-style';
  const HOST_CLASS = 'jyutping-ext-host'; // inline parent turned inline-block so the reading can stack
  const HIDE_CLASS = 'jyutping-ext-hide'; // parent whose own romanisation is hidden
  const MAX_LEVELS = 7; // how far up the tree to look for the hanzi
  const MAX_LEVELS_UNMARKED = 3;
  const MAX_TEXT = 4000; // stop climbing once an ancestor holds this much text
  const MAX_TRIES = 8; // retries for romanisation whose hanzi has not appeared yet
  const HAN_OR_WORD = /\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu;
  const IS_HAN = /^\p{Script=Han}$/u;
  const STARTS_WITH_LETTER = /^[\s​ ]*[a-zA-ZāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙ]/;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TITLE', 'OPTION']);
  const SUPERSCRIPT = ['', '¹', '²', '³', '⁴', '⁵', '⁶'];

  let settings = { ...DEFAULTS };
  let corrections = {};
  let dict = null;
  let dictPromise = null;
  let active = false;
  let observer = null;
  let timer = 0;
  let pendingRoots = new Set();
  let dirtyTargets = new Set();
  const entries = new Map(); // romanisation Text node -> entry
  const annoEntries = new WeakMap(); // <jyut-ping> -> entry

  // ---------------------------------------------------------------- lifecycle

  // The script runs on every page but stays asleep until the page shows Chinese
  // characters and some text that really is pinyin (with tone marks) or jyutping.
  // Two steps keep that cheap: a quick look at the page's text (French "é" passes
  // it), then the real parsers on candidate text, using just the syllable lists.
  // Only then does it load the dictionary.
  const MAYBE_HAN = /\p{Script=Han}/u;
  const MAYBE_ROMANISATION = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]|(?:^|[^a-z0-9])[a-z]{1,6}[1-6](?![a-z0-9])/i;
  let sleepObserver = null;
  let sleepTimer = 0;
  let syllablesPromise = null;

  function siteAllowed() {
    return !(settings.offSites || []).includes(location.origin);
  }

  async function loadSyllables() {
    try {
      const res = await api.runtime.sendMessage({ type: 'jp:syllables' });
      NS.pinyin.setSyllables(res.pinyin);
      NS.jyutping.setSyllables(res.jyutping);
      return true;
    } catch {
      syllablesPromise = null;
      return false;
    }
  }

  async function pageLooksRelevant() {
    const text = document.body?.textContent || '';
    if (!MAYBE_HAN.test(text) || !MAYBE_ROMANISATION.test(text)) return false;
    if (!(await (syllablesPromise ||= loadSyllables()))) return false;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: acceptText });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!startsWithLetter(node)) continue;
      if (NS.pinyin.parse(node.nodeValue)?.marked || NS.jyutping.parse(node.nodeValue)) return true;
    }
    return false;
  }

  async function applyState() {
    if (!siteAllowed()) {
      stopWatching();
      if (active) stop();
      return;
    }
    if (!active && !dict && !(await pageLooksRelevant())) {
      if (siteAllowed()) watchForRomanisation();
      return;
    }
    stopWatching();
    dict ||= await (dictPromise ||= loadDictionary());
    if (!dict || !siteAllowed()) return;
    if (active) refreshAll();
    else start();
  }

  // Pages often add their text later (single-page apps, a tapped word's pinyin), so
  // look again, at most a couple of times a second, until something turns up.
  function watchForRomanisation() {
    if (sleepObserver) return;
    sleepObserver = new MutationObserver(() => {
      if (sleepTimer) return;
      sleepTimer = setTimeout(async () => {
        if (await pageLooksRelevant()) applyState();
        sleepTimer = 0;
      }, 400);
    });
    sleepObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }

  function stopWatching() {
    sleepObserver?.disconnect();
    sleepObserver = null;
    clearTimeout(sleepTimer);
    sleepTimer = 0;
  }

  async function loadDictionary() {
    try {
      const res = await api.runtime.sendMessage({ type: 'jp:data' });
      if (!res?.text) throw new Error(res?.error || 'empty response');
      const loaded = new NS.Dictionary(res.text);
      NS.pinyin.setSyllables(loaded.syllables);
      NS.jyutping.setSyllables(loaded.jyutSyllables);
      return loaded;
    } catch (err) {
      console.warn('[Jyutping] Could not load the dictionary:', err);
      dictPromise = null;
      return null;
    }
  }

  function start() {
    active = true;
    updateStyle();
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    for (const type of ['pointerdown', 'mousedown', 'click']) document.addEventListener(type, onPointer, true);
    scanAll();
  }

  function stop() {
    active = false;
    observer?.disconnect();
    observer = null;
    clearTimeout(timer);
    timer = 0;
    for (const type of ['pointerdown', 'mousedown', 'click']) document.removeEventListener(type, onPointer, true);
    clearAll();
    document.getElementById(STYLE_ID)?.remove();
  }

  function refreshAll() {
    updateStyle();
    clearAll();
    scanAll();
  }

  function clearAll() {
    for (const entry of entries.values()) resetEntry(entry);
    entries.clear();
    pendingRoots.clear();
    dirtyTargets.clear();
  }

  function scanAll() {
    const found = new Set();
    collectCandidates(document.body, found);
    for (const node of found) processNode(node);
  }

  // ---------------------------------------------------------------- watching the page

  // Our elements are <jyut-ping> and <jp-*> (custom tags, so site CSS leaves them alone).
  function isOurElement(el) {
    const name = el.localName;
    return name === 'jyut-ping' || name.startsWith('jp-');
  }

  function isOurNode(node) {
    return node.nodeType === Node.ELEMENT_NODE && (isOurElement(node) || node.id === STYLE_ID);
  }

  function acceptText(node) {
    const parent = node.parentElement;
    if (!parent || SKIP_TAGS.has(parent.tagName) || isOurElement(parent)) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }

  function onMutations(records) {
    for (const record of records) {
      if (record.type === 'characterData') {
        const parent = record.target.parentElement;
        if (parent && !isOurElement(parent)) {
          pendingRoots.add(record.target);
          dirtyTargets.add(parent);
        }
        continue;
      }
      if (isOurNode(record.target)) continue;
      let foreign = false;
      for (const node of record.addedNodes) {
        if (isOurNode(node)) continue;
        pendingRoots.add(node);
        foreign = true;
      }
      for (const node of record.removedNodes) if (!isOurNode(node)) foreign = true;
      if (foreign) dirtyTargets.add(record.target);
    }
    if ((pendingRoots.size || dirtyTargets.size) && !timer) timer = setTimeout(flush, 60);
  }

  function flush() {
    timer = 0;
    if (!active) return;
    const roots = pendingRoots;
    const dirty = dirtyTargets;
    pendingRoots = new Set();
    dirtyTargets = new Set();

    const todo = new Set();
    for (const root of roots) if (root.isConnected) collectCandidates(root, todo);
    for (const [node, entry] of entries) {
      if (!node.isConnected) {
        resetEntry(entry);
        entries.delete(node);
      } else if (entry.matched) {
        // The hanzi nearby may have changed (e.g. the next exercise), or the site
        // re-rendered and dropped what we added.
        if (!isRendered(entry, node) || touches(entry.host, dirty)) todo.add(node);
      } else if (entry.tries < MAX_TRIES && dirty.size) {
        todo.add(node); // romanisation rendered before its hanzi; try again
      }
    }
    for (const node of todo) processNode(node);
  }

  function touches(host, dirty) {
    if (!host?.isConnected) return true;
    for (const target of dirty) if (host.contains(target)) return true;
    return false;
  }

  function collectCandidates(root, out) {
    if (root.nodeType === Node.TEXT_NODE) {
      if (startsWithLetter(root) && acceptText(root) === NodeFilter.FILTER_ACCEPT) out.add(root);
      return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE || isOurNode(root)) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: acceptText });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (startsWithLetter(node)) out.add(node);
    }
  }

  function startsWithLetter(node) {
    const value = node.nodeValue;
    return value.length <= 160 && STARTS_WITH_LETTER.test(value);
  }

  // ---------------------------------------------------------------- matching

  // What kind of romanisation a text node holds, if any.
  function parseSource(node, parent) {
    const pinyin = NS.pinyin.parse(node.nodeValue);
    // Unmarked pinyin ("de", "men") must be the only text in its element.
    if (pinyin && (pinyin.marked || isOnlyText(parent, node))) return { kind: 'pinyin', ...pinyin };
    const jyutping = NS.jyutping.parse(node.nodeValue);
    if (jyutping) return { kind: 'jyutping', marked: true, ...jyutping };
    return null;
  }

  function processNode(node) {
    const parent = node.parentElement;
    let entry = entries.get(node);
    const source = parent && !parent.isContentEditable ? parseSource(node, parent) : null;
    if (!source) {
      if (entry) {
        resetEntry(entry);
        entries.delete(node);
      }
      return;
    }
    if (!entry) {
      entry = { tries: 0, text: null, anno: null, key: null, matched: false };
      entries.set(node, entry);
    }
    if (entry.text !== node.nodeValue) {
      entry.text = node.nodeValue;
      entry.tries = 0;
    }

    const match = findHanzi(node, source);
    if (!match) {
      entry.tries += 1;
      resetEntry(entry);
      return;
    }
    const fromPinyin = source.kind === 'pinyin';
    const result = fromPinyin ? dict.convert(match.hanzi, source.sylls, corrections) : dict.toPinyin(match.hanzi, source.sylls);
    const showSource = fromPinyin ? settings.showPinyin : settings.showJyutping;
    const showOther = fromPinyin ? settings.showJyutping : settings.showPinyin;
    const key = [
      source.kind, match.hanzi, source.sylls.join(' '), result.reading.join(' '),
      result.alts.map((a) => a.join(' ')).join('/'), result.corrected, showSource, showOther,
    ].join('|');
    Object.assign(entry, {
      matched: true, host: match.host, kind: source.kind, hanzi: match.hanzi,
      sylls: source.sylls, result, sourceText: node.nodeValue.trim(),
    });
    if (entry.key === key && isRendered(entry, node)) return;
    entry.key = key;
    render(entry, node, showSource, showOther);
  }

  // Separators sites put next to romanisation as their own text nodes, e.g. the
  // ", " in React's `{pinyin},&nbsp;`.
  const isFiller = (n) => n.nodeType === Node.TEXT_NODE && /^[\s​,，、;；/|·.]*$/.test(n.nodeValue);

  function isOnlyText(parent, node) {
    for (const child of parent.childNodes) {
      if (child === node || isOurNode(child) || isFiller(child)) continue;
      return false;
    }
    return true;
  }

  // The added reading goes after the source and any filler that directly follows it.
  function anchorFor(node) {
    let anchor = node;
    while (anchor.nextSibling && isFiller(anchor.nextSibling)) anchor = anchor.nextSibling;
    return anchor;
  }

  // Walks up from the romanisation until an ancestor contains hanzi whose readings
  // fit every syllable. Among fits, prefers all-exact tones, then the closest hanzi
  // (text just before the romanisation beats text after it).
  function findHanzi(node, source) {
    const strict = !source.marked;
    const levels = strict ? MAX_LEVELS_UNMARKED : MAX_LEVELS;
    const matchChar = source.kind === 'pinyin' ? (ch, s) => dict.charMatch(ch, s) : (ch, s) => dict.charMatchJyut(ch, s);
    let el = node.parentElement;
    for (let level = 0; el && level < levels && el !== document.documentElement; level++, el = el.parentElement) {
      const seq = collectHan(el, node);
      if (!seq) break;
      const hanzi = bestWindow(seq, source.sylls, strict, matchChar);
      if (hanzi) return { hanzi, host: el };
    }
    return null;
  }

  // Hanzi under `root` in document order. Latin words and digits split the text
  // into runs (a match cannot cross them); so does the source node itself.
  function collectHan(root, sourceNode) {
    const chars = [];
    let run = 0;
    let pivot = 0;
    let total = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: acceptText });
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (t === sourceNode) {
        pivot = chars.length;
        run += 1;
        continue;
      }
      const value = t.nodeValue;
      total += value.length;
      if (total > MAX_TEXT) return null;
      for (const token of value.match(HAN_OR_WORD) || []) {
        if (IS_HAN.test(token)) chars.push({ ch: token, run });
        else run += 1;
      }
    }
    return { chars, pivot };
  }

  function bestWindow({ chars, pivot }, sylls, strict, matchChar) {
    const n = sylls.length;
    let best = null;
    for (let start = 0; start + n <= chars.length; start++) {
      if (chars[start].run !== chars[start + n - 1].run) continue;
      let exact = 0;
      let unknown = 0;
      let fits = true;
      for (let k = 0; k < n && fits; k++) {
        const m = matchChar(chars[start + k].ch, sylls[k]);
        if (m < 0) fits = false;
        else if (m === 2) exact += 1;
        else if (m === 0) unknown += 1;
      }
      if (!fits || unknown > (n >= 3 ? 1 : 0) || (strict && exact < n)) continue;
      const end = start + n;
      const candidate = {
        start,
        allExact: exact === n,
        unknown,
        distance: end <= pivot ? pivot - end : start - pivot + 0.5,
      };
      if (!best || better(candidate, best)) best = candidate;
    }
    return best && chars.slice(best.start, best.start + n).map((c) => c.ch).join('');
  }

  function better(a, b) {
    if (a.allExact !== b.allExact) return a.allExact;
    if (a.unknown !== b.unknown) return a.unknown < b.unknown;
    return a.distance < b.distance;
  }

  // ---------------------------------------------------------------- rendering

  // The page's own romanisation is hidden by collapsing its element (font-size 0),
  // which only works when that element holds nothing else. The added reading then
  // needs an absolute size, measured before collapsing.
  function render(entry, node, showSource, showOther) {
    const parent = node.parentElement;
    const hide = !showSource && isOnlyText(parent, node);
    if (!parent.classList.contains(HIDE_CLASS)) entry.fontPx = parseFloat(getComputedStyle(parent).fontSize);
    if (hide) {
      parent.classList.add(HIDE_CLASS);
      entry.hiddenHost = parent;
    } else {
      unhide(entry);
    }
    entry.wantHide = hide;

    if (!showOther) {
      removeAnno(entry);
      return;
    }
    if (!entry.anno) {
      entry.anno = document.createElement('jyut-ping');
      annoEntries.set(entry.anno, entry);
    }
    fillAnno(entry);
    if (hide && entry.fontPx) entry.anno.style.setProperty('--jp-base', `${entry.fontPx}px`);
    else entry.anno.style.removeProperty('--jp-base');
    placeAnno(entry, node);
  }

  function isRendered(entry, node) {
    if (entry.wantHide && !node.parentElement.classList.contains(HIDE_CLASS)) return false;
    if (entry.anno && (!entry.anno.isConnected || entry.anno.previousSibling !== anchorFor(node))) return false;
    return true;
  }

  function fillAnno(entry) {
    const { anno, result } = entry;
    anno.textContent = '';
    const main = document.createElement('jp-main');
    if (entry.kind === 'jyutping') {
      // Added pinyin: tone marks, no tone styles.
      anno.dataset.kind = 'pinyin';
      delete anno.dataset.tones;
      main.textContent = NS.pinyin.format(result.reading);
      anno.append(main);
    } else {
      anno.dataset.kind = 'jyutping';
      anno.dataset.tones = settings.toneStyle;
      appendSyllables(main, result.reading);
      anno.append(main);
      if (settings.showAlternates && result.alts.length) {
        const alt = document.createElement('jp-alt');
        for (const reading of result.alts.slice(0, 2)) {
          alt.append(' / ');
          appendSyllables(alt, reading);
        }
        anno.append(alt);
      }
    }
    toggleAttr(anno, 'data-corrected', result.corrected);
    toggleAttr(anno, 'data-guess', result.guess);
  }

  function appendSyllables(parent, sylls) {
    sylls.forEach((syl, i) => {
      if (i) parent.append(' ');
      const el = document.createElement('jp-syl');
      const tone = syl.slice(-1);
      el.dataset.tone = tone;
      el.textContent = settings.toneStyle === 'superscript' && /\d/.test(tone) ? syl.slice(0, -1) + SUPERSCRIPT[tone] : syl;
      parent.append(el);
    });
  }

  function toggleAttr(el, name, on) {
    if (on) el.setAttribute(name, '');
    else el.removeAttribute(name);
  }

  // Inserts the reading right after the source text. In "below" mode an inline
  // parent holding only the source becomes inline-block so the reading stacks
  // underneath it; mixed inline text falls back to showing it beside.
  function placeAnno(entry, node) {
    const parent = node.parentElement;
    const { anno } = entry;
    const anchor = anchorFor(node);
    if (anno.previousSibling !== anchor) parent.insertBefore(anno, anchor.nextSibling);
    let layout = entry.wantHide ? 'below' : settings.layout;
    const display = getComputedStyle(parent).display;
    if (layout === 'below' && display === 'inline') {
      if (isOnlyText(parent, node)) {
        parent.classList.add(HOST_CLASS);
        entry.styledHost = parent;
      } else {
        layout = 'inline';
      }
    } else if (display.startsWith('ruby')) {
      layout = 'inline'; // <rt> text is a single line above the character
    }
    anno.dataset.layout = layout;
  }

  function removeAnno(entry) {
    entry.anno?.remove();
    entry.styledHost?.classList.remove(HOST_CLASS);
    entry.styledHost = null;
  }

  function unhide(entry) {
    entry.hiddenHost?.classList.remove(HIDE_CLASS);
    entry.hiddenHost = null;
  }

  function resetEntry(entry) {
    removeAnno(entry);
    unhide(entry);
    entry.wantHide = false;
    entry.matched = false;
    entry.key = null;
  }

  function updateStyle() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      (document.head || document.documentElement).append(style);
    }
    const color = safeColor(settings.color);
    const scale = Math.min(Math.max(Number(settings.scale) || DEFAULTS.scale, 50), 150) / 100;
    style.textContent = `
      jyut-ping { display: block; font: inherit; font-size: calc(var(--jp-base, 1em) * ${scale}); font-weight: 400;
        font-style: normal; line-height: 1.3; letter-spacing: normal; text-transform: none; text-decoration: none;
        color: ${color}; margin: 0; padding: 0; border: 0; background: none; white-space: normal; cursor: pointer;
        -webkit-user-select: none; user-select: none; }
      jyut-ping[data-layout="below"] { padding-inline-end: 0.5em; }
      jyut-ping[data-layout="inline"] { display: inline; margin: 0 0.5em 0 0.4em; }
      jyut-ping jp-syl { white-space: nowrap; }
      jyut-ping jp-alt { opacity: 0.6; font-size: 0.9em; }
      jyut-ping[data-guess] jp-main { opacity: 0.6; }
      jyut-ping[data-corrected] jp-main { text-decoration: underline dotted; text-underline-offset: 2px; }
      jyut-ping:hover jp-main { text-decoration: underline; text-underline-offset: 2px; }
      jyut-ping[data-tones="color"] jp-syl[data-tone="1"] { color: #d1495b; }
      jyut-ping[data-tones="color"] jp-syl[data-tone="2"] { color: #e07a1f; }
      jyut-ping[data-tones="color"] jp-syl[data-tone="3"] { color: #2a9d58; }
      jyut-ping[data-tones="color"] jp-syl[data-tone="4"] { color: #2f6fd6; }
      jyut-ping[data-tones="color"] jp-syl[data-tone="5"] { color: #8e5cc9; }
      jyut-ping[data-tones="color"] jp-syl[data-tone="6"] { color: #6b7280; }
      .${HOST_CLASS} { display: inline-block !important; vertical-align: top; }
      .${HIDE_CLASS} { font-size: 0 !important; line-height: 0 !important; }
      jp-toast { position: fixed; z-index: 2147483647; right: 16px; bottom: 16px; max-width: 340px;
        padding: 10px 14px; border-radius: 8px; background: #1f2937; color: #f9fafb;
        font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
    `;
  }

  // ---------------------------------------------------------------- clicks

  function onPointer(ev) {
    const anno = ev.target instanceof Element ? ev.target.closest('jyut-ping') : null;
    const entry = anno && annoEntries.get(anno);
    if (!entry) return;
    const correcting = ev.shiftKey && entry.kind === 'pinyin';
    if (!correcting && !settings.speakOnClick) return;
    // Keep the site from treating this as a click on the word underneath.
    ev.stopPropagation();
    if (ev.type !== 'click') return;
    ev.preventDefault();
    if (correcting) correct(entry);
    else speak(entry.hanzi, entry.kind === 'pinyin' ? 'yue' : 'cmn');
  }

  // Clicking added jyutping speaks Cantonese; clicking added pinyin speaks Mandarin.
  function speak(text, language) {
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.85;
    const voices = speechSynthesis.getVoices();
    if (language === 'yue') {
      utterance.lang = 'zh-HK';
      const voice = findCantoneseVoice(voices);
      if (voice) utterance.voice = voice;
      else toast('No Cantonese voice installed. On Windows, add "Chinese (Traditional, Hong Kong SAR)" under Settings → Time & language → Speech.');
    } else {
      utterance.lang = 'zh-CN';
      const voice = voices.find((v) => /^(zh[-_](cn|tw|sg)|cmn)/i.test(v.lang));
      if (voice) utterance.voice = voice;
    }
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  }

  async function correct(entry) {
    const shown = entry.result.reading.join(' ');
    const input = prompt(
      `Cantonese reading for ${entry.hanzi} (${entry.sourceText})\n` +
        'Jyutping with tone numbers, e.g. "dung1 ging1". Leave empty to use the dictionary again.',
      shown,
    );
    if (input === null) return;
    const clean = input.trim().toLowerCase();
    const sylls = clean.match(/[a-z]+[1-6]/g) || [];
    const key = `${entry.hanzi}|${entry.sylls.join(' ')}`;
    const next = { ...corrections };
    if (!clean) {
      delete next[key];
    } else if (sylls.join('') !== clean.replace(/\s+/g, '') || sylls.length !== [...entry.hanzi].length) {
      toast(`"${input.trim()}" isn't jyutping for ${entry.hanzi}: use one syllable per character, each ending in a tone number 1–6.`);
      return;
    } else {
      next[key] = sylls.join(' ');
    }
    await api.storage.local.set({ [CORRECTIONS_KEY]: next });
  }

  let toastTimer = 0;
  function toast(message) {
    let el = document.querySelector('jp-toast');
    if (!el) {
      el = document.createElement('jp-toast');
      document.documentElement.append(el);
    }
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 6000);
  }

  // ---------------------------------------------------------------- extension wiring

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'jp:stats') {
      let count = 0;
      for (const entry of entries.values()) if (entry.matched) count += 1;
      sendResponse({ active, count, siteAllowed: siteAllowed(), asleep: Boolean(sleepObserver) });
    }
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      let relevant = false;
      for (const [key, { newValue }] of Object.entries(changes)) {
        if (!(key in DEFAULTS)) continue;
        settings[key] = newValue ?? DEFAULTS[key];
        relevant = true;
      }
      if (relevant) applyState();
    } else if (area === 'local' && changes[CORRECTIONS_KEY]) {
      corrections = changes[CORRECTIONS_KEY].newValue || {};
      if (active) refreshAll();
    }
  });

  (async () => {
    const [synced, local] = await Promise.all([
      api.storage.sync.get(DEFAULTS),
      api.storage.local.get({ [CORRECTIONS_KEY]: {} }),
    ]);
    settings = synced;
    corrections = local[CORRECTIONS_KEY];
    applyState();
  })();
})();
