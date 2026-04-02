import { compareDisplayDueDateForSort } from '../productionSchedule/plannedDueDisplay';

import type { LeaderBoardRow } from './types';

const toStableNumber = (value: string): number => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return Number.MAX_SAFE_INTEGER;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

/**
 * 納期（displayDue）昇順＋製番・製番内番号・工順・id の安定タイブレーク。
 */
export function compareLeaderBoardRowsByDueThenStable(left: LeaderBoardRow, right: LeaderBoardRow): number {
  const dueDiff = compareDisplayDueDateForSort(left.displayDue, right.displayDue);
  if (dueDiff !== 0) return dueDiff;
  const fs = left.fseiban.localeCompare(right.fseiban, 'ja');
  if (fs !== 0) return fs;
  const pn = toStableNumber(left.productNo) - toStableNumber(right.productNo);
  if (pn !== 0) return pn;
  const kj = toStableNumber(left.fkojun) - toStableNumber(right.fkojun);
  if (kj !== 0) return kj;
  return left.id.localeCompare(right.id, 'ja');
}

/**
 * 表示用納期の昇順。同日は製番・製造order・工順・id で安定ソート。
 * 納期なしは末尾（`compareDisplayDueDateForSort` と整合）。
 *
 * 順位ボードで行納期を変更したあとの並びは、サーバ再取得後の `displayDue` に依存する（ローカルで再ソートしない）。
 */
export function sortRowsByDisplayDue(rows: readonly LeaderBoardRow[]): LeaderBoardRow[] {
  return [...rows].sort(compareLeaderBoardRowsByDueThenStable);
}
