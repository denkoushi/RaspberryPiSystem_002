import type { LeaderBoardRow } from './types';

/** 順位ボードの「表示中」グループから製番単位の一覧行を導出するための型 */
export type VisibleSeibanEntry = {
  fseiban: string;
  machineName: string;
};

/**
 * `buildLeaderBoardSortedGrouped` の結果から、製番ごとに一意な一覧を作る。
 * - `fseiban` が同一の複数行がある場合、最初に列挙された行の `machineName` を採用する。
 * - `fseiban` が空（trim 後）の行は除外する。
 */
export function deriveVisibleSeibanEntries(sortedGrouped: Map<string, LeaderBoardRow[]>): VisibleSeibanEntry[] {
  const seen = new Set<string>();
  const out: VisibleSeibanEntry[] = [];

  for (const rows of sortedGrouped.values()) {
    for (const row of rows) {
      const f = row.fseiban.trim();
      if (!f.length || seen.has(f)) continue;
      seen.add(f);
      out.push({
        fseiban: f,
        machineName: row.machineName.trim()
      });
    }
  }

  return out;
}
