import { describe, expect, it } from 'vitest';

import { deriveDisplayRows, type NormalizedScheduleRow } from './displayRowDerivation';

const row = (params: {
  id: string;
  resourceCd: string;
  fseiban: string;
  productNo: string;
  fkojun: string;
  processingOrder: number | null;
  globalRank: number | null;
}): NormalizedScheduleRow => ({
  id: params.id,
  isCompleted: false,
  data: {
    FSIGENCD: params.resourceCd,
    FSEIBAN: params.fseiban,
    ProductNo: params.productNo,
    FKOJUN: params.fkojun
  },
  values: {
    FSIGENCD: params.resourceCd,
    FSEIBAN: params.fseiban,
    ProductNo: params.productNo,
    FKOJUN: params.fkojun,
    FHINCD: '',
    FHINMEI: '',
    globalRank: params.globalRank === null ? '' : String(params.globalRank),
    processingOrder: params.processingOrder === null ? '' : String(params.processingOrder),
    processingType: '',
    actualPerPieceMinutes: '',
    FSIGENSHOYORYO: ''
  },
  processingOrder: params.processingOrder,
  globalRank: params.globalRank,
  actualPerPieceMinutes: null,
  processingType: null,
  note: null,
  dueDate: null
});

describe('deriveDisplayRows sort mode', () => {
  it('manualモードかつ有効時はprocessingOrder順で並ぶ', () => {
    const input = [
      row({ id: 'row-2', resourceCd: '502', fseiban: 'B', productNo: '20', fkojun: '20', processingOrder: 2, globalRank: 1 }),
      row({ id: 'row-1', resourceCd: '502', fseiban: 'A', productNo: '10', fkojun: '10', processingOrder: 1, globalRank: 3 }),
      row({ id: 'row-x', resourceCd: '502', fseiban: 'C', productNo: '30', fkojun: '30', processingOrder: null, globalRank: 2 })
    ];

    const result = deriveDisplayRows(input, {
      isDisplayRankContext: true,
      sortMode: 'manual',
      manualSortEnabled: true
    });

    expect(result.map((item) => item.id)).toEqual(['row-1', 'row-2', 'row-x']);
  });

  it('manualモードでも無効時はautoロジックにフォールバックする', () => {
    const input = [
      row({ id: 'row-3', resourceCd: '502', fseiban: 'C', productNo: '30', fkojun: '30', processingOrder: 1, globalRank: 3 }),
      row({ id: 'row-1', resourceCd: '503', fseiban: 'A', productNo: '10', fkojun: '10', processingOrder: 3, globalRank: 1 }),
      row({ id: 'row-2', resourceCd: '503', fseiban: 'B', productNo: '20', fkojun: '20', processingOrder: 2, globalRank: 2 })
    ];

    const result = deriveDisplayRows(input, {
      isDisplayRankContext: true,
      sortMode: 'manual',
      manualSortEnabled: false
    });

    expect(result.map((item) => item.id)).toEqual(['row-1', 'row-2', 'row-3']);
  });
});
