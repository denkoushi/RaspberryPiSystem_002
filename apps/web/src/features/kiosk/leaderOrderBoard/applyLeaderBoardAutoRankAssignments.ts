import type { UpdateOrderFn } from './applyResourceOrderReorder';
import type { LeaderBoardAutoRankAssignment } from './buildLeaderBoardAutoRankAssignments';

/**
 * 自動順位付与計画を直列で API に反映する（order-usage 楽観パッチの競合回避）。
 */
export async function applyLeaderBoardAutoRankAssignments(
  assignments: readonly LeaderBoardAutoRankAssignment[],
  updateOrder: UpdateOrderFn
): Promise<void> {
  for (const assignment of assignments) {
    await updateOrder({
      rowId: assignment.rowId,
      resourceCd: assignment.resourceCd,
      orderNumber: assignment.orderNumber
    });
  }
}
