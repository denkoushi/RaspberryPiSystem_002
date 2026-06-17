import {
  computeLeaderBoardDisplayRequiredMinutes,
  type LeaderBoardRowLaborFields
} from './resolveLeaderBoardRowLaborMinutes';

import type { LeaderBoardRow } from './types';

export function withLeaderBoardDisplayRequiredMinutes(
  row: LeaderBoardRow,
  includeLabor: boolean
): LeaderBoardRow {
  return {
    ...row,
    requiredMinutes: computeLeaderBoardDisplayRequiredMinutes(
      row.machineRequiredMinutes,
      row.laborRequiredMinutes,
      includeLabor
    )
  };
}

export function applyLeaderBoardDisplayRequiredMinutesToRows(
  rows: readonly LeaderBoardRow[],
  includeLabor: boolean
): LeaderBoardRow[] {
  return rows.map((row) => withLeaderBoardDisplayRequiredMinutes(row, includeLabor));
}

export function applyLeaderBoardDisplayRequiredMinutesToGrouped(
  grouped: Map<string, LeaderBoardRow[]>,
  resourceCdBySlotIndex: readonly (string | null)[],
  laborEnabledBySlotIndex: readonly boolean[]
): Map<string, LeaderBoardRow[]> {
  const slotIndexByResourceCd = new Map<string, number>();
  resourceCdBySlotIndex.forEach((cdRaw, slotIndex) => {
    const cd = cdRaw?.trim() ?? '';
    if (!cd.length || slotIndexByResourceCd.has(cd)) return;
    slotIndexByResourceCd.set(cd, slotIndex);
  });

  const out = new Map<string, LeaderBoardRow[]>();
  grouped.forEach((rows, resourceCd) => {
    const slotIndex = slotIndexByResourceCd.get(resourceCd);
    const includeLabor = slotIndex != null ? Boolean(laborEnabledBySlotIndex[slotIndex]) : false;
    out.set(resourceCd, applyLeaderBoardDisplayRequiredMinutesToRows(rows, includeLabor));
  });
  return out;
}

export function leaderBoardRowLaborFieldsFromRow(row: LeaderBoardRow): LeaderBoardRowLaborFields {
  return {
    machineRequiredMinutes: row.machineRequiredMinutes,
    laborRequiredMinutes: row.laborRequiredMinutes
  };
}
