import { describe, expect, it } from 'vitest';

import { buildLeaderBoardFooterResourceChipsBySeiban } from '../collectLeaderBoardFooterResourceChips';

import type { ProductionScheduleProgressOverviewPartItem, ProductionScheduleProgressOverviewSeibanItem } from '../../../../api/client';

function part(
  productNo: string,
  processes: ProductionScheduleProgressOverviewPartItem['processes']
): ProductionScheduleProgressOverviewPartItem {
  return {
    productNo,
    fhincd: `${productNo}-H`,
    fhinmei: `${productNo}-NAME`,
    dueDate: null,
    processes
  };
}

describe('buildLeaderBoardFooterResourceChipsBySeiban', () => {
  it('builds aggregated chip map per seiban', () => {
    const items: ProductionScheduleProgressOverviewSeibanItem[] = [
      {
        fseiban: 'S1',
        machineName: 'MC-1',
        dueDate: null,
        parts: [
          part('P1', [
            { rowId: 'a1', resourceCd: 'BB', resourceNames: ['B'], processOrder: 1, isCompleted: true },
            { rowId: 'a2', resourceCd: 'AA', resourceNames: ['A'], processOrder: 2, isCompleted: false }
          ]),
          part('P2', [{ rowId: 'a3', resourceCd: 'BB', resourceNames: ['B'], processOrder: 1, isCompleted: false }])
        ]
      }
    ];
    const index = buildLeaderBoardFooterResourceChipsBySeiban(items);
    expect(index.get('S1')).toEqual([
      { rowId: 'overview-S1-res-AA', resourceCd: 'AA', resourceNames: ['A'], isCompleted: false },
      { rowId: 'overview-S1-res-BB', resourceCd: 'BB', resourceNames: ['B'], isCompleted: false }
    ]);
  });

  it('skips blank seiban keys', () => {
    const index = buildLeaderBoardFooterResourceChipsBySeiban([
      {
        fseiban: '   ',
        machineName: null,
        dueDate: null,
        parts: [part('P1', [{ rowId: 'x', resourceCd: 'AA', processOrder: 1, isCompleted: true }])]
      }
    ]);
    expect(index.size).toBe(0);
  });

  it('returns empty map for no items', () => {
    expect(buildLeaderBoardFooterResourceChipsBySeiban([]).size).toBe(0);
  });
});
