/**
 * `FSIGENSHOYORYO` 等の生値を LeaderBoardRow.requiredMinutes（分）へ正規化する。
 * 表示レイアウト（ガント）とは独立したデータ境界。
 */
export function parseLeaderBoardRequiredMinutes(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || !/^-?\d+(\.\d+)?$/.test(trimmed)) return 0;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}
