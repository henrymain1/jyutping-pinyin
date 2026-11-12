// Checks which Cantonese word tags extension/src/colloquial.js gives for sample words.
//
// Usage: node tools/test_colloquial.js
//
// Each case is Mandarin, numbered pinyin, and the expected tags: a listed word shows as
// its Cantonese word ("睇"), a part of a word or phrase as "part→word" ("不→唔"), and no
// tag as an empty list. Exits with status 1 if any case differs.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
vm.runInThisContext(read('extension/src/colloquial.js'));
const colloquial = new globalThis.JyutpingExt.Colloquial(
  read('extension/data/colloquial.tsv'),
  read('extension/data/colloquial-keep.txt'),
);

const CASES = [
  // Listed words
  ['看', 'kan4', ['睇']],
  ['多少', 'duo1 shao3', ['幾多']],
  ['多少', 'duo1 shao5', ['幾多']],
  // Readings that mean something else
  ['看', 'kan1', []],
  ['了', 'liao3', []],
  ['東西', 'dong1 xi1', []],
  ['還', 'huan2', []],
  // Words built from listed parts
  ['不想', 'bu4 xiang3', ['不→唔']],
  ['吃完', 'chi1 wan2', ['吃→食']],
  ['看書', 'kan4 shu1', ['看→睇']],
  ['我的', 'wo3 de5', ['的→嘅']],
  ['去了', 'qu4 le5', ['了→咗']],
  ['喝水', 'he1 shui3', ['喝→飲']],
  ['不可以', 'bu4 ke3 yi3', ['不→唔']],
  // Phrases under one pinyin string
  ['我看書', 'wo3 kan4 shu1', ['看→睇']],
  ['他是我的朋友', 'ta1 shi4 wo3 de5 peng2 you5', ['他→佢', '是→係', '的→嘅']],
  ['你在哪裡', 'ni3 zai4 na3 li3', ['哪裡→邊度']],
  ['他不看也不吃了', 'ta1 bu4 kan4 ye3 bu4 chi1 le5', ['他→佢', '不→唔', '看→睇', '也→都']],
  // Parts whose reading means something else
  ['目的', 'mu4 di4', []],
  ['的確', 'di2 que4', []],
  ['看守', 'kan1 shou3', []],
  // Kept whole: idioms, words Cantonese says the same, compounds of listed words
  ['愛不釋手', 'ai4 bu4 shi4 shou3', []],
  ['一言不發', 'yi1 yan2 bu4 fa1', []],
  ['不過', 'bu4 guo4', []],
  ['不斷', 'bu4 duan4', []],
  ['下午茶', 'xia4 wu3 cha2', []],
  ['他一言不發', 'ta1 yi1 yan2 bu4 fa1', ['他→佢']],
  ['不過我很忙', 'bu4 guo4 wo3 hen3 mang2', ['很→好']],
];

let failed = 0;
for (const [hanzi, pinyin, expected] of CASES) {
  const words = colloquial.lookup(hanzi, pinyin.split(' ')) || [];
  const got = words.map((w) => (w.from ? `${w.from}→${w.hanzi}` : w.hanzi));
  // A listed word may have several Cantonese words; the first is the one that must match.
  const ok = expected.length === 0 ? got.length === 0 : expected.every((e, i) => got[i] === e) && (expected[0].includes('→') ? got.length === expected.length : true);
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${hanzi} ${pinyin}: ${got.join(', ') || '(no tag)'}${ok ? '' : `   expected ${expected.join(', ') || '(no tag)'}`}`);
}
console.log(`${CASES.length - failed} of ${CASES.length} cases as expected`);
process.exit(failed ? 1 : 0);
