import { describe, expect, it } from 'vitest';

import { formatPlanningBoardDate } from './planningBoardDateLabel';

describe('formatPlanningBoardDate', () => {
  it('formats YYYY-MM-DD as MM/DD', () => {
    expect(formatPlanningBoardDate('2026-10-17')).toBe('10/17');
  });

  it('labels a missing date as undecided', () => {
    expect(formatPlanningBoardDate(null)).toBe('未定');
    expect(formatPlanningBoardDate('')).toBe('未定');
  });
});
