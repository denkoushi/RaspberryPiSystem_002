import { ORDER_NUMBERS } from '../productionSchedule/resourceColors';

import { LEADER_BOARD_AUTO_RANK_MAX_ASSIGNMENTS } from './constants';

import type { LeaderBoardRow } from './types';

export type LeaderBoardAutoRankAssignment = {
  rowId: string;
  resourceCd: string;
  orderNumber: number;
};

export type BuildLeaderBoardAutoRankAssignmentsParams = {
  resourceCd: string;
  sortedRows: readonly LeaderBoardRow[];
  usageNumbers: readonly number[] | undefined;
  maxAssignments?: number;
};

/** `order-usage` に無い番号を昇順に最大 `limit` 個返す。 */
export function pickAvailableOrderNumbers(
  usageNumbers: readonly number[] | undefined,
  limit: number
): number[] {
  if (limit <= 0) return [];
  const usage = new Set(usageNumbers ?? []);
  const out: number[] = [];
  for (const num of ORDER_NUMBERS) {
    if (usage.has(num)) continue;
    out.push(num);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * 表示順の未設定行（最大5件）へ、空き順位番号（1–10）を割当計画を生成する。
 * 既存 `processingOrder` がある行は対象外。
 */
export function buildLeaderBoardAutoRankAssignments(
  params: BuildLeaderBoardAutoRankAssignmentsParams
): LeaderBoardAutoRankAssignment[] {
  const resourceCd = params.resourceCd.trim();
  if (resourceCd.length === 0) return [];

  const maxAssignments = params.maxAssignments ?? LEADER_BOARD_AUTO_RANK_MAX_ASSIGNMENTS;
  const targetRows: LeaderBoardRow[] = [];
  for (const row of params.sortedRows) {
    if (row.resourceCd !== resourceCd) continue;
    if (row.processingOrder != null) continue;
    targetRows.push(row);
    if (targetRows.length >= maxAssignments) break;
  }

  const orderNumbers = pickAvailableOrderNumbers(params.usageNumbers, maxAssignments);
  const count = Math.min(targetRows.length, orderNumbers.length);
  const assignments: LeaderBoardAutoRankAssignment[] = [];
  for (let i = 0; i < count; i += 1) {
    assignments.push({
      rowId: targetRows[i].id,
      resourceCd,
      orderNumber: orderNumbers[i]
    });
  }
  return assignments;
}
