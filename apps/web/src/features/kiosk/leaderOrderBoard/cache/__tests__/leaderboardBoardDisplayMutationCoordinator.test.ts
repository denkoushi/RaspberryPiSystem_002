import { describe, expect, it } from 'vitest';

import { resolveDisplayBoardMutationUpdate } from '../leaderboardBoardDisplayMutationCoordinator';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function board(
  rowSpecs: Array<{ id: string; processingOrder?: number | null; note?: string | null }>
): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: rowSpecs.length,
    rows: rowSpecs.map((r) => ({
      id: r.id,
      processingOrder: r.processingOrder ?? null,
      note: r.note ?? null,
      dueDate: null,
      rowData: {}
    })),
    resources: [{ resourceCd: '1', hasMore: false, total: rowSpecs.length, pageSize: 80 }]
  } as ProductionScheduleLeaderboardBoardResponse;
}

describe('resolveDisplayBoardMutationUpdate', () => {
  it('shell のみのとき patch 済み board を appendOverride に載せる', () => {
    const shell = board([{ id: 'r1', processingOrder: 1 }]);
    const result = resolveDisplayBoardMutationUpdate({
      shell,
      appendOverride: null,
      mutation: { kind: 'order', rowId: 'r1', processingOrder: 5 }
    });
    expect(result.nextAppendOverride?.rows[0]?.processingOrder).toBe(5);
    expect(result.patchedDisplayBoard?.rows[0]?.processingOrder).toBe(5);
  });

  it('appendOverride が表示正本のとき append を patch する', () => {
    const shell = board([{ id: 'r1' }]);
    const append = board([
      { id: 'r1', processingOrder: 1 },
      { id: 'r2', processingOrder: 2 }
    ]);
    const result = resolveDisplayBoardMutationUpdate({
      shell,
      appendOverride: append,
      mutation: { kind: 'order', rowId: 'r2', processingOrder: 9 }
    });
    expect(result.nextAppendOverride?.rows[1]?.processingOrder).toBe(9);
  });

  it('未知 rowId のときは更新しない', () => {
    const shell = board([{ id: 'r1', processingOrder: 1 }]);
    const result = resolveDisplayBoardMutationUpdate({
      shell,
      appendOverride: null,
      mutation: { kind: 'order', rowId: 'missing', processingOrder: 9 }
    });
    expect(result.nextAppendOverride).toBeNull();
    expect(result.patchedDisplayBoard?.rows[0]?.processingOrder).toBe(1);
  });
});
