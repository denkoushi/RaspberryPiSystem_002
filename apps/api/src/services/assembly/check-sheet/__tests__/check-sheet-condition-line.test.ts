import { describe, expect, it } from 'vitest';
import { hasConditionWordsInLine, matchConditionHeader } from '../check-sheet-condition-line.js';

const oldHeader = (text: string) => {
  const m = text.match(/^(.*?場合[^\n]*?以下[^\n]*?確認[^\n]*?こと[。.]?)(?:\s*\n|\s*(?=[・･])|$)/);
  return m ? { label: m[1], length: m[0].length } : null;
};
const oldHasWords = (text: string) => /場合.*以下.*確認/.test(text);

const biased = ['場合', '以下', '確認', 'こと', '場合', '以下', '確認', 'こと', '。', '\n', ' ', '・', 'x'];
const parts = ['場合', '以下', '確認', 'こと', '。', '.', '・', '･', '\n', ' ', 'x'];
function randomTexts(count: number, pool = parts) {
  let seed = 20261125;
  const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  return Array.from({ length: count }, () => {
    const length = Math.floor(next() * 13);
    return Array.from({ length }, () => pool[Math.floor(next() * pool.length)]).join('');
  });
}

describe('check-sheet condition line helpers', () => {
  it('旧い正規表現と同じ結果を返す(短いランダム文字列)', () => {
    const texts = [...randomTexts(20000), ...randomTexts(20000, biased)];
    let matched = 0;
    for (const text of texts) {
      expect(matchConditionHeader(text), JSON.stringify(text)).toEqual(oldHeader(text));
      expect(hasConditionWordsInLine(text), JSON.stringify(text)).toBe(oldHasWords(text));
      if (oldHeader(text)) matched++;
    }
    expect(matched).toBeGreaterThan(100);
  });

  it('代表例', () => {
    expect(matchConditionHeader('X場合は以下を確認すること。\n・本文')).toEqual({ label: 'X場合は以下を確認すること。', length: 15 });
    expect(matchConditionHeader('場合以下確認こと ・本文')).toEqual({ label: '場合以下確認こと', length: 9 });
    expect(matchConditionHeader('場合以下確認ことx')).toBeNull();
  });

  it('長い入力でも 200 ms 以内に終わる', () => {
    for (const text of ['場合以下確認'.repeat(5000) + 'x', '場合' + '以下'.repeat(50000), '場合以下確認こと'.repeat(5000) + 'x']) {
      const start = performance.now();
      matchConditionHeader(text);
      hasConditionWordsInLine(text);
      expect(performance.now() - start).toBeLessThan(200);
    }
  });
});
