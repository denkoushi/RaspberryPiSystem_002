import { patchScheduleListProcessingOrder } from '../../productionSchedule/cache/kioskProductionScheduleOrderCachePatch';

import { fingerprintLeaderboardBoardRowIds } from './leaderboardBoardCacheRecord';

import type { PersistedLeaderboardBoardCacheRecord } from './leaderboardBoardCacheRecord';
import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

export type LeaderboardBoardCacheMutation =
  | { kind: 'order'; rowId: string; processingOrder: number | null }
  | { kind: 'note'; rowId: string; note: string | null }
  | { kind: 'dueDate'; rowId: string; dueDate: string | null }
  | { kind: 'completion'; rowId: string; rowData: Record<string, unknown> };

function patchBoard(
  board: ProductionScheduleLeaderboardBoardResponse,
  mutation: LeaderboardBoardCacheMutation
): ProductionScheduleLeaderboardBoardResponse {
  switch (mutation.kind) {
    case 'order': {
      const patched = patchScheduleListProcessingOrder(board, mutation.rowId, mutation.processingOrder);
      return patched as ProductionScheduleLeaderboardBoardResponse;
    }
    case 'note':
      return {
        ...board,
        rows: board.rows.map((row) =>
          row.id === mutation.rowId ? { ...row, note: mutation.note } : row
        )
      };
    case 'dueDate':
      return {
        ...board,
        rows: board.rows.map((row) =>
          row.id === mutation.rowId ? { ...row, dueDate: mutation.dueDate } : row
        )
      };
    case 'completion':
      return {
        ...board,
        rows: board.rows.map((row) =>
          row.id === mutation.rowId ? { ...row, rowData: mutation.rowData } : row
        )
      };
    default:
      return board;
  }
}

/** mutation 成功後に IDB レコードへ反映（出力同値・サーバ保存済みデータをミラー） */
export function patchLeaderboardBoardCacheRecord(
  record: PersistedLeaderboardBoardCacheRecord,
  mutation: LeaderboardBoardCacheMutation
): PersistedLeaderboardBoardCacheRecord {
  const board = patchBoard(record.board, mutation);
  return {
    ...record,
    board,
    rowIdsFingerprint: fingerprintLeaderboardBoardRowIds(board),
    savedAt: Date.now()
  };
}
