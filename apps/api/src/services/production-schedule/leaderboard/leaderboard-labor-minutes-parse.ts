/**
 * `FSIGENSHOYORYO` 等を分（number）へ正規化。Web `parseLeaderBoardRequiredMinutes` と同等。
 */
export function parseLeaderboardLaborMinutesValue(raw: unknown): number {
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
