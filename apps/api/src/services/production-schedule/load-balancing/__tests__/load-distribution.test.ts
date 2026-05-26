import { describe, expect, it } from 'vitest';

import { distributeRowLoadEvenly, resolveDailyAvailableMinutes } from '../load-distribution.js';
import { parseUtcDateKey } from '../work-calendar-policy.js';

describe('load-distribution', () => {
  it('distributes row load evenly across weekdays', () => {
    const allocations = distributeRowLoadEvenly({
      row: {
        rowId: 'r1',
        resourceCd: '021',
        totalMinutes: 100,
        plannedStartDate: parseUtcDateKey('2026-05-04'),
        effectiveDueDate: parseUtcDateKey('2026-05-08')
      },
      workCalendarMode: 'weekdays'
    });
    expect(allocations).toHaveLength(5);
    const sum = allocations.reduce((acc, item) => acc + item.minutes, 0);
    expect(sum).toBeCloseTo(100, 5);
    expect(allocations.every((item) => item.resourceCd === '021')).toBe(true);
  });

  it('resolves daily available minutes from monthly capacity', () => {
    const daily = resolveDailyAvailableMinutes({
      monthlyAvailableMinutes: 2000,
      yearMonth: '2026-05',
      workCalendarMode: 'weekdays'
    });
    expect(daily).not.toBeNull();
    expect(daily!).toBeGreaterThan(0);
  });
});
