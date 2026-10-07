import { describe, expect, it } from 'vitest';

import { adjacentRank, changedPositions, movePosition, positionRankRows, positionRanksPayload, positionsOnRank, rankSummary } from './positionRankModel';

const mapping = { ranks: [{ positionName: '班長', rank: 'leader' as const }, { positionName: '空席', rank: 'executive' as const }], unmappedPositions: [{ positionName: '主事', employeeCount: 2 }] };
const employees = [{ positionName: '班長' }, { positionName: '主事' }, { positionName: '主事' }, { positionName: null }];

describe('position rank ladder model', () => {
  it('unions positions, retains empty mappings and counts all employee positions', () => {
    const rows = positionRankRows(mapping, employees);
    expect(rows).toHaveLength(3);
    expect(positionsOnRank(rows, null)).toEqual([{ positionName: '主事', rank: null, employeeCount: 2 }]);
    expect(positionsOnRank(rows, 'executive')).toEqual([{ positionName: '空席', rank: 'executive', employeeCount: 0 }]);
    expect(rankSummary(rows, employees.length)).toEqual({ approvers: 1, nonApprovers: 3, unsetPositions: 1 });
  });
  it('counts net changes and updates approval totals without mutating the baseline', () => {
    const saved = positionRankRows(mapping, employees);
    const moved = movePosition(saved, '主事', 'general_manager');
    expect(changedPositions(moved, saved)).toEqual(['主事']);
    expect(rankSummary(moved, 4)).toEqual({ approvers: 3, nonApprovers: 1, unsetPositions: 0 });
    expect(positionsOnRank(saved, null)).toHaveLength(1);
    expect(changedPositions(movePosition(movePosition(saved, '班長', 'executive'), '班長', 'leader'), saved)).toEqual([]);
  });
  it('sends the entire mapping, excluding positions left unset', () => {
    const saved = positionRankRows(mapping, employees);
    expect(positionRanksPayload(saved).ranks).toEqual(expect.arrayContaining(mapping.ranks));
    expect(positionRanksPayload(saved).ranks).toHaveLength(2);
    expect(positionRanksPayload(movePosition(saved, '主事', 'general')).ranks).toContainEqual({ positionName: '主事', rank: 'general' });
  });
  it('moves one rung at a time and starts unset positions at general, like the mock', () => {
    expect(adjacentRank('leader', 'ArrowUp')).toBe('section_chief');
    expect(adjacentRank('general_manager', 'ArrowUp')).toBe('executive');
    expect(adjacentRank('executive', 'ArrowUp')).toBeNull();
    expect(adjacentRank('general', 'ArrowDown')).toBeNull();
    expect(adjacentRank(null, 'ArrowUp')).toBe('general');
    expect(adjacentRank(null, 'ArrowDown')).toBe('general');
  });
});
