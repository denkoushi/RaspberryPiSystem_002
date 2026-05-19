import { useMemo } from 'react';

import {
  useProductionScheduleMutations,
  type UseProductionScheduleMutationsParams
} from '../productionSchedule/useProductionScheduleMutations';

import type { LeaderboardBoardCacheMutation } from './useLeaderboardBoardTerminalCache';
import type { ProductionScheduleWriteSuccessListeners } from '../productionSchedule/productionScheduleWriteSuccessListeners';

export function buildLeaderboardBoardCacheWriteSuccessListeners(
  applyMutationPatch: (mutation: LeaderboardBoardCacheMutation) => void,
  terminalCacheEnabled: boolean
): ProductionScheduleWriteSuccessListeners {
  if (!terminalCacheEnabled) return {};
  return {
    onOrderSuccess: ({ rowId, orderNumber }) => {
      applyMutationPatch({ kind: 'order', rowId, processingOrder: orderNumber });
    },
    onNoteSuccess: ({ rowId, note }) => {
      applyMutationPatch({ kind: 'note', rowId, note });
    },
    onDueDateSuccess: ({ rowId, dueDate }) => {
      applyMutationPatch({ kind: 'dueDate', rowId, dueDate });
    },
    onCompletionSuccess: ({ rowId, rowData }) => {
      applyMutationPatch({ kind: 'completion', rowId, rowData });
    }
  };
}

export type UseLeaderboardBoardCacheMutationBridgeParams = Omit<
  UseProductionScheduleMutationsParams,
  'writeSuccessListeners'
>;

/**
 * 順位ボード向け: 生産スケジュール mutation + 書き込み成功時の IDB ミラー。
 */
export function useLeaderboardBoardCacheMutationBridge(
  mutationParams: UseLeaderboardBoardCacheMutationBridgeParams,
  applyMutationPatch: (mutation: LeaderboardBoardCacheMutation) => void,
  terminalCacheEnabled: boolean
) {
  const writeSuccessListeners = useMemo(
    () => buildLeaderboardBoardCacheWriteSuccessListeners(applyMutationPatch, terminalCacheEnabled),
    [applyMutationPatch, terminalCacheEnabled]
  );

  return useProductionScheduleMutations({
    ...mutationParams,
    writeSuccessListeners
  });
}
