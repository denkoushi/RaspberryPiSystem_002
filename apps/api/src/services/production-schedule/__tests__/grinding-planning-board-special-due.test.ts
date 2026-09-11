import { describe, expect, it } from 'vitest';

import { resolveGrindingPlanningBoardSpecialDueExpiresAt } from '../grinding-planning-board-special-due.js';

describe('grinding-planning-board-special-due', () => {
  const fridayMorningJst = new Date('2026-09-10T21:00:00.000Z');

  it('expires 今日中 at the next JST midnight', () => {
    expect(resolveGrindingPlanningBoardSpecialDueExpiresAt({
      kind: 'today',
      now: fridayMorningJst
    }).toISOString()).toBe('2026-09-11T15:00:00.000Z');
  });

  it('uses the resolved calendar mode for 朝まで', () => {
    expect(resolveGrindingPlanningBoardSpecialDueExpiresAt({
      kind: 'overnight',
      now: fridayMorningJst,
      workCalendarMode: 'weekdays'
    }).toISOString()).toBe('2026-09-13T23:00:00.000Z');
    expect(resolveGrindingPlanningBoardSpecialDueExpiresAt({
      kind: 'overnight',
      now: fridayMorningJst,
      workCalendarMode: 'calendar_days'
    }).toISOString()).toBe('2026-09-11T23:00:00.000Z');
  });
});
