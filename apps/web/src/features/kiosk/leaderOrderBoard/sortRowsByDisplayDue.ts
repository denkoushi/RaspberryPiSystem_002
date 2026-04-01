import { compareDisplayDueDateForSort } from '../productionSchedule/plannedDueDisplay';

import type { LeaderBoardRow } from './types';

const toStableNumber = (value: string): number => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return Number.MAX_SAFE_INTEGER;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

/**
 * 表示用納期の昇順。同日は製番・製造order・工順・id で安定ソート。
 * 納期なしは末尾（`compareDisplayDueDateForSort` と整合）。
 */
export function sortRowsByDisplayDue(rows: readonly LeaderBoardRow[]): LeaderBoardRow[] {
  return [...rows].sort((left, right) => {
    const dueDiff = compareDisplayDueDateForSort(left.displayDue, right.displayDue);
    if (dueDiff !== 0) return dueDiff;
    const fs = left.fseiban.localeCompare(right.fseiban, 'ja');
    if (fs !== 0) return fs;
    const pn = toStableNumber(left.productNo) - toStableNumber(right.productNo);
    if (pn !== 0) return pn;
    const kj = toStableNumber(left.fkojun) - toStableNumber(right.fkojun);
    if (kj !== 0) return kj;
    return left.id.localeCompare(right.id, 'ja');
  });
}
