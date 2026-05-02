import { describe, expect, it } from 'vitest';

import { buildLeaderBoardPartResourceProcessKey } from '../buildLeaderBoardPartResourceProcessKey';
import { buildLeaderBoardFooterResourceChipsByPartKey } from '../collectLeaderBoardFooterResourceChips';

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

describe('buildLeaderBoardFooterResourceChipsByPartKey', () => {
  it('indexes part processes by leaderboard row part key', () => {
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

    const index = buildLeaderBoardFooterResourceChipsByPartKey(items);

    expect(
      index.get(
        buildLeaderBoardPartResourceProcessKey({
          seibanJoinKey: 'masked-S1',
          productNo: 'P1',
          fhincd: 'P1-H'
        })
      )
    ).toEqual([
      { rowId: 'csv-row-a', resourceCd: 'BB', resourceNames: ['B'], processOrder: 1, isCompleted: true },
      { rowId: 'csv-row-b', resourceCd: 'AA', resourceNames: ['A'], processOrder: 2, isCompleted: false }
    ]);
    expect(
      index.get(
        buildLeaderBoardPartResourceProcessKey({
          seibanJoinKey: 'masked-S1',
          productNo: 'P2',
          fhincd: 'P2-H'
        })
      )
    ).toEqual([{ rowId: 'csv-row-c', resourceCd: 'BB', resourceNames: ['B'], processOrder: 1, isCompleted: false }]);
  });

  it('skips blank join keys', () => {
    expect(
      buildLeaderBoardFooterResourceChipsByPartKey([
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
    expect(buildLeaderBoardFooterResourceChipsByPartKey([]).size).toBe(0);
  });
});
