import { useCallback, useState } from 'react';

import { applyLeaderBoardAutoRankAssignments } from './applyLeaderBoardAutoRankAssignments';
import { buildLeaderBoardAutoRankAssignments } from './buildLeaderBoardAutoRankAssignments';

import type { LeaderBoardRow } from './types';

export type UseLeaderBoardSlotAutoRankParams = {
  seibanEvalEnabled: boolean;
  listIncomplete: boolean;
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
  listIncomplete,
  interactionLocked,
  orderPending,
  sortedGrouped,
  orderUsageByResourceCd,
  updateOrderAsync
}: UseLeaderBoardSlotAutoRankParams) {
  const [autoRankApplying, setAutoRankApplying] = useState(false);

  const autoRankDisabled =
    !seibanEvalEnabled || listIncomplete || interactionLocked || orderPending || autoRankApplying;

  const handleAutoRank = useCallback(
    async (resourceCd: string) => {
      const cd = resourceCd.trim();
      if (cd.length === 0) return;
      if (!seibanEvalEnabled || listIncomplete || interactionLocked || orderPending || autoRankApplying) {
        return;
      }

      const sortedRows = sortedGrouped.get(cd) ?? [];
      const assignments = buildLeaderBoardAutoRankAssignments({
        resourceCd: cd,
        sortedRows,
        usageNumbers: orderUsageByResourceCd?.[cd]
      });
      if (assignments.length === 0) return;

      setAutoRankApplying(true);
      try {
        await applyLeaderBoardAutoRankAssignments(assignments, updateOrderAsync);
      } finally {
        setAutoRankApplying(false);
      }
    },
    [
      autoRankApplying,
      interactionLocked,
      listIncomplete,
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
