import { describe, expect, it } from 'vitest';

import { buildLeaderBoardFooterResourceChipsBySeibanJoinKey } from '../collectLeaderBoardFooterResourceChips';

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

describe('buildLeaderBoardFooterResourceChipsBySeibanJoinKey', () => {
  it('indexes aggregated chips by seiban join key', () => {
    const items: ProductionScheduleProgressOverviewSeibanItem[] = [
      {
        fseiban: 'S1',
        seibanJoinKey: 'masked-S1',
        machineName: 'MC-1',
        dueDate: null,
        parts: [
          part('P1', [
            { rowId: 'csv-row-a', resourceCd: 'BB', resourceNames: ['B'], processOrder: 1, isCompleted: true },
            { rowId: 'csv-row-b', resourceCd: 'AA', resourceNames: ['A'], processOrder: 2, isCompleted: false }
          ]),
          part('P2', [
            {
              rowId: 'csv-row-c',
              resourceCd: 'BB',
              resourceNames: ['B'],
              processOrder: 1,
              isCompleted: false
            }
          ])
        ]
      }
    ];

    const index = buildLeaderBoardFooterResourceChipsBySeibanJoinKey(items);

    expect(index.get('masked-S1')).toEqual([
      { rowId: 'lb-footer-masked-S1-res-AA', resourceCd: 'AA', resourceNames: ['A'], isCompleted: false },
      { rowId: 'lb-footer-masked-S1-res-BB', resourceCd: 'BB', resourceNames: ['B'], isCompleted: false }
    ]);
  });

  it('skips blank join keys', () => {
    expect(
      buildLeaderBoardFooterResourceChipsBySeibanJoinKey([
        {
          fseiban: 'S1',
          seibanJoinKey: '   ',
          machineName: null,
          dueDate: null,
          parts: []
        }
      ]).size
    ).toBe(0);
  });

  it('returns empty map for no items', () => {
    expect(buildLeaderBoardFooterResourceChipsBySeibanJoinKey([]).size).toBe(0);
  });
});
