import { useCallback } from 'react';

import { useSingleFlight } from '../../../hooks/useSingleFlight';

import { applyLeaderBoardAutoRankAssignments } from './applyLeaderBoardAutoRankAssignments';
import { buildLeaderBoardAutoRankAssignments } from './buildLeaderBoardAutoRankAssignments';

import type { LeaderBoardRow } from './types';

export type UseLeaderBoardSlotAutoRankParams = {
  seibanEvalEnabled: boolean;
  interactionLocked: boolean;
  orderPending: boolean;
  sortedGrouped: Map<string, LeaderBoardRow[]>;
  orderUsageByResourceCd: Record<string, number[]> | undefined;
  updateOrderAsync: (params: {
    rowId: string;
    resourceCd: string;
    orderNumber: number | null;
  }) => Promise<void>;
};

export function useLeaderBoardSlotAutoRank({
  seibanEvalEnabled,
  interactionLocked,
  orderPending,
  sortedGrouped,
  orderUsageByResourceCd,
  updateOrderAsync
}: UseLeaderBoardSlotAutoRankParams) {
  const { run, pending: autoRankApplying } = useSingleFlight();

  const autoRankDisabled =
    !seibanEvalEnabled || interactionLocked || orderPending || autoRankApplying;

  const handleAutoRank = useCallback(
    async (resourceCd: string) => {
      const cd = resourceCd.trim();
      if (cd.length === 0) return;
      if (!seibanEvalEnabled || interactionLocked || orderPending || autoRankApplying) {
        return;
      }

      const sortedRows = sortedGrouped.get(cd) ?? [];
      const assignments = buildLeaderBoardAutoRankAssignments({
        resourceCd: cd,
        sortedRows,
        usageNumbers: orderUsageByResourceCd?.[cd]
      });
      if (assignments.length === 0) return;

      await run(() => applyLeaderBoardAutoRankAssignments(assignments, updateOrderAsync));
    },
    [
      run,
      autoRankApplying,
      interactionLocked,
      orderPending,
      orderUsageByResourceCd,
      seibanEvalEnabled,
      sortedGrouped,
      updateOrderAsync
    ]
  );

  return {
    handleAutoRank,
    autoRankDisabled,
    autoRankPending: autoRankApplying || orderPending
  };
}
