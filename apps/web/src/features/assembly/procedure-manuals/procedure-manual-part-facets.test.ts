import { describe, expect, it } from 'vitest';

import { extractProcedureManualPartFacets } from './procedure-manual-part-facets';

describe('extractProcedureManualPartFacets', () => {
  it('normalizes axes, groups names by existing prefixes, and sorts by count then Japanese name', () => {
    const result = extractProcedureManualPartFacets(['X軸テーブル', 'Yテーブル', 'テーブル上面', 'Ｘ軸サドル', 'サドル下面', '主軸頭', 'ベッド', 'X軸']);
    expect(result.facets).toEqual([
      { axis: 'X', name: 'テーブル' }, { axis: 'Y', name: 'テーブル' }, { axis: '', name: 'テーブル' },
      { axis: 'X', name: 'サドル' }, { axis: '', name: 'サドル' }, { axis: '', name: '主軸頭' },
      { axis: '', name: 'ベッド' }, { axis: '', name: 'X軸' }
    ]);
    expect(result.axes).toEqual(['X', 'Y']);
    expect(result.names).toEqual(['テーブル', 'サドル', ...['主軸頭', 'ベッド', 'X軸'].sort((a, b) => a.localeCompare(b, 'ja'))]);
  });

  it('uses the longest strict prefix without recursively shortening it', () => {
    expect(extractProcedureManualPartFacets([' テーブル ', 'テーブル上', 'テーブル上面']).facets).toEqual([
      { axis: '', name: 'テーブル' }, { axis: '', name: 'テーブル' }, { axis: '', name: 'テーブル上' }
    ]);
  });

  it('omits empty buttons and retains names without an axis or prefix', () => {
    expect(extractProcedureManualPartFacets(['', '  '])).toEqual({ facets: [{ axis: '', name: '' }, { axis: '', name: '' }], axes: [], names: [] });
    expect(extractProcedureManualPartFacets(['Z軸コラム', 'Aベッド', 'サドル下面']).axes).toEqual(['A', 'Z']);
    expect(extractProcedureManualPartFacets(['サドル下面']).names).toEqual(['サドル下面']);
  });

  it('does not treat part-number-like names as an axis', () => {
    expect(extractProcedureManualPartFacets(['ABC部品', 'X1ブラケット', 'X軸2号ガイド']).facets).toEqual([
      { axis: '', name: 'ABC部品' }, { axis: '', name: 'X1ブラケット' }, { axis: 'X', name: '2号ガイド' }
    ]);
  });
});
