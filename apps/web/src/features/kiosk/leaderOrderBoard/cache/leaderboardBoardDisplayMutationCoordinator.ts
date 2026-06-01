import { pickLeaderboardBoardForDisplay } from '../leaderboardBoardDisplayPolicy';
import { resolveStaleDecorationRowIds } from '../leaderboardDecorationStalePolicy';

import { applyMutationToLeaderboardBoard } from './leaderboardBoardApplyMutation';

import type { LeaderboardBoardCacheMutation } from './leaderboardBoardApplyMutation';
import type { ProductionScheduleLeaderboardBoardResponse } from '../../../../api/client';

export type ResolveDisplayBoardMutationUpdateInput = {
  shell: ProductionScheduleLeaderboardBoardResponse | undefined;
  appendOverride: ProductionScheduleLeaderboardBoardResponse | null;
  mutation: LeaderboardBoardCacheMutation;
};

export type ResolveDisplayBoardMutationUpdateResult = {
  /** 表示正本を patch した board（network / SWR 下流用） */
  patchedDisplayBoard: ProductionScheduleLeaderboardBoardResponse | undefined;
  /** appendOverride state へ書き込む値（null のときは更新不要） */
  nextAppendOverride: ProductionScheduleLeaderboardBoardResponse | null;
  /** 装飾の増分再取得が必要な rowId（completion のみ） */
  staleDecorationRowIds: readonly string[];
};

/**
 * 現在画面に効いている board（shell vs append）に mutation を適用し、
 * network 表示経路（appendOverride）を更新する。
 */
export function resolveDisplayBoardMutationUpdate(
  input: ResolveDisplayBoardMutationUpdateInput
): ResolveDisplayBoardMutationUpdateResult {
  const staleDecorationRowIds = resolveStaleDecorationRowIds(input.mutation);
  const displaySource = pickLeaderboardBoardForDisplay(input.shell, input.appendOverride);
  if (displaySource == null) {
    return { patchedDisplayBoard: undefined, nextAppendOverride: null, staleDecorationRowIds };
  }

  const patchedDisplayBoard = applyMutationToLeaderboardBoard(displaySource, input.mutation);
  const rowExists = displaySource.rows.some((row) => row.id === input.mutation.rowId);
  if (!rowExists) {
    return { patchedDisplayBoard: displaySource, nextAppendOverride: null, staleDecorationRowIds };
  }

  return {
    patchedDisplayBoard,
    nextAppendOverride: patchedDisplayBoard,
    staleDecorationRowIds
  };
}
