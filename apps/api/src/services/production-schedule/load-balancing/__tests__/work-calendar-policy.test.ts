import { describe, expect, it } from 'vitest';

import {
  countActiveDaysInMonth,
  formatUtcDateKey,
  listActiveDaysInclusive,
  normalizeWorkCalendarMode,
  parseUtcDateKey
} from '../work-calendar-policy.js';

describe('work-calendar-policy', () => {
  it('normalizes work calendar mode', () => {
    expect(normalizeWorkCalendarMode('calendar_days')).toBe('calendar_days');
    expect(normalizeWorkCalendarMode('weekdays')).toBe('weekdays');
    expect(normalizeWorkCalendarMode('')).toBe('weekdays');
  });

  it('lists weekdays between start and end inclusive', () => {
    const start = parseUtcDateKey('2026-05-01');
    const end = parseUtcDateKey('2026-05-10');
    const days = listActiveDaysInclusive(start, end, 'weekdays');
    expect(days.map(formatUtcDateKey)).toEqual([
      '2026-05-01',
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
      '2026-05-08'
    ]);
  });

  it('counts active days in month for calendar_days', () => {
    expect(countActiveDaysInMonth('2026-02', 'calendar_days')).toBe(28);
    expect(countActiveDaysInMonth('2026-02', 'weekdays')).toBe(20);
  });
});
