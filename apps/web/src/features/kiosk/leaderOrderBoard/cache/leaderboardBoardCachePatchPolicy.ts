import {
  applyMutationToLeaderboardBoard,
  type LeaderboardBoardCacheMutation
} from './leaderboardBoardApplyMutation';
import { fingerprintLeaderboardBoardRowIds } from './leaderboardBoardCacheRecord';

import type { PersistedLeaderboardBoardCacheRecord } from './leaderboardBoardCacheRecord';

export type { LeaderboardBoardCacheMutation } from './leaderboardBoardApplyMutation';

/** mutation 成功後に IDB レコードへ反映（出力同値・サーバ保存済みデータをミラー） */
export function patchLeaderboardBoardCacheRecord(
  record: PersistedLeaderboardBoardCacheRecord,
  mutation: LeaderboardBoardCacheMutation
): PersistedLeaderboardBoardCacheRecord {
  const board = applyMutationToLeaderboardBoard(record.board, mutation);
  return {
    ...record,
    board,
    rowIdsFingerprint: fingerprintLeaderboardBoardRowIds(board),
    savedAt: Date.now()
  };
}
