import type { LeaderBoardRow } from './types';

/** 資源CDごとにグループ化（キーは昇順ソート） */
export function groupRowsByResourceCd(rows: LeaderBoardRow[]): Map<string, LeaderBoardRow[]> {
  const map = new Map<string, LeaderBoardRow[]>();
  for (const row of rows) {
    const list = map.get(row.resourceCd) ?? [];
    list.push(row);
    map.set(row.resourceCd, list);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ja')));
}
