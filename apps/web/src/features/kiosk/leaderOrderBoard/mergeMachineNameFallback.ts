import type { LeaderBoardRow } from './types';

export type ProgressBySeibanEntry = { machineName?: string | null };

/**
 * `/kiosk/production-schedule/history-progress` の `progressBySeiban` から製番→機種名マップを作る。
 */
export function buildSeibanMachineNameMapFromProgressBySeiban(
  progressBySeiban: Record<string, ProgressBySeibanEntry> | undefined
): Map<string, string> {
  const m = new Map<string, string>();
  if (!progressBySeiban) return m;
  for (const [seiban, entry] of Object.entries(progressBySeiban)) {
    const sk = seiban.trim();
    const name = entry?.machineName?.trim() ?? '';
    if (sk.length > 0 && name.length > 0) m.set(sk, name);
  }
  return m;
}

/**
 * `machineName` が空の行にだけ、製番キーのフォールバック（例: history-progress）を補う。
 */
export function mergeMachineNameFallback(
  rows: readonly LeaderBoardRow[],
  fallbackBySeiban: ReadonlyMap<string, string>
): LeaderBoardRow[] {
  return rows.map((row) => {
    if (row.machineName.trim().length > 0) return row;
    const key = row.fseiban.trim();
    if (key.length === 0) return row;
    const fb = fallbackBySeiban.get(key)?.trim() ?? '';
    if (fb.length === 0) return row;
    return { ...row, machineName: fb };
  });
}
