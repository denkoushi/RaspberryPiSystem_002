import type { ProductionScheduleLeaderboardBoardResponse } from '../../../api/client';

export type LeaderboardAppendOverrideScopeInput = {
  paramsKey: string;
  /** appendOverride が紐づく paramsKey（未確定なら null） */
  overrideParamsKey: string | null;
  override: ProductionScheduleLeaderboardBoardResponse | null;
};

/**
 * 現在の paramsKey に属する appendOverride のみ返す。
 * params 変更後の遅延 continue 応答を表示に載せない（正本は ref + overrideParamsKey）。
 */
export function resolveScopedLeaderboardAppendOverride(
  input: LeaderboardAppendOverrideScopeInput
): ProductionScheduleLeaderboardBoardResponse | null {
  if (input.overrideParamsKey == null || input.overrideParamsKey !== input.paramsKey) {
    return null;
  }
  return input.override;
}
