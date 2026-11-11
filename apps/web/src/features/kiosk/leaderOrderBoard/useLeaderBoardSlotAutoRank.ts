import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { autoRankKioskProductionScheduleOrder } from '../../../api/client';
import { getApiErrorMessageWithCode } from '../../../api/errors';
import { productionScheduleQueryKeys } from '../../../api/queryKeys/productionSchedule';
import { patchScheduleListProcessingOrder, patchOrderUsageForProcessingOrderChange } from '../productionSchedule/cache/kioskProductionScheduleOrderCachePatch';

import { applyLeaderBoardAutoRankAssignments } from './applyLeaderBoardAutoRankAssignments';
import { buildLeaderBoardAutoRankAssignments } from './buildLeaderBoardAutoRankAssignments';

import type { LeaderBoardRow } from './types';
import type { useSingleFlight } from '../../../hooks/useSingleFlight';
import type { KioskProductionScheduleListCache } from '../productionSchedule/cache/kioskProductionScheduleListCache';

export type UseLeaderBoardSlotAutoRankParams = {
  seibanEvalEnabled: boolean;
  interactionLocked: boolean;
  orderPending: boolean;
  sortedGrouped: Map<string, LeaderBoardRow[]>;
  orderUsageByResourceCd: Record<string, number[]> | undefined;
  targetDeviceScopeKey?: string;
  singleFlight: ReturnType<typeof useSingleFlight>;
  onOrderSuccess: (assignment: { rowId: string; orderNumber: number }) => void;
};

export function useLeaderBoardSlotAutoRank({
  seibanEvalEnabled,
  interactionLocked,
  orderPending,
  sortedGrouped,
  orderUsageByResourceCd,
  targetDeviceScopeKey,
  singleFlight,
  onOrderSuccess
}: UseLeaderBoardSlotAutoRankParams) {
  const queryClient = useQueryClient();
  const { mutateAsync: saveAssignments } = useMutation({
    mutationFn: (payload: Parameters<typeof autoRankKioskProductionScheduleOrder>[0]) =>
      autoRankKioskProductionScheduleOrder(payload),
    retry: false,
    onMutate: () => {
      void queryClient.cancelQueries({ queryKey: productionScheduleQueryKeys.leaderboardBoardAll });
      void queryClient.cancelQueries({ queryKey: productionScheduleQueryKeys.orderUsageAll });
    },
    onSuccess: (_data, { assignments, resourceCd }) => {
      for (const assignment of assignments) {
        queryClient.setQueriesData<KioskProductionScheduleListCache>(
          { queryKey: productionScheduleQueryKeys.scheduleAll },
          old => old ? patchScheduleListProcessingOrder(old, assignment.rowId, assignment.orderNumber) : old
        );
        queryClient.setQueriesData<Record<string, number[]>>(
          { queryKey: productionScheduleQueryKeys.orderUsageAll },
          old => old ? patchOrderUsageForProcessingOrderChange(old, resourceCd, null, assignment.orderNumber) : old
        );
        onOrderSuccess(assignment);
      }
    },
    onError: () => {
      // No display patch is applied before success; recover conflicts from the server.
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.leaderboardBoardAll });
      void queryClient.invalidateQueries({ queryKey: productionScheduleQueryKeys.orderUsageAll });
    }
  });
  const { run, pending: autoRankApplying } = singleFlight;

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

      await run(() => applyLeaderBoardAutoRankAssignments(assignments, saveAssignments, targetDeviceScopeKey));
    },
    [
      run,
      autoRankApplying,
      interactionLocked,
      orderPending,
      orderUsageByResourceCd,
      seibanEvalEnabled,
      sortedGrouped,
      saveAssignments,
      targetDeviceScopeKey
    ]
  );

  const handleAutoRankSlot = useCallback((resourceCd: string) => {
    void handleAutoRank(resourceCd).catch((error: unknown) => {
      window.alert(getApiErrorMessageWithCode(error));
    });
  }, [handleAutoRank]);

  return {
    handleAutoRankSlot,
    autoRankDisabled
  };
}
