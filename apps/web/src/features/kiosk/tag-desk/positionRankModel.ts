import type { TagDeskRow } from '../../../api/domains/tag-desk';
import type { KnowledgePositionRank, KnowledgePositionRanksRequest, KnowledgePositionRanksResponse } from '@raspi-system/shared-types';

export const POSITION_RUNGS = [
  { rank: 'executive', label: '役員相当' },
  { rank: 'general_manager', label: '部長相当' },
  { rank: 'manager', label: '課長相当' },
  { rank: 'section_chief', label: '係長相当' },
  { rank: 'leader', label: '班長相当' },
  { rank: 'general', label: '一般' }
] as const satisfies ReadonlyArray<{ rank: KnowledgePositionRank; label: string }>;

export type PositionRankRow = { positionName: string; employeeCount: number; rank: KnowledgePositionRank | null };

export function positionRankRows(mapping: KnowledgePositionRanksResponse, employees: Pick<TagDeskRow, 'positionName'>[]): PositionRankRow[] {
  const counts = new Map<string, number>();
  for (const employee of employees) {
    if (employee.positionName) counts.set(employee.positionName, (counts.get(employee.positionName) ?? 0) + 1);
  }
  const ranks = new Map(mapping.ranks.map(row => [row.positionName, row.rank]));
  const names = new Set([...ranks.keys(), ...mapping.unmappedPositions.map(row => row.positionName), ...counts.keys()]);
  return [...names].sort((a, b) => a.localeCompare(b, 'ja')).map(positionName => ({
    positionName, rank: ranks.get(positionName) ?? null,
    employeeCount: counts.get(positionName) ?? mapping.unmappedPositions.find(row => row.positionName === positionName)?.employeeCount ?? 0
  }));
}

export function positionsOnRank(rows: PositionRankRow[], rank: KnowledgePositionRank | null) {
  return rows.filter(row => row.rank === rank);
}

export function rankSummary(rows: PositionRankRow[], employeeTotal: number) {
  const approvers = rows.reduce((sum, row) => sum + (row.rank !== null && row.rank !== 'general' ? row.employeeCount : 0), 0);
  return { approvers, nonApprovers: employeeTotal - approvers, unsetPositions: positionsOnRank(rows, null).length };
}

export function changedPositions(rows: PositionRankRow[], saved: PositionRankRow[]) {
  const baseline = new Map(saved.map(row => [row.positionName, row.rank]));
  return rows.filter(row => row.rank !== baseline.get(row.positionName)).map(row => row.positionName);
}

export function positionRanksPayload(rows: PositionRankRow[]): KnowledgePositionRanksRequest {
  return { ranks: rows.flatMap(({ positionName, rank }) => rank === null ? [] : [{ positionName, rank }]) };
}

export function movePosition(rows: PositionRankRow[], positionName: string, rank: KnowledgePositionRank) {
  return rows.map(row => row.positionName === positionName ? { ...row, rank } : row);
}

export function adjacentRank(rank: KnowledgePositionRank | null, direction: 'ArrowUp' | 'ArrowDown'): KnowledgePositionRank | null {
  const index = POSITION_RUNGS.findIndex(rung => rung.rank === rank);
  const next = index === -1 ? POSITION_RUNGS.length - 1 : index + (direction === 'ArrowUp' ? -1 : 1);
  return POSITION_RUNGS[next]?.rank ?? null;
}
