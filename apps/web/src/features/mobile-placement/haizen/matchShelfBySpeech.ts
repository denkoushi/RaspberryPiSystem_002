import { normalizeMachineName } from '../../kiosk/productionSchedule/machineName';

import type { RegisteredShelfEntryDto } from '../registeredShelves';

const readings: Record<string, string> = {
  エー: 'A', エイ: 'A', ビー: 'B', シー: 'C', ディー: 'D', イー: 'E', エフ: 'F', ジー: 'G',
  エイチ: 'H', エッチ: 'H', アイ: 'I', ジェー: 'J', ジェイ: 'J', ケー: 'K', ケイ: 'K',
  エル: 'L', エム: 'M', エヌ: 'N', オー: 'O', ピー: 'P', キュー: 'Q', アール: 'R',
  エス: 'S', ティー: 'T', ユー: 'U', ブイ: 'V', ヴィー: 'V', ダブリュー: 'W', ダブリュ: 'W',
  エックス: 'X', ワイ: 'Y', ゼット: 'Z', ズィー: 'Z', キタ: '北', ミナミ: '南', ヒガシ: '東', ニシ: '西'
};
const readingPattern = new RegExp(Object.keys(readings).sort((a, b) => b.length - a.length).join('|'), 'g');
const directions = new Set(['北', '南', '東', '西']);
const normalize = (text: string) => text.normalize('NFKC').toUpperCase().replace(/[\s_-]/g, '')
  .replace(/[ぁ-ゖ]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
  .replace(readingPattern, (reading) => readings[reading]);

/** Tries native recognition alternatives in order, returning the first matching shelves. */
export function matchShelfBySpeech(texts: string[], shelves: RegisteredShelfEntryDto[], previousShelfCodes: string[]): {
  text: string; shelves: RegisteredShelfEntryDto[];
} | null {
  // Fields stay separate so a word cannot straddle two of them; a spoken direction only matches the direction field.
  const searchable = shelves.map((shelf) => ({ shelf, direction: normalize(shelf.direction ?? ''), text: [
    normalizeMachineName(shelf.machineName), shelf.direction, shelf.displayLabel, shelf.shelfCodeRaw
  ].filter(Boolean).map((field) => normalize(String(field))).join('\n') }));
  const hit = (entry: (typeof searchable)[number], word: string) => directions.has(word) && entry.direction ? entry.direction === word : entry.text.includes(word);
  for (const text of texts) {
    const normalized = normalize(text);
    const words = text.normalize('NFKC').trim().split(/\s+/).map(normalize).flatMap((word) => word.split(/([北南東西])/)).filter(Boolean);
    const matches = normalized === '前回' || normalized === 'ゼンカイ'
      ? shelves.filter((shelf) => shelf.shelfCodeRaw === previousShelfCodes[0]).slice(0, 1)
      : words.length ? searchable.filter((entry) => words.every((word) => hit(entry, word))).map((entry) => entry.shelf) : [];
    if (matches.length) return { text: text.trim(), shelves: matches };
  }
  return null;
}
