import { describe, expect, it } from 'vitest';

import {
  PART_SEARCH_KANA_FOLD_DELETE,
  PART_SEARCH_KANA_FOLD_TRANSLATION,
  normalizePartSearchQuery
} from '../normalize.js';

/**
 * 高速化前の normalizePartSearchQuery をそのまま複製した参照実装。
 * 現行実装の出力がこれとバイト単位で一致することを確かめる（DB REPLACE/translate と対のため）。
 */
const REF_SMALL_KANA_MAP: ReadonlyMap<string, string> = new Map([
  ['ぁ', 'あ'],
  ['ぃ', 'い'],
  ['ぅ', 'う'],
  ['ぇ', 'え'],
  ['ぉ', 'お'],
  ['ゃ', 'や'],
  ['ゅ', 'ゆ'],
  ['ょ', 'よ'],
  ['ゎ', 'わ'],
  ['ゕ', 'か'],
  ['ゖ', 'け']
]);

const REF_YOON: Record<string, string> = {
  きゃ: 'キャ',
  きゅ: 'キュ',
  きょ: 'キョ',
  ぎゃ: 'ギャ',
  ぎゅ: 'ギュ',
  ぎょ: 'ギョ',
  しゃ: 'シャ',
  しゅ: 'シュ',
  しょ: 'ショ',
  じゃ: 'ジャ',
  じゅ: 'ジュ',
  じょ: 'ジョ',
  ちゃ: 'チャ',
  ちゅ: 'チュ',
  ちょ: 'チョ',
  にゃ: 'ニャ',
  にゅ: 'ニュ',
  にょ: 'ニョ',
  ひゃ: 'ヒャ',
  ひゅ: 'ヒュ',
  ひょ: 'ヒョ',
  びゃ: 'ビャ',
  びゅ: 'ビュ',
  びょ: 'ビョ',
  ぴゃ: 'ピャ',
  ぴゅ: 'ピュ',
  ぴょ: 'ピョ',
  みゃ: 'ミャ',
  みゅ: 'ミュ',
  みょ: 'ミョ',
  りゃ: 'リャ',
  りゅ: 'リュ',
  りょ: 'リョ',
  ぢゃ: 'ヂャ',
  ぢゅ: 'ヂュ',
  ぢょ: 'ヂョ'
};

const REF_FOLD_MAP = new Map(
  [...PART_SEARCH_KANA_FOLD_TRANSLATION.from].map((ch, i) => [ch, [...PART_SEARCH_KANA_FOLD_TRANSLATION.to][i]])
);

function referenceNormalize(input: string): string {
  let s = input.normalize('NFKC').trim();
  const entries = Object.entries(REF_YOON).sort((a, b) => b[0].length - a[0].length);
  for (const [k, rep] of entries) {
    s = s.split(k).join(rep);
  }
  s = [...s].map((ch) => REF_SMALL_KANA_MAP.get(ch) ?? ch).join('');
  s = [...s]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      return code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : ch;
    })
    .join('');
  s = s.replace(/っ/g, 'ツ').replace(/ッ/g, 'ツ');
  return [...s]
    .map((ch) => (PART_SEARCH_KANA_FOLD_DELETE.includes(ch) ? '' : (REF_FOLD_MAP.get(ch) ?? ch)))
    .join('');
}

function range(from: number, to: number): string[] {
  const out: string[] = [];
  for (let c = from; c <= to; c++) out.push(String.fromCodePoint(c));
  return out;
}

const HIRAGANA = range(0x3041, 0x309f); // ゟ (U+309F) は NFKC で「より」になる
const KATAKANA = range(0x30a0, 0x30ff);
const HALF_WIDTH = range(0xff61, 0xff9f);
const ASCII = range(0x20, 0x7e);
const FULL_WIDTH_ASCII = range(0xff01, 0xff5e);
const MISC = [
  '　',
  '\t',
  '\n',
  '゙',
  '゚',
  '゛',
  '゜',
  'ー',
  'ｰ',
  '部',
  '品',
  '棚',
  '㋐', // NFKC → ア
  '🈀', // NFKC → ほか（ひらがなを生む互換文字）
  '㍿',
  '①',
  '😀',
  '\ud800' // 孤立サロゲート
];
const ALPHABET = [...HIRAGANA, ...KATAKANA, ...HALF_WIDTH, ...ASCII, ...FULL_WIDTH_ASCII, ...MISC];
const CORE = ['き', 'ゃ', 'っ', 'ッ', 'ァ', 'ゕ', 'か', 'ガ', 'ｶ', 'ﾞ', 'A', 'ａ', ' ', '　', 'ー', '゙', '🈀', 'ゟ'];

function* corpus(): Generator<string> {
  yield '';
  for (const k of Object.keys(REF_YOON)) {
    yield k;
    yield `${k}っぷ ${k.toUpperCase()}`;
  }
  for (const a of ALPHABET) yield a;
  for (const a of CORE) for (const b of CORE) for (const c of CORE) yield a + b + c;
  let seed = 0x2f6e2b1;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 0x100000000;
  };
  const pools = [HIRAGANA, KATAKANA, HALF_WIDTH, ASCII, FULL_WIDTH_ASCII, MISC, CORE, ALPHABET];
  for (let i = 0; i < 30000; i++) {
    const len = Math.floor(rand() * 14);
    const pool = pools[i % pools.length];
    let s = '';
    for (let j = 0; j < len; j++) s += pool[Math.floor(rand() * pool.length)];
    yield s;
  }
}

describe('normalizePartSearchQuery equivalence with pre-optimization implementation', () => {
  it('produces byte-identical output over a broad generated corpus', () => {
    let count = 0;
    const mismatches: string[] = [];
    for (const input of corpus()) {
      count++;
      if (normalizePartSearchQuery(input) !== referenceNormalize(input) && mismatches.length < 10) {
        mismatches.push(JSON.stringify(input));
      }
    }
    expect(mismatches).toEqual([]);
    expect(count).toBeGreaterThan(30000);
  });
});
