/**
 * 集約 leaderboard-board の `resources[].nextCursor` を HTTP JSON で欠落させないための正規化。
 *
 * `undefined` のフィールドはシリアライズで落ち、キオスクが `POST …/leaderboard-board/continue` で
 * `cursor` を送れず、`productionScheduleLeaderboardBoardContinueBodySchema`（superRefine）に抵触して 400 になり得る。
 *
 * @see apps/api/src/routes/kiosk/production-schedule/shared.ts — resourceSlices の snapshotId + hasMore 時の cursor / excludeRowIds 要件
 */
export function resolveFiniteLeaderboardBoardNextCursor(
  preferred: unknown,
  fallbacks: ReadonlyArray<unknown>
): number {
  const candidates = [preferred, ...fallbacks];
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) {
      return Math.max(0, Math.trunc(c));
    }
  }
  return 0;
}
