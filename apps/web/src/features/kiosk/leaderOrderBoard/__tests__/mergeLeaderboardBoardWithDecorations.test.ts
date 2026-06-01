import { describe, expect, it } from 'vitest';

import {
  createEmptyAccumulatedLeaderboardDecorations,
  listUndecoratedLeaderboardRowIds,
  mergeLeaderboardBoardWithDecorations,
  mergeLeaderboardDecorationsIntoAccumulator
} from '../mergeLeaderboardBoardWithDecorations';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

describe('mergeLeaderboardBoardWithDecorations', () => {
  const lightBoard: ProductionScheduleLeaderboardBoardResponse = {
    page: 1,
    pageSize: 80,
    total: 1,
    rows: [
      {
        id: 'row-1',
        resourceCd: '1',
        machineName: '',
        rowData: {}
      } as ProductionScheduleLeaderboardBoardResponse['rows'][number]
    ],
    resources: [
      {
        resourceCd: '1',
        hasMore: false,
        total: 1,
        pageSize: 80
      }
    ]
  };

  it('行に装飾をマージしフッタチップを付与する', () => {
    const acc = mergeLeaderboardDecorationsIntoAccumulator(createEmptyAccumulatedLeaderboardDecorations(), {
      rowDecorations: [{ id: 'row-1', resolvedMachineName: 'M1', customerName: 'C1' }],
      leaderboardFooterChipsByPartKey: { 'k\0a': [] }
    });
    const merged = mergeLeaderboardBoardWithDecorations(lightBoard, acc);
    expect(merged.rows[0]?.resolvedMachineName).toBe('M1');
    expect(merged.rows[0]?.customerName).toBe('C1');
    expect(merged.leaderboardFooterChipsByPartKey).toEqual({ 'k\0a': [] });
  });

  it('未装飾行 id を列挙する', () => {
    const decorated = new Set(['a']);
    expect(listUndecoratedLeaderboardRowIds(['a', 'b'], decorated)).toEqual(['b']);
    decorated.delete('a');
    expect(listUndecoratedLeaderboardRowIds(['a', 'b'], decorated)).toEqual(['a', 'b']);
  });
});
