import { filterLeaderBoardRowsByCompletion, type LeaderOrderCompletionFilter } from './filterLeaderBoardRowsByCompletion';
import {
  buildSeibanMachineNameMapFromProgressBySeiban
} from './mergeMachineNameFallback';
import { normalizeLeaderBoardRow } from './normalizeLeaderBoardRow';
import { buildFseibanToMachineDisplayName } from './seibanMachineNameIndex';
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
  const machineNameBySeiban = buildFseibanToMachineDisplayName(scheduleRows);
  const fallbackBySeiban = buildSeibanMachineNameMapFromProgressBySeiban(progressBySeiban);
  const grouped = new Map<string, LeaderBoardRow[]>();

  for (const row of scheduleRows) {
    const normalized = normalizeLeaderBoardRow(row);
    if (!normalized) continue;

    let resolved = normalized.machineName.trim();
    if (resolved.length === 0) {
      const seiban = normalized.fseiban.trim();
      if (seiban.length > 0) {
        resolved = machineNameBySeiban.get(seiban)?.trim() ?? fallbackBySeiban.get(seiban)?.trim() ?? '';
      }
    }

    const nextRow =
      resolved.length > 0 && resolved !== normalized.machineName
        ? { ...normalized, machineName: resolved }
        : normalized;

    const list = grouped.get(nextRow.resourceCd);
    if (list) {
      list.push(nextRow);
    } else {
      grouped.set(nextRow.resourceCd, [nextRow]);
    }
  }

  return new Map([...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ja')));
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
