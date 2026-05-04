import { compareLeaderBoardRowsForDisplay } from './sortLeaderBoardRowsForDisplay';

import type { LeaderBoardRow } from './types';

const UNKNOWN_SEIBAN_RANK = Number.MAX_SAFE_INTEGER;

/**
 * 評価モード: 製番のローカル順位を最優先し、同ランク内は {@link compareLeaderBoardRowsForDisplay} に委ねる。
 * ランク未登録の製番は末尾寄せ。
 */
export function compareLeaderBoardRowsForSeibanEvalDisplay(
  seibanRank: ReadonlyMap<string, number>,
  left: LeaderBoardRow,
  right: LeaderBoardRow
): number {
  const la = left.fseiban.trim();
  const lb = right.fseiban.trim();
  const ra = la.length > 0 ? (seibanRank.get(la) ?? UNKNOWN_SEIBAN_RANK) : UNKNOWN_SEIBAN_RANK;
  const rb = lb.length > 0 ? (seibanRank.get(lb) ?? UNKNOWN_SEIBAN_RANK) : UNKNOWN_SEIBAN_RANK;
  if (ra !== rb) return ra - rb;
  return compareLeaderBoardRowsForDisplay(left, right);
}

export function sortLeaderBoardRowsForSeibanEvalDisplay(
  rows: readonly LeaderBoardRow[],
  seibanRank: ReadonlyMap<string, number>
): LeaderBoardRow[] {
  return [...rows].sort((a, b) => compareLeaderBoardRowsForSeibanEvalDisplay(seibanRank, a, b));
}
