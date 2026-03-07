import { describe, expect, it } from 'vitest';

import { deriveGlobalRankFlags, movePriorityItem, normalizeDueDateInput } from './dueManagement';

describe('dueManagement utilities', () => {
  it('normalizeDueDateInput extracts YYYY-MM-DD', () => {
    expect(normalizeDueDateInput('2026-03-10T00:00:00.000Z')).toBe('2026-03-10');
    expect(normalizeDueDateInput('2026-03-10')).toBe('2026-03-10');
    expect(normalizeDueDateInput(null)).toBe('');
    expect(normalizeDueDateInput('invalid')).toBe('');
  });

  it('movePriorityItem moves selected element by direction', () => {
    expect(movePriorityItem(['A', 'B', 'C'], 1, -1)).toEqual(['B', 'A', 'C']);
    expect(movePriorityItem(['A', 'B', 'C'], 1, 1)).toEqual(['A', 'C', 'B']);
    expect(movePriorityItem(['A', 'B', 'C'], 0, -1)).toEqual(['A', 'B', 'C']);
    expect(movePriorityItem(['A', 'B', 'C'], 2, 1)).toEqual(['A', 'B', 'C']);
  });

  it('deriveGlobalRankFlags normalizes today/carryover flags', () => {
    expect(deriveGlobalRankFlags({ isInTodayTriage: true, isCarryover: false })).toEqual({
      isInTodayTriage: true,
      isCarryover: false,
      isOutOfToday: false
    });
    expect(deriveGlobalRankFlags({ isInTodayTriage: false, isCarryover: true })).toEqual({
      isInTodayTriage: false,
      isCarryover: true,
      isOutOfToday: true
    });
    expect(deriveGlobalRankFlags({ isInTodayTriage: true, isCarryover: true })).toEqual({
      isInTodayTriage: false,
      isCarryover: true,
      isOutOfToday: true
    });
  });
});
