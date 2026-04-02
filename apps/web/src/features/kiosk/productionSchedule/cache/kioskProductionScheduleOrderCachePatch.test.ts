import { describe, expect, it } from 'vitest';

import {
  findProcessingOrderForRow,
  patchOrderUsageForProcessingOrderChange,
  patchScheduleListProcessingOrder
} from './kioskProductionScheduleOrderCachePatch';

import type { KioskProductionScheduleListCache } from './kioskProductionScheduleListCache';

function sampleList(): KioskProductionScheduleListCache {
  return {
    page: 1,
    pageSize: 100,
    total: 2,
    rows: [
      {
        id: 'a',
        occurredAt: '',
        rowData: {},
        processingOrder: 3
      },
      {
        id: 'b',
        occurredAt: '',
        rowData: {},
        processingOrder: null
      }
    ]
  };
}

describe('patchScheduleListProcessingOrder', () => {
  it('対象行の processingOrder を更新する', () => {
    const base = sampleList();
    const next = patchScheduleListProcessingOrder(base, 'a', 5);
    expect(next.rows[0].processingOrder).toBe(5);
    expect(next.rows[1].processingOrder).toBeNull();
    expect(base.rows[0].processingOrder).toBe(3);
  });

  it('null で手動順を解除する', () => {
    const base = sampleList();
    const next = patchScheduleListProcessingOrder(base, 'a', null);
    expect(next.rows[0].processingOrder).toBeNull();
  });
});

describe('patchOrderUsageForProcessingOrderChange', () => {
  it('previous を外し next を入れる', () => {
    const usage = { R1: [1, 3, 7] };
    const next = patchOrderUsageForProcessingOrderChange(usage, 'R1', 3, 5);
    expect(next.R1).toEqual([1, 5, 7]);
    expect(usage.R1).toEqual([1, 3, 7]);
  });

  it('キーが無い資源は新規配列を作る', () => {
    const usage: Record<string, number[]> = {};
    const next = patchOrderUsageForProcessingOrderChange(usage, 'R2', null, 2);
    expect(next.R2).toEqual([2]);
  });

  it('previous と next が同じでも集合は一貫する', () => {
    const usage = { R1: [2] };
    const next = patchOrderUsageForProcessingOrderChange(usage, 'R1', 2, 2);
    expect(next.R1).toEqual([2]);
  });

  it('空の resourceCd は usage をコピーのみ', () => {
    const usage = { R1: [1] };
    const next = patchOrderUsageForProcessingOrderChange(usage, '   ', 1, 2);
    expect(next).toEqual(usage);
    expect(next).not.toBe(usage);
  });

  it('解除時は next が null で番号のみ削除', () => {
    const usage = { R1: [1, 2] };
    const next = patchOrderUsageForProcessingOrderChange(usage, 'R1', 2, null);
    expect(next.R1).toEqual([1]);
  });
});

describe('findProcessingOrderForRow', () => {
  it('行が無ければ null', () => {
    expect(findProcessingOrderForRow(sampleList().rows, 'z')).toBeNull();
  });

  it('processingOrder を返す', () => {
    expect(findProcessingOrderForRow(sampleList().rows, 'a')).toBe(3);
  });
});
