import { describe, expect, it } from 'vitest';

import { buildLeaderboardPartKeyFromScheduleRow } from '../leaderboardDecorationStalePolicy';
import {
  createEmptyAccumulatedLeaderboardDecorations,
  mergeLeaderboardBoardWithDecorations,
  mergeLeaderboardDecorationsIntoAccumulator
} from '../mergeLeaderboardBoardWithDecorations';

import type { ProductionScheduleLeaderboardBoardResponse, ProductionScheduleRow } from '../../../../api/client';

const row = (id: string, fhincd: string): ProductionScheduleRow => ({
  id,
  occurredAt: '2026-10-01T00:00:00.000Z',
  updatedAt: null,
  rowData: { FSEIBAN: 'CA1S1M11', ProductNo: '0003594297', FHINCD: fhincd, FSIGENCD: '305' }
});

describe('material arrival status on leaderboard rows', () => {
  const withMaterial = row('r1', 'MD100024231');
  const sameParOtherProcess = row('r2', 'MD100024231');
  const withoutMaterial = row('r3', 'MH004411200');
  const partKey = buildLeaderboardPartKeyFromScheduleRow(withMaterial);
  const board = {
    page: 1,
    pageSize: 3,
    total: 3,
    rows: [withMaterial, sameParOtherProcess, withoutMaterial],
    resources: []
  } as unknown as ProductionScheduleLeaderboardBoardResponse;

  it('attaches the status to every process row of the part and leaves other parts null', () => {
    const decorations = mergeLeaderboardDecorationsIntoAccumulator(createEmptyAccumulatedLeaderboardDecorations(), {
      rowDecorations: [],
      leaderboardFooterChipsByPartKey: { [partKey]: [] },
      leaderboardMaterialArrivalByPartKey: { [partKey]: 'ordered' }
    });
    const merged = mergeLeaderboardBoardWithDecorations(board, decorations);
    expect(merged.rows.map((r) => r.materialArrivalStatus ?? null)).toEqual(['ordered', 'ordered', null]);
  });

  it('drops a stale status when a refetched part no longer has a material row', () => {
    const first = mergeLeaderboardDecorationsIntoAccumulator(createEmptyAccumulatedLeaderboardDecorations(), {
      rowDecorations: [],
      leaderboardFooterChipsByPartKey: { [partKey]: [] },
      leaderboardMaterialArrivalByPartKey: { [partKey]: 'ordered' }
    });
    const second = mergeLeaderboardDecorationsIntoAccumulator(first, {
      rowDecorations: [],
      leaderboardFooterChipsByPartKey: { [partKey]: [] },
      leaderboardMaterialArrivalByPartKey: {}
    });
    expect(second.leaderboardMaterialArrivalByPartKey[partKey]).toBeUndefined();
  });

  it('keeps the status of parts that were not part of the refetch', () => {
    const first = mergeLeaderboardDecorationsIntoAccumulator(createEmptyAccumulatedLeaderboardDecorations(), {
      rowDecorations: [],
      leaderboardFooterChipsByPartKey: { [partKey]: [] },
      leaderboardMaterialArrivalByPartKey: { [partKey]: 'received' }
    });
    const second = mergeLeaderboardDecorationsIntoAccumulator(first, { rowDecorations: [] });
    expect(second.leaderboardMaterialArrivalByPartKey[partKey]).toBe('received');
  });
});
