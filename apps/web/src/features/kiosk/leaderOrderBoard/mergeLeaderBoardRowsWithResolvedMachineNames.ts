import type { LeaderBoardRow } from './types';

/**
 * サーバ解決済みの製番→機種名マップで、`machineName` が空の行だけを埋める。
 * 既存 {@link mergeMachineNameFallback} と同じ優先度ルール（空のときのみ）。
 */
export function mergeLeaderBoardRowsWithResolvedMachineNames(
  rows: readonly LeaderBoardRow[],
  resolvedBySeiban: ReadonlyMap<string, string>
): LeaderBoardRow[] {
  return rows.map((row) => {
    if (row.machineName.trim().length > 0) {
      return row;
    }
    const key = row.fseiban.trim();
    if (!key.length) {
      return row;
    }
    const fb = resolvedBySeiban.get(key)?.trim() ?? '';
    if (!fb.length) {
      return row;
    }
    return { ...row, machineName: fb };
  });
}
