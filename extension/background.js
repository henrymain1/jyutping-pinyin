// Background script (a service worker in Chrome, an event page in Firefox): serves
// the dictionary to content scripts, handles the Alt+J / Alt+P shortcuts, and starts
// the content scripts in tabs that were already open when they became allowed.

const api = globalThis.browser ?? globalThis.chrome;
const CONTENT_FILES = ['src/settings.js', 'src/pinyin.js', 'src/jyutping.js', 'src/dict.js', 'src/content.js'];
const COMMAND_SETTINGS = { 'toggle-jyutping': 'showJyutping', 'toggle-pinyin': 'showPinyin' };
const WEB_PAGES = ['http://*/*', 'https://*/*'];

let dataText = null;

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const reply = (promise) => {
    promise.then(sendResponse, (err) => sendResponse({ error: String(err) }));
    return true; // keeps sendResponse alive for the async reply
  };
  if (msg?.type === 'jp:data') return reply(loadData().then((text) => ({ text })));
  // Just the syllable lists (a few KB), so a page can check for real pinyin or
  // jyutping before asking for the whole dictionary.
  if (msg?.type === 'jp:syllables') return reply(loadData().then(syllableLists));
  return false;
});

function syllableLists(text) {
  const line = (kind) => text.match(new RegExp(`^${kind}\\t(.*)$`, 'm'))?.[1].split(' ') ?? [];
  return { pinyin: line('S'), jyutping: line('J') };
}

async function loadData() {
  if (!dataText) {
    const res = await fetch(api.runtime.getURL('data/canto.txt'));
    dataText = await res.text();
  }
  return dataText;
}

api.commands.onCommand.addListener(async (command) => {
  const key = COMMAND_SETTINGS[command];
  if (!key) return;
  const current = await api.storage.sync.get({ [key]: true });
  await api.storage.sync.set({ [key]: !current[key] });
});

// The content scripts guard against running twice, and stay asleep on pages
// without Chinese, so injecting into every open tab is cheap.
async function startInOpenTabs(patterns) {
  const tabs = await api.tabs.query({ url: patterns }).catch(() => []);
  for (const tab of tabs) {
    api.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES }).catch(() => {});
  }
}

api.runtime.onInstalled.addListener(async () => {
  // Versions before 1.4 registered a script for each site switched on by hand.
  await api.scripting.unregisterContentScripts({ ids: ['jyutping-user-sites'] }).catch(() => {});
  await api.storage.sync.remove('sites').catch(() => {});
  startInOpenTabs(WEB_PAGES);
});

// Firefox lets people grant (or withhold) site access one site at a time; the
// popup's Allow button asks for it, and this starts the script once granted.
api.permissions.onAdded.addListener(({ origins = [] }) => {
  if (origins.length) startInOpenTabs(origins);
});
