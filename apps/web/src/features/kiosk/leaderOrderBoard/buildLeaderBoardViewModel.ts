import { filterLeaderBoardRowsByCompletion, type LeaderOrderCompletionFilter } from './filterLeaderBoardRowsByCompletion';
import { groupRowsByResourceCd } from './groupRowsByResourceCd';
import {
  buildSeibanMachineNameMapFromProgressBySeiban,
  mergeMachineNameFallback
} from './mergeMachineNameFallback';
import { normalizeLeaderBoardRows } from './normalizeLeaderBoardRow';
import { sortLeaderBoardRowsForDisplay } from './sortLeaderBoardRowsForDisplay';

import type { LeaderBoardRow } from './types';
import type { ProductionScheduleRow } from '../../../api/client';

export type HistoryProgressBySeiban = Parameters<typeof buildSeibanMachineNameMapFromProgressBySeiban>[0];

/**
 * 生産スケジュール一覧行を資源 CD ごとにグルーピング（正規化・進捗由来の機種名補完込み）。
 */
export function buildLeaderBoardGroupedRows(
  scheduleRows: readonly ProductionScheduleRow[],
  progressBySeiban: HistoryProgressBySeiban | undefined
): Map<string, LeaderBoardRow[]> {
  const normalized = normalizeLeaderBoardRows([...scheduleRows]);
  const fb = buildSeibanMachineNameMapFromProgressBySeiban(progressBySeiban);
  const merged = mergeMachineNameFallback(normalized, fb);
  return groupRowsByResourceCd(merged);
}

/**
 * 完了フィルタ適用後、資源内表示順へソートしたマップ。
 */
export function buildLeaderBoardSortedGrouped(
  grouped: Map<string, LeaderBoardRow[]>,
  completionFilter: LeaderOrderCompletionFilter
): Map<string, LeaderBoardRow[]> {
  const m = new Map<string, LeaderBoardRow[]>();
  grouped.forEach((list, cd) => {
    const filtered = filterLeaderBoardRowsByCompletion(list, completionFilter);
    m.set(cd, sortLeaderBoardRowsForDisplay(filtered));
  });
  return m;
}
