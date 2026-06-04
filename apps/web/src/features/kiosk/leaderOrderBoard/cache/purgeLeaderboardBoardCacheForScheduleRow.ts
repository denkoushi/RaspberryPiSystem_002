import { openDB } from 'idb';

import {
  LEADERBOARD_BOARD_CACHE_IDB_NAME,
  LEADERBOARD_BOARD_CACHE_IDB_STORE
} from './leaderboardBoardCacheConstants';
import { parseLeaderboardBoardCacheRecord } from './leaderboardBoardCacheRecord';

/**
 * 自主検査リセット後、端末 IndexedDB に残った古い `/sessions/:id` 装飾を避けるため、
 * 該当 schedule row を含む board cache のみ削除する（スキーマ全消去はしない）。
 */
export async function purgeLeaderboardBoardCacheForScheduleRow(scheduleRowId: string): Promise<number> {
  const rowId = scheduleRowId.trim();
  if (!rowId || typeof indexedDB === 'undefined') return 0;

  try {
    const db = await openDB(LEADERBOARD_BOARD_CACHE_IDB_NAME, 1);
    const all = await db.getAll(LEADERBOARD_BOARD_CACHE_IDB_STORE);
    let removed = 0;
    for (const raw of all) {
      const record = parseLeaderboardBoardCacheRecord(raw);
      if (!record) continue;
      const touchesRow =
        record.board.rows.some((row) => row.id === rowId) ||
        Object.prototype.hasOwnProperty.call(record.decorations.rowDecorationsById, rowId);
      if (!touchesRow) continue;
      await db.delete(LEADERBOARD_BOARD_CACHE_IDB_STORE, record.cacheKey);
      removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}
