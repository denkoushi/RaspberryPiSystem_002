import { describe, expect, it } from 'vitest';

import { normalizeToolValue, suggestVariantGroups } from '../tool-value-variants.js';

const values = (...strings: string[]) => strings.map(value => ({ value, count: 1 }));
describe('tool value variants', () => {
  it('normalizes NFKC, surrounding/repeated whitespace and Latin case', () => {
    expect(normalizeToolValue('  ｏｓｇ　 a\tB  ')).toBe('OSG A B');
    expect(normalizeToolValue('ｴﾝﾄﾞﾐﾙ')).toBe('エンドミル');
  });
  it('flags normalization-only groups as automatic', () => {
    expect(suggestVariantGroups('maker', values('OSG', 'ｏｓｇ', 'osg '), [])).toEqual([
      { field: 'maker', to: 'OSG', from: [{ value: 'osg ', count: 1 }, { value: 'ｏｓｇ', count: 1 }], auto: true },
    ]);
  });
  it.each([
    ['OSG', 'オーエスジー'], ['NACHI', 'ナチ', '不二越'], ['YAMAWA', 'ヤマワ'],
    ['三菱マテリアル', '三菱', 'MITSUBISHI', '三菱日立ツール'], ['MOLDINO', '日立', '日立ツール'],
    ['IWATA', 'イワタ'], ['SUMITOMO', '住友', '住友電工'], ['KYOCERA', '京セラ'],
    ['TUNGALOY', 'タンガロイ'], ['DIJET', 'ダイジェット'], ['YG-1', 'ＹＧ-１'],
    ['SANDVIK', 'サンドビック'], ['Walter', 'ワルター'], ['Kennametal', 'ケナメタル'],
  ])('recognizes maker dictionary: %s', (...spellings) => {
    const [group] = suggestVariantGroups('maker', values(...spellings), []);
    expect(group.to).toBe(spellings[0]);
    expect(group.from).toHaveLength(spellings.length - 1);
  });
  it.each([['リーマ', 'リーマー'], ['面取カッター', '面取りカッター'], ['ABCDE', 'ABCDF'], ['ABCDE', 'ABXCDE'], ['ABCDE', 'ABCED']])('handles candidate %s / %s', (a, b) => {
    expect(suggestVariantGroups('toolName', values(a, b), [])).toHaveLength(b === 'ABCED' ? 0 : 1);
  });
  it('does not fuzzy-match short strings or unrelated maker names', () => {
    expect(suggestVariantGroups('toolName', values('ABCD', 'ABCE'), [])).toEqual([]);
    expect(suggestVariantGroups('maker', values('ABCDE', 'ABCDF'), [])).toEqual([]);
  });
  it('chooses highest count, then dictionary spelling or longer string', () => {
    expect(suggestVariantGroups('maker', [{ value: 'OSG', count: 1 }, { value: 'オーエスジー', count: 2 }], [])[0].to).toBe('オーエスジー');
    expect(suggestVariantGroups('toolName', values('リーマ', 'リーマー'), [])[0].to).toBe('リーマー');
  });
  it('respects sorted or reversed dismissals without transitive rejoining', () => {
    const groups = suggestVariantGroups('maker', values('NACHI', 'ナチ', '不二越'), [{ field: 'maker', valueA: 'ナチ', valueB: 'NACHI' }]);
    expect(groups.every(g => ![g.to, ...g.from.map(v => v.value)].includes('ナチ') || ![g.to, ...g.from.map(v => v.value)].includes('NACHI'))).toBe(true);
    expect(suggestVariantGroups('toolName', values('リーマ', 'リーマー'), [{ field: 'toolName', valueA: 'リーマ', valueB: 'リーマー' }])).toEqual([]);
  });
});
