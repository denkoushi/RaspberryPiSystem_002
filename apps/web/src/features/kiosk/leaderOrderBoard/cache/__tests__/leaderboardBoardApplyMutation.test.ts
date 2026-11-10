import { describe, expect, it } from 'vitest';

import { applyMutationToLeaderboardBoard, type LeaderboardBoardCacheMutation } from '../leaderboardBoardApplyMutation';

import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../../api/client';

function makeBoard(): ProductionScheduleLeaderboardBoardResponse {
  return {
    page: 1,
    pageSize: 80,
    total: 2,
    rows: [
      {
        id: 'r1',
        processingOrder: 1,
        note: 'old',
        dueDate: '2026-11-10',
        rowData: { progress: '未' },
        machineRequiredMinutes: 0,
        laborRequiredMinutes: 0,
      },
      {
        id: 'r2',
        processingOrder: 2,
        note: null,
        dueDate: null,
        rowData: { progress: '未' },
        machineRequiredMinutes: 0,
        laborRequiredMinutes: 0,
      },
    ],
    resources: [{ resourceCd: '1', hasMore: false, total: 2, pageSize: 80 }],
  } as unknown as ProductionScheduleLeaderboardBoardResponse;
}

describe('applyMutationToLeaderboardBoard', () => {
  it.each<[LeaderboardBoardCacheMutation, Record<string, unknown>]>([
    [{ kind: 'order', rowId: 'r1', processingOrder: null }, { processingOrder: null }],
    [{ kind: 'order', rowId: 'r1', processingOrder: 5 }, { processingOrder: 5 }],
    [{ kind: 'note', rowId: 'r1', note: null }, { note: null }],
    [{ kind: 'dueDate', rowId: 'r1', dueDate: '2026-12-01' }, { dueDate: '2026-12-01' }],
    [{ kind: 'completion', rowId: 'r1', rowData: { progress: '完了' } }, { rowData: { progress: '完了' } }],
  ])('%o は対象行のみ更新する', (mutation, expected) => {
    const board = makeBoard();
    const next = applyMutationToLeaderboardBoard(board, mutation);
    expect(next.rows[0]).toMatchObject({ id: 'r1', ...expected });
    expect(next.rows[1]).toBe(board.rows[1]);
    expect(next.resources).toBe(board.resources);
    expect(next).not.toBe(board);
  });

  it('order 更新では他フィールドを保持する', () => {
    const next = applyMutationToLeaderboardBoard(makeBoard(), { kind: 'order', rowId: 'r1', processingOrder: 9 });
    expect(next.rows[0]).toMatchObject({ note: 'old', dueDate: '2026-11-10', rowData: { progress: '未' } });
  });

  it('completion は rowData を丸ごと置き換える（マージしない）', () => {
    const next = applyMutationToLeaderboardBoard(makeBoard(), {
      kind: 'completion',
      rowId: 'r1',
      rowData: { FSIGENCD: '1' },
    });
    expect(next.rows[0].rowData).toEqual({ FSIGENCD: '1' });
  });

  it('元の board を破壊しない', () => {
    const board = makeBoard();
    applyMutationToLeaderboardBoard(board, { kind: 'note', rowId: 'r1', note: 'new' });
    expect(board.rows[0].note).toBe('old');
  });

  it('存在しない rowId は行内容を変えない', () => {
    const board = makeBoard();
    const next = applyMutationToLeaderboardBoard(board, { kind: 'note', rowId: 'missing', note: 'x' });
    expect(next.rows).toEqual(board.rows);
  });

  it('未知の kind は同一参照を返す', () => {
    const board = makeBoard();
    expect(
      applyMutationToLeaderboardBoard(board, { kind: 'unknown', rowId: 'r1' } as unknown as LeaderboardBoardCacheMutation)
    ).toBe(board);
  });
});
