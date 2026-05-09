/**
 * 順位ボード shell（段階取得）のフィラー先読み上限。
 * takeCount が小さいときの過剰 LIMIT（例: 320 固定バッチ）と、緩すぎる総量上限を抑える。
 */

export const LEADERBOARD_SHELL_FILLER_BATCH_HARD_CAP = 320;

export function computeLeaderboardShellFillerBudget(params: {
  takeCount: number;
  excludeRowIdCount: number;
}): { maxFillerTotal: number; batchTakeSoftCap: number } {
  const nTake = Math.max(0, Math.floor(params.takeCount));
  const excludeRowIdCount = Math.max(0, Math.floor(params.excludeRowIdCount));
  const maxFillerTotal = Math.min(
    12_000,
    Math.max(
      nTake * 18 + excludeRowIdCount * 2 + 240,
      nTake * 8 + excludeRowIdCount * 3 + 160
    )
  );
  const batchTakeSoftCap = Math.min(
    LEADERBOARD_SHELL_FILLER_BATCH_HARD_CAP,
    Math.max(64, Math.floor(nTake * 6) + 56)
  );
  return { maxFillerTotal, batchTakeSoftCap };
}
