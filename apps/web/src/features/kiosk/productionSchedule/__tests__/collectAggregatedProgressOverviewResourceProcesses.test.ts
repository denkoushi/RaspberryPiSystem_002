import { describe, expect, it } from 'vitest';

import { collectAggregatedProgressOverviewResourceProcesses } from '../collectAggregatedProgressOverviewResourceProcesses';

import type { ProductionScheduleProgressOverviewPartItem } from '../../../../api/client';

function part(
  productNo: string,
  processes: ProductionScheduleProgressOverviewPartItem['processes']
): ProductionScheduleProgressOverviewPartItem {
  return {
    productNo,
    fhincd: 'H',
    fhinmei: '品名',
    dueDate: null,
    processes
  };
}

describe('collectAggregatedProgressOverviewResourceProcesses', () => {
  it('returns empty when no processes', () => {
    expect(collectAggregatedProgressOverviewResourceProcesses('S1', [])).toEqual([]);
    expect(
      collectAggregatedProgressOverviewResourceProcesses('S1', [
        part('P1', []),
        part('P2', [])
      ])
    ).toEqual([]);
  });

  it('dedupes by resourceCd ascending and assigns stable rowId', () => {
    const chips = collectAggregatedProgressOverviewResourceProcesses('SEQ-001', [
      part('P1', [
        { rowId: 'r1', resourceCd: '587', resourceNames: [], processOrder: 1, isCompleted: false },
        { rowId: 'r2', resourceCd: '021', resourceNames: [], processOrder: 2, isCompleted: true }
      ])
    ]);
    expect(chips.map((c) => c.resourceCd)).toEqual(['021', '587']);
    expect(chips[0]?.rowId).toBe('overview-SEQ-001-res-021');
    expect(chips[1]?.rowId).toBe('overview-SEQ-001-res-587');
  });

  it('completed is AND across rows for same cd', () => {
    const chips = collectAggregatedProgressOverviewResourceProcesses('S', [
      part('P1', [
        { rowId: 'a', resourceCd: '586', resourceNames: undefined, processOrder: 1, isCompleted: true }
      ]),
      part('P2', [
        { rowId: 'b', resourceCd: '586', resourceNames: undefined, processOrder: 1, isCompleted: false }
      ])
    ]);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.isCompleted).toBe(false);
  });

  it('completed true when all processes for cd are completed', () => {
    const chips = collectAggregatedProgressOverviewResourceProcesses('S', [
      part('P1', [
        { rowId: 'a', resourceCd: '586', resourceNames: [], processOrder: 1, isCompleted: true }
      ]),
      part('P2', [
        { rowId: 'b', resourceCd: '586', resourceNames: [], processOrder: 1, isCompleted: true }
      ])
    ]);
    expect(chips[0]?.isCompleted).toBe(true);
  });

  it('skips blank resourceCd and merges names uniquely in order', () => {
    const chips = collectAggregatedProgressOverviewResourceProcesses('', [
      part('P1', [
        {
          rowId: 'x',
          resourceCd: '  A  ',
          resourceNames: ['n1'],
          processOrder: 1,
          isCompleted: false
        },
        { rowId: 'y', resourceCd: '', processOrder: 2, isCompleted: true },
        {
          rowId: 'z',
          resourceCd: 'A',
          resourceNames: [' n1 ', 'n2'],
          processOrder: 3,
          isCompleted: false
        }
      ])
    ]);
    expect(chips).toHaveLength(1);
    expect(chips[0]?.resourceCd).toBe('A');
    expect(chips[0]?.resourceNames).toEqual(['n1', 'n2']);
    expect(chips[0]?.rowId).toBe('overview-res-A');
  });
});
