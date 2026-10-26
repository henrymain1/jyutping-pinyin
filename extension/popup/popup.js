// Popup: the Pinyin / Jyutping switches, display settings, the current tab's
// status, extra sites, and saved corrections.
const { api, DEFAULTS, CORRECTIONS_KEY, safeColor, findCantoneseVoice } =
  globalThis.JyutpingExt.settings;

const COLORS = ['#0f766e', '#1d4ed8', '#7c3aed', '#be123c', '#b45309', '#4b5563'];
const SUPERSCRIPT = ['', '¹', '²', '³', '⁴', '⁵', '⁶'];
const $ = (selector) => document.querySelector(selector);

let settings = { ...DEFAULTS };
let tab = null;
let voiceMissing = false;
let pending = {};
let saveTimer = 0;

// Storage writes are debounced: the slider and colour picker fire many events,
// and storage.sync limits writes per minute.
function save(patch) {
  Object.assign(settings, patch);
  Object.assign(pending, patch);
  render();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    api.storage.sync.set(pending);
    pending = {};
  }, 200);
}

// ------------------------------------------------------------- rendering

function render() {
  $('#showPinyin').checked = settings.showPinyin;
  $('#showJyutping').checked = settings.showJyutping;
  for (const el of document.querySelectorAll('[data-row="pinyin"]')) el.classList.toggle('off', !settings.showPinyin);
  for (const el of document.querySelectorAll('[data-row="jyutping"]')) el.classList.toggle('off', !settings.showJyutping);
  for (const el of document.querySelectorAll('[data-row="colloquial"]')) el.classList.toggle('off', !settings.showColloquial);
  // Position only matters while both are shown.
  $('#layout-row').classList.toggle('disabled', !(settings.showPinyin && settings.showJyutping));

  for (const seg of document.querySelectorAll('.seg')) {
    for (const button of seg.querySelectorAll('button')) {
      button.setAttribute('aria-checked', String(settings[seg.dataset.setting] === button.dataset.value));
    }
    placeIndicator(seg);
  }

  const scale = $('#scale');
  scale.value = settings.scale;
  scale.style.setProperty('--fill', `${((settings.scale - scale.min) / (scale.max - scale.min)) * 100}%`);
  $('#scale-out').textContent = `${settings.scale}%`;

  const color = safeColor(settings.color);
  for (const swatch of document.querySelectorAll('.swatch')) {
    swatch.setAttribute('aria-checked', String(swatch.dataset.color === color));
  }
  $('.custom').classList.toggle('selected', !COLORS.includes(color));
  $('#custom-color').value = color;

  $('#showAlternates').checked = settings.showAlternates;
  $('#showColloquial').checked = settings.showColloquial;
  $('#speakOnClick').checked = settings.speakOnClick;
  $('#voice-status').hidden = !(settings.speakOnClick && voiceMissing);

  const root = document.documentElement.style;
  root.setProperty('--jp', color);
  root.setProperty('--scale', String(settings.scale / 100));
  for (const el of document.querySelectorAll('.jp')) renderReading(el);
}

// A segmented control's chip slides to the chosen option instead of jumping (the same
// approach as video-to-lesson's useIndicator). Puts the chosen button's box on the group as
// --indicator-x/-y/-w/-h and marks it data-indicator; the CSS draws the chip from ::after.
// The first placement is instant so the chip doesn't fly in when the panel opens.
function placeIndicator(seg) {
  const chosen = seg.querySelector('button[aria-checked="true"]');
  if (!chosen) {
    seg.removeAttribute('data-indicator');
    return;
  }
  const first = !seg.hasAttribute('data-indicator');
  if (first) seg.setAttribute('data-instant', '');
  seg.style.setProperty('--indicator-x', `${chosen.offsetLeft}px`);
  seg.style.setProperty('--indicator-y', `${chosen.offsetTop}px`);
  seg.style.setProperty('--indicator-w', `${chosen.offsetWidth}px`);
  seg.style.setProperty('--indicator-h', `${chosen.offsetHeight}px`);
  seg.setAttribute('data-indicator', '');
  if (first) requestAnimationFrame(() => requestAnimationFrame(() => seg.removeAttribute('data-instant')));
}

// Turning a switch on pops the icon of the row it belongs to.
function pop(input) {
  if (!input.checked) return;
  const icon = input.closest('.row')?.querySelector('.icon');
  if (!icon) return;
  icon.classList.remove('pop');
  void icon.offsetWidth; // restart the animation
  icon.classList.add('pop');
}

function renderReading(el) {
  el.textContent = '';
  el.dataset.tones = settings.toneStyle;
  el.dataset.reading.split(' ').forEach((syl, i) => {
    if (i) el.append(' ');
    const span = document.createElement('span');
    const tone = syl.slice(-1);
    span.dataset.tone = tone;
    span.textContent = settings.toneStyle === 'superscript' ? syl.slice(0, -1) + SUPERSCRIPT[tone] : syl;
    el.append(span);
  });
}

// ------------------------------------------------------------- controls

function bindControls() {
  $('#showPinyin').addEventListener('change', (e) => save({ showPinyin: e.target.checked }));
  $('#showJyutping').addEventListener('change', (e) => save({ showJyutping: e.target.checked }));

  for (const seg of document.querySelectorAll('.seg')) {
    for (const button of seg.querySelectorAll('button')) {
      button.setAttribute('role', 'radio');
      button.addEventListener('click', () => save({ [seg.dataset.setting]: button.dataset.value }));
    }
  }

  $('#scale').addEventListener('input', (e) => save({ scale: Number(e.target.value) }));

  const wrap = $('#swatches');
  const custom = wrap.querySelector('.custom');
  for (const color of COLORS) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.style.background = color;
    swatch.dataset.color = color;
    swatch.setAttribute('role', 'radio');
    swatch.setAttribute('aria-label', `Colour ${color}`);
    swatch.addEventListener('click', () => save({ color }));
    wrap.insertBefore(swatch, custom);
  }
  $('#custom-color').addEventListener('input', (e) => save({ color: e.target.value }));

  $('#showAlternates').addEventListener('change', (e) => {
    pop(e.target);
    save({ showAlternates: e.target.checked });
  });
  $('#showColloquial').addEventListener('change', (e) => {
    pop(e.target);
    save({ showColloquial: e.target.checked });
  });
  $('#speakOnClick').addEventListener('change', (e) => {
    pop(e.target);
    save({ speakOnClick: e.target.checked });
  });

  // Option widths settle once fonts load; keep the chips on their options.
  const observer = new ResizeObserver(() => document.querySelectorAll('.seg').forEach(placeIndicator));
  document.querySelectorAll('.seg').forEach((seg) => observer.observe(seg));
}

// ------------------------------------------------------------- current tab

function currentUrl() {
  try {
    return tab?.url ? new URL(tab.url) : null;
  } catch {
    return null;
  }
}

function isWebPage(url) {
  return Boolean(url && /^https?:$/.test(url.protocol));
}

function setStatus(text) {
  const status = $('#status');
  if (status.textContent !== text) status.textContent = text;
}

// Works out the This site row and the status line, then writes the line once so
// it never blanks in between.
async function refreshStatus() {
  const url = currentUrl();
  const web = isWebPage(url);
  $('#site-row').hidden = !web;
  if (!web) {
    setStatus('');
    return;
  }
  // Firefox lets people withhold access site by site; Chrome can too, from its own menu.
  const hasAccess = await api.permissions.contains({ origins: [`${url.origin}/*`] });
  const on = !(settings.offSites || []).includes(url.origin);
  $('#site-name').textContent = url.hostname.replace(/^www\./, '');
  $('#siteOn').checked = on;
  $('#site-switch').hidden = !hasAccess;
  $('#site-allow').hidden = hasAccess;

  if (!hasAccess) return setStatus('Needs access to this site');
  if (!on) return setStatus('Off on this site');
  let stats = null;
  try {
    stats = await api.tabs.sendMessage(tab.id, { type: 'jp:stats' });
  } catch {
    // No content script in this tab yet (opened before the extension was installed).
  }
  if (!stats) setStatus('Reload the page');
  else if (!stats.active || !stats.count) setStatus('No pinyin or jyutping here');
  else setStatus(`${stats.count} on this page`);
}

function bindSiteRow() {
  $('#siteOn').addEventListener('change', (e) => {
    const { origin } = currentUrl();
    const off = new Set(settings.offSites || []);
    if (e.target.checked) off.delete(origin);
    else off.add(origin);
    pop(e.target);
    save({ offSites: [...off] });
    if (e.target.checked) setTimeout(refreshStatus, 900); // the page needs a moment to count
    else setStatus('Off on this site');
  });
  // permissions.request has to run straight from the click; the background script
  // starts the extension in the tab once access is granted.
  $('#site-allow').addEventListener('click', () => {
    api.permissions
      .request({ origins: [`${currentUrl().origin}/*`] })
      .then((granted) => granted && setTimeout(refreshStatus, 900));
  });
}

// ------------------------------------------------------------- corrections

async function renderCorrections() {
  const stored = await api.storage.local.get({ [CORRECTIONS_KEY]: {} });
  const corrections = stored[CORRECTIONS_KEY];
  const keys = Object.keys(corrections).sort();
  $('#corrections').hidden = !keys.length;
  const list = $('#corr-list');
  list.replaceChildren();
  for (const key of keys) {
    const [hanzi, pinyin] = key.split('|');
    const li = document.createElement('li');
    const parts = [
      ['c-hz', hanzi],
      ['c-py', pinyin],
      ['c-jp', corrections[key]],
    ].map(([cls, value]) => {
      const span = document.createElement('span');
      span.className = cls;
      span.textContent = value;
      return span;
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = 'Use the dictionary reading again';
    remove.setAttribute('aria-label', `Remove correction for ${hanzi}`);
    remove.addEventListener('click', async () => {
      const next = { ...corrections };
      delete next[key];
      await api.storage.local.set({ [CORRECTIONS_KEY]: next });
    });
    li.append(...parts, remove);
    list.append(li);
  }
}

// ------------------------------------------------------------- voice and shortcuts

const HEAR_TIP = 'Click a reading on the page to hear the word: Cantonese for jyutping, Mandarin for pinyin.';
const NO_VOICE_TIP = 'No Cantonese voice found: add the Chinese (Hong Kong SAR) voice in Windows speech settings.';

function watchVoice() {
  const check = (final) => {
    const voices = speechSynthesis.getVoices();
    if (!voices.length && !final) return;
    voiceMissing = !findCantoneseVoice(voices);
    $('#hear-row').dataset.tip = voiceMissing ? `${HEAR_TIP} ${NO_VOICE_TIP}` : `${HEAR_TIP} It uses your browser's built-in voices.`;
    render();
  };
  $('#hear-row').dataset.tip = HEAR_TIP;
  check(false);
  speechSynthesis.addEventListener('voiceschanged', () => check(false));
  setTimeout(() => check(true), 1500);
}

// Shortcuts appear as tooltips on the two main switches.
async function showShortcuts() {
  const commands = await api.commands.getAll();
  const keyFor = (name) => commands.find((c) => c.name === name)?.shortcut;
  for (const [id, command] of [['#pinyin-toggle', 'toggle-pinyin'], ['#jyutping-toggle', 'toggle-jyutping']]) {
    const key = keyFor(command);
    if (key) $(id).title = key;
  }
}

// ------------------------------------------------------------- start

api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[CORRECTIONS_KEY]) renderCorrections();
  // Changes made elsewhere (Alt+J / Alt+P, another window). Our own saves echo
  // back here with the values already shown, so those are skipped.
  if (area === 'sync') {
    let changed = false;
    for (const key of ['showPinyin', 'showJyutping', 'offSites']) {
      if (!changes[key] || key in pending) continue;
      const value = changes[key].newValue ?? DEFAULTS[key];
      if (JSON.stringify(value) === JSON.stringify(settings[key])) continue;
      settings[key] = value;
      changed = true;
    }
    if (changed) render();
    if (changed && changes.offSites) refreshStatus();
  }
});

(async () => {
  settings = await api.storage.sync.get(DEFAULTS);
  bindControls();
  bindSiteRow();
  render();
  watchVoice();
  showShortcuts();
  renderCorrections();
  [tab] = await api.tabs.query({ active: true, currentWindow: true });
  refreshStatus();
})();
