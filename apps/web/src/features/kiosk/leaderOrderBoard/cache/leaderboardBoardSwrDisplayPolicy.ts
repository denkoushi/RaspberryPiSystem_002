import {
  isCompleteLeaderboardBoardSnapshot,
  isLeaderboardBoardCacheWithinMaxAge,
  deserializeAccumulatedDecorations
} from './leaderboardBoardCacheRecord';

import type { PersistedLeaderboardBoardCacheRecord } from './leaderboardBoardCacheRecord';
import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';
import type { AccumulatedLeaderboardDecorations } from '../mergeLeaderboardBoardWithDecorations';

export type LeaderboardBoardDisplaySource = 'cache' | 'network';

export type ResolveLeaderboardBoardDisplaySourceInput = {
  terminalCacheEnabled: boolean;
  phase2SwrEnabled: boolean;
  hydratedRecord: PersistedLeaderboardBoardCacheRecord | null;
  cacheLoadSettled: boolean;
  paramsKey: string;
  networkDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  networkBoardComplete: boolean;
  networkInitialLoading: boolean;
  networkIsFetching: boolean;
  suppressPlaceholderShell: boolean;
  accumulatedDecorations: AccumulatedLeaderboardDecorations;
  nowMs: number;
  maxAgeMs: number;
};

export type ResolveLeaderboardBoardDisplaySourceResult = {
  displayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  displayDecorations: AccumulatedLeaderboardDecorations;
  displaySource: LeaderboardBoardDisplaySource;
  isShowingCachedData: boolean;
};

export function isHydratedCacheDisplayable(input: {
  hydratedRecord: PersistedLeaderboardBoardCacheRecord | null;
  cacheLoadSettled: boolean;
  paramsKey: string;
  nowMs: number;
  maxAgeMs: number;
}): boolean {
  if (!input.cacheLoadSettled || input.hydratedRecord == null) return false;
  if (input.hydratedRecord.paramsKey !== input.paramsKey) return false;
  if (
    !isLeaderboardBoardCacheWithinMaxAge(input.hydratedRecord.savedAt, input.nowMs, input.maxAgeMs)
  ) {
    return false;
  }
  if (!isCompleteLeaderboardBoardSnapshot(input.hydratedRecord.board)) return false;
  return input.hydratedRecord.board.rows.length > 0;
}

/**
 * Phase 2: stale-while-revalidate。完走済みキャッシュを再検証中も表示し、
 * Origin 完走後にネットワークへ切り替える。
 */
export function shouldPreferCacheForSwrDisplay(input: {
  cacheDisplayable: boolean;
  networkBoardComplete: boolean;
  networkInitialLoading: boolean;
  networkIsFetching: boolean;
  suppressPlaceholderShell: boolean;
  networkDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
}): boolean {
  if (!input.cacheDisplayable) return false;
  if (!input.networkBoardComplete) return true;
  if (input.networkInitialLoading) return true;
  if (input.networkIsFetching) return true;
  if (input.suppressPlaceholderShell && input.networkDisplayBoard == null) return true;
  return false;
}

export function resolveLeaderboardBoardDisplaySource(
  input: ResolveLeaderboardBoardDisplaySourceInput
): ResolveLeaderboardBoardDisplaySourceResult {
  const emptyDecorations = input.accumulatedDecorations;

  if (!input.terminalCacheEnabled || !input.phase2SwrEnabled) {
    return {
      displayBoard: input.networkDisplayBoard,
      displayDecorations: emptyDecorations,
      displaySource: 'network',
      isShowingCachedData: false
    };
  }

  const cacheDisplayable = isHydratedCacheDisplayable({
    hydratedRecord: input.hydratedRecord,
    cacheLoadSettled: input.cacheLoadSettled,
    paramsKey: input.paramsKey,
    nowMs: input.nowMs,
    maxAgeMs: input.maxAgeMs
  });

  const preferCache = shouldPreferCacheForSwrDisplay({
    cacheDisplayable,
    networkBoardComplete: input.networkBoardComplete,
    networkInitialLoading: input.networkInitialLoading,
    networkIsFetching: input.networkIsFetching,
    suppressPlaceholderShell: input.suppressPlaceholderShell,
    networkDisplayBoard: input.networkDisplayBoard
  });

  if (preferCache && input.hydratedRecord != null) {
    const isShowingCachedData = isLeaderboardBoardCacheWithinMaxAge(
      input.hydratedRecord.savedAt,
      input.nowMs,
      input.maxAgeMs
    );
    return {
      displayBoard: input.hydratedRecord.board,
      displayDecorations: deserializeAccumulatedDecorations(input.hydratedRecord.decorations),
      displaySource: 'cache',
      isShowingCachedData
    };
  }

  return {
    displayBoard: input.networkDisplayBoard,
    displayDecorations: emptyDecorations,
    displaySource: 'network',
    isShowingCachedData: false
  };
}
