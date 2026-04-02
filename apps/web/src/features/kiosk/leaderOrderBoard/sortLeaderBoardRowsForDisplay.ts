import { compareLeaderBoardRowsByDueThenStable } from './sortRowsByDisplayDue';

import type { LeaderBoardRow } from './types';

/**
 * 資源内表示順: `processingOrder` 付きを番号昇順で先に並べ、同日タイでは納期キーで安定化。
 * 未割当（null）は納期＋安定キーで並ぶ（すべて null のときは納期順に相当）。
 */
export function compareLeaderBoardRowsForDisplay(left: LeaderBoardRow, right: LeaderBoardRow): number {
  const oa = left.processingOrder;
  const ob = right.processingOrder;
  const hasA = oa != null;
  const hasB = ob != null;
  if (hasA && hasB) {
    if (oa !== ob) return oa! - ob!;
    return compareLeaderBoardRowsByDueThenStable(left, right);
  }
  if (hasA !== hasB) return hasA ? -1 : 1;
  return compareLeaderBoardRowsByDueThenStable(left, right);
}

export function sortLeaderBoardRowsForDisplay(rows: readonly LeaderBoardRow[]): LeaderBoardRow[] {
  return [...rows].sort(compareLeaderBoardRowsForDisplay);
}
