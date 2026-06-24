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
  /** shell/continue/decorations の背景再検証中 */
  isBackgroundRevalidating: boolean;
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
 * Phase 2: stale-while-revalidate。
 * 初期空白は cache で埋めるが、fresh shell の表示行が届いたら append 完走前でも
 * network を優先し、「最初に使える状態」を shell 到着時点まで前倒しする。
 */
export function shouldPreferCacheForSwrDisplay(input: {
  cacheDisplayable: boolean;
  isBackgroundRevalidating: boolean;
  suppressPlaceholderShell: boolean;
  networkDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
}): boolean {
  if (!input.cacheDisplayable) return false;
  if ((input.networkDisplayBoard?.rows.length ?? 0) > 0) return false;
  if (input.isBackgroundRevalidating) return true;
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
    isBackgroundRevalidating: input.isBackgroundRevalidating,
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
