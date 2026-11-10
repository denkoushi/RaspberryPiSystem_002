import type { LeaderBoardAutoRankAssignment } from './buildLeaderBoardAutoRankAssignments';
import type { ProductionScheduleAutoRankRequest } from '@raspi-system/shared-types';

export async function applyLeaderBoardAutoRankAssignments(
  assignments: readonly LeaderBoardAutoRankAssignment[],
  save: (payload: ProductionScheduleAutoRankRequest) => Promise<unknown>,
  targetDeviceScopeKey?: string
): Promise<void> {
  if (assignments.length === 0) return;
  await save({
    resourceCd: assignments[0].resourceCd,
    assignments: assignments.map(({ rowId, orderNumber }) => ({ rowId, orderNumber })),
    ...(targetDeviceScopeKey ? { targetDeviceScopeKey } : {})
  });
}
