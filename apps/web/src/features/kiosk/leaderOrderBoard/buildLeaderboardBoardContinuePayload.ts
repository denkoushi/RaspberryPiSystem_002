import { LEADER_ORDER_BOARD_SHELL_PAGE_SIZE } from './constants';

import type {
  KioskProductionScheduleLeaderboardBoardContinuePayload,
  KioskProductionScheduleLeaderboardBoardQueryParams,
  ProductionScheduleLeaderboardBoardResponse
} from '../../../api/client';

/**
 * `POST …/leaderboard-board/continue` の本文を組み立てる。
 *
 * サーバの `productionScheduleLeaderboardBoardContinueBodySchema`（superRefine）では、
 * `hasMore && snapshotId` のスライスに **cursor または excludeRowIds（1件以上）** が必要。
 * `nextCursor` が欠けて `cursor` が JSON から落ちると HTTP 400 になるため、
 * **API が数値 nextCursor を返すのが正本**だが、欠落時は `cursor: 0` で契約を満たす保険とする。
 */
export function buildLeaderboardBoardContinuePayload(
  base: KioskProductionScheduleLeaderboardBoardQueryParams,
  board: ProductionScheduleLeaderboardBoardResponse
): KioskProductionScheduleLeaderboardBoardContinuePayload {
  const { page: _p, pageSize: _ps, ...rest } = base;
  void _p;
  void _ps;
  return {
    ...rest,
    resourceSlices: board.resources.map((r) => {
      const hasSnap = Boolean(r.snapshotId?.trim());
      let cursor: number | undefined;
      if (typeof r.nextCursor === 'number' && Number.isFinite(r.nextCursor)) {
        cursor = Math.max(0, Math.trunc(r.nextCursor));
      } else if (r.hasMore && hasSnap) {
        cursor = 0;
      }
      return {
        resourceCd: r.resourceCd,
        snapshotId: r.snapshotId,
        ...(cursor !== undefined ? { cursor } : {}),
        hasMore: r.hasMore
      };
    }),
    pageSize: board.pageSize ?? LEADER_ORDER_BOARD_SHELL_PAGE_SIZE
  };
}
