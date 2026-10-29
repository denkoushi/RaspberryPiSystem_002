import { describe, expect, it, vi } from 'vitest';

import { buildPartSearchIndex, nextKeyAvailability, searchPartIndex } from '../local-search.js';
import { foldPartSearchKana, normalizeMachineNameForPartSearch, normalizePartSearchQuery, PART_SEARCH_KANA_FOLD_DELETE, PART_SEARCH_KANA_FOLD_TRANSLATION, partSearchTermVariantsForIlike } from '../normalize.js';

import type { PartSearchQuery, PartSearchRow } from '../local-search.js';

const row = (id: string, fhinmei: string, overrides: Partial<PartSearchRow> = {}): PartSearchRow => ({
  id, fhinmei, shelfCodeRaw: 'A-1', fseiban: 'BE01', fhincd: 'P-01', machineName: 'DAD3350', productNo: '1', ...overrides
});
const rows = [
  row('table', 'テーブル脚'), row('valve', 'ばるぶ', { fseiban: 'BE02' }),
  row('pulp', 'パルプ', { machineName: 'ＤＦＤテーブル', fhincd: 'P-02' }),
  row('noshelf', 'テフル', { shelfCodeRaw: null, fseiban: 'AA01' }),
  row('substring', '丸テーブル', { fseiban: 'AA02' }), row('yoon', 'キャク', { fseiban: 'ZZ01' })
];
const index = buildPartSearchIndex(rows);
const query = (typed = '', field: PartSearchQuery['field'] = 'name'): PartSearchQuery => ({ field, typed, filters: [] });

describe('kana folding', () => {
  it.each(['テーブル', 'てーぶる', 'ﾃｰﾌﾞﾙ', 'テフル', 'てふる', 'テフ\u3099ル'])('folds %s to テフル', (text) => {
    expect(normalizePartSearchQuery(text)).toBe('テフル');
  });
  it('shares the exact translation and deletion data, for both scripts', () => {
    const { from, to } = PART_SEARCH_KANA_FOLD_TRANSLATION;
    expect([...from]).toHaveLength([...to].length);
    [...from].forEach((char, i) => expect(foldPartSearchKana(char)).toBe([...to][i]));
    [...PART_SEARCH_KANA_FOLD_DELETE].forEach((char) => expect(foldPartSearchKana(char)).toBe(''));
    expect(foldPartSearchKana('ゔヴぱパばバ')).toBe('うウはハはハ');
    expect(foldPartSearchKana('abc漢字')).toBe('abc漢字');
  });
  it('keeps half-width uppercase machine comparison and folds kana variants', () => {
    expect(normalizeMachineNameForPartSearch('ｄａｄヴー１２')).toBe('DADウ12');
    expect(partSearchTermVariantsForIlike('テーブル')).toEqual(['テフル', 'てふる']);
    expect(partSearchTermVariantsForIlike('ーｰ')).toEqual([]);
  });
});

describe('local search', () => {
  it('folds kana and ranks shelved prefix hits before substring and unshelved hits', () => {
    expect(searchPartIndex(index, query('てふる')).hits.map((r) => r.id)).toEqual(['table', 'substring', 'noshelf']);
    expect(searchPartIndex(index, query('はるふ')).hits.map((r) => r.id)).toEqual(['pulp', 'valve']);
    expect(searchPartIndex(index, query('ばるぶ')).total).toBe(2);
  });
  it('ANDs exact filters and tokens, ORs aliases, and searches across all fields', () => {
    expect(searchPartIndex(index, { ...query('あし てふる'), filters: [{ field: 'machine', value: 'DAD3350' }] }).hits.map((r) => r.id)).toEqual(['table']);
    expect(searchPartIndex(index, query('be01 あし', 'all')).total).toBe(1);
    expect(searchPartIndex(index, query('be01', 'name')).total).toBe(0);
    expect(searchPartIndex(index, query('dfdてふる', 'machine')).hits.map((r) => r.id)).toEqual(['pulp']);
    expect(searchPartIndex(index, { ...query(), filters: [{ field: 'seiban', value: 'BE01' }, { field: 'hinban', value: 'P-02' }] }).hits.map((r) => r.id)).toEqual(['pulp']);
    expect(searchPartIndex(index, { ...query(), filters: [{ field: 'seiban', value: 'BE0' }] }).total).toBe(0);
  });
  it('counts distinct facets among hits with stable count/value ordering', () => {
    expect(searchPartIndex(index, query('', 'machine')).facets).toEqual([
      { field: 'machine', value: 'DAD3350', count: 5 }, { field: 'machine', value: 'ＤＦＤテーブル', count: 1 }
    ]);
    const result = searchPartIndex(index, query('てふる', 'all'));
    expect(result.total).toBe(4);
    expect(result.facets).toContainEqual({ field: 'machine', value: 'ＤＦＤテーブル', count: 1 });
    expect(result.facets.filter((facet) => facet.field === 'name')).toHaveLength(3);
    expect(searchPartIndex(index, query('', 'all')).facets[0].field).toBe('machine');
    expect(searchPartIndex(index, { ...query('', 'all'), filters: [{ field: 'machine', value: 'DAD3350' }] }).facets[0].field).toBe('seiban');
    const tied = buildPartSearchIndex([row('b', 'B'), row('a', 'A'), row('c', 'B')]);
    expect(searchPartIndex(tied, query()).facets.map((f) => [f.value, f.count])).toEqual([['B', 2], ['A', 1]]);
    expect(searchPartIndex(buildPartSearchIndex([row('b', 'B'), row('a', 'A')]), query()).facets.map((f) => f.value)).toEqual(['A', 'B']);
  });
  it('does not normalize rows again while searching or checking keys', () => {
    const normalize = vi.spyOn(String.prototype, 'normalize');
    searchPartIndex(index, query('て'));
    nextKeyAvailability(index, query('て'), ['ふ', 'る']);
    expect(normalize.mock.instances).not.toContain('テーブル脚');
    normalize.mockRestore();
  });
  it('handles empty data and sorts ties by seiban, hinban, then id without mutating rows', () => {
    expect(searchPartIndex([], query())).toEqual({ hits: [], facets: [], total: 0 });
    const tied = [row('z', 'A'), row('a', 'A'), row('p', 'A', { fhincd: 'P-00' })];
    expect(searchPartIndex(buildPartSearchIndex(tied), query()).hits.map((r) => r.id)).toEqual(['p', 'a', 'z']);
    expect(tied.map((r) => r.id)).toEqual(['z', 'a', 'p']);
  });
});

describe('nextKeyAvailability', () => {
  const keys = [...'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-', 'ゃ', 'ー', 'ｰ', ' ', '脚', 'あし', 'ふる'];
  it('equals brute-force search, including aliases, yoon, tokens, filters and ignored marks', () => {
    for (const field of ['all', 'seiban', 'hinban', 'machine', 'name'] as const) {
      for (const typed of ['', 'て', 'てふ', 'あ', 'き', 'BE', 'P-', 'てふる ', 'てふる あ', 'あし あ', 'zzzz']) {
        for (const filters of [[], [{ field: 'machine' as const, value: 'DAD3350' }], [{ field: 'seiban' as const, value: 'missing' }]]) {
          const q = { field, typed, filters };
          const expected = keys.filter((key) => searchPartIndex(index, { ...q, typed: typed + key }).total > 0);
          expect([...nextKeyAvailability(index, q, keys)].sort(), JSON.stringify(q)).toEqual(expected.sort());
        }
      }
    }
  });
  it('finds new alias hits outside current hits and deduplicates candidate keys', () => {
    const aliasIndex = buildPartSearchIndex([row('leg', '脚')]);
    expect(searchPartIndex(aliasIndex, query('あ')).total).toBe(0);
    expect(nextKeyAvailability(aliasIndex, query('あ'), ['し', 'し', 'か'])).toEqual(new Set(['し']));
    expect(nextKeyAvailability([], query(), keys)).toEqual(new Set());
  });
});
