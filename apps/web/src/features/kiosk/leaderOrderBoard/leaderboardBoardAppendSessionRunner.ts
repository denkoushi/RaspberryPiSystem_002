import { postKioskProductionScheduleLeaderboardBoardContinue } from '../../../api/client';

import { buildLeaderboardBoardContinuePayload } from './buildLeaderboardBoardContinuePayload';
import { resolveScopedLeaderboardAppendOverride } from './leaderboardBoardAppendOverrideScopePolicy';
import { resolveLeaderboardAppendLoopStartBoard } from './leaderboardBoardAppendSessionPolicy';
import {
  classifyLeaderboardContinueFailure,
  normalizeLeaderboardContinueFailure
} from './leaderboardContinueErrorPolicy';
import { mergeLeaderboardBoardContinueResponseWithOptionalDelta } from './mergeLeaderboardBoardContinueResponse';

import type {
  KioskProductionScheduleLeaderboardBoardQueryParams,
  ProductionScheduleLeaderboardBoardResponse
} from '../../../api/client';

export type LeaderboardBoardAppendSessionRunnerRefs = {
  appendOverrideRef: { current: ProductionScheduleLeaderboardBoardResponse | null };
  appendOverrideParamsKeyRef: { current: string | null };
  latestParamsKeyRef: { current: string };
};

export type RunLeaderboardBoardAppendSessionInput = {
  runId: number;
  paramsKey: string;
  shell: ProductionScheduleLeaderboardBoardResponse;
  boardQueryParams: KioskProductionScheduleLeaderboardBoardQueryParams;
  orderedResourceCds: readonly string[];
  refs: LeaderboardBoardAppendSessionRunnerRefs;
  isRunCurrent: (runId: number) => boolean;
  shouldAbort: () => boolean;
  onAppending: (active: boolean) => void;
  onError: (error: Error | null) => void;
  onOverride: (board: ProductionScheduleLeaderboardBoardResponse) => void;
  onComplete: () => void;
  onSnapshotExpired: () => Promise<void>;
  onRetry: () => void;
};

export async function runLeaderboardBoardAppendSession(
  input: RunLeaderboardBoardAppendSessionInput
): Promise<void> {
  const { runId, paramsKey, shell, boardQueryParams, orderedResourceCds, refs } = input;

  try {
    const runParamsKey = paramsKey;
    let cur = resolveLeaderboardAppendLoopStartBoard(
      shell,
      resolveScopedLeaderboardAppendOverride({
        paramsKey: runParamsKey,
        overrideParamsKey: refs.appendOverrideParamsKeyRef.current,
        override: refs.appendOverrideRef.current
      })
    );

    while (
      !input.shouldAbort() &&
      input.isRunCurrent(runId) &&
      cur.resources.some((r) => r.hasMore)
    ) {
      input.onAppending(true);
      input.onError(null);
      const payload = buildLeaderboardBoardContinuePayload(boardQueryParams, cur);
      const nextRaw = await postKioskProductionScheduleLeaderboardBoardContinue(payload);
      if (nextRaw.snapshotExpired) {
        refs.appendOverrideRef.current = null;
        refs.appendOverrideParamsKeyRef.current = null;
        await input.onSnapshotExpired();
        break;
      }
      const next =
        orderedResourceCds.length > 0
          ? mergeLeaderboardBoardContinueResponseWithOptionalDelta(cur.rows, nextRaw, orderedResourceCds, {
              processChangeResidualTotal: cur.processChangeResidualTotal,
              processChangeResidualRows: cur.processChangeResidualRows,
              processChangeResidualRepresentativeLimit: cur.processChangeResidualRepresentativeLimit
            })
          : nextRaw;
      if (refs.latestParamsKeyRef.current !== runParamsKey) {
        return;
      }
      refs.appendOverrideRef.current = next;
      refs.appendOverrideParamsKeyRef.current = runParamsKey;
      input.onOverride(next);
      cur = next;
    }

    if (
      !input.shouldAbort() &&
      input.isRunCurrent(runId) &&
      !cur.resources.some((r) => r.hasMore)
    ) {
      input.onComplete();
    }
  } catch (e) {
    if (!input.shouldAbort() && input.isRunCurrent(runId)) {
      const normalized = normalizeLeaderboardContinueFailure(e);
      if (classifyLeaderboardContinueFailure(normalized) === 'terminal') {
        input.onError(normalized);
      } else {
        input.onRetry();
      }
    }
  } finally {
    if (input.isRunCurrent(runId)) {
      input.onAppending(false);
    }
  }
}
