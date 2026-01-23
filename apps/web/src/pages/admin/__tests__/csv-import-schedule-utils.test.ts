import { describe, expect, it } from 'vitest';

import {
  formatCronSchedule,
  formatIntervalCronSchedule,
  formatScheduleForDisplay,
  parseCronSchedule
} from '../csv-import-schedule-utils';

describe('csv-import-schedule-utils', () => {
  it('parses interval cron schedules', () => {
    const parsed = parseCronSchedule('*/10 * * * *');
    expect(parsed.mode).toBe('intervalMinutes');
    expect(parsed.intervalMinutes).toBe(10);
    expect(parsed.daysOfWeek).toEqual([]);
    expect(parsed.isEditable).toBe(true);
  });

  it('parses time-of-day cron schedules', () => {
    const parsed = parseCronSchedule('15 4 * * 1,3');
    expect(parsed.mode).toBe('timeOfDay');
    expect(parsed.time).toBe('04:15');
    expect(parsed.daysOfWeek).toEqual([1, 3]);
  });

  it('marks unsupported cron schedules as custom', () => {
    const parsed = parseCronSchedule('0 4 1 * *');
    expect(parsed.mode).toBe('custom');
    expect(parsed.isEditable).toBe(false);
  });

  it('formats interval cron schedules', () => {
    expect(formatIntervalCronSchedule(10, [1, 3])).toBe('*/10 * * * 1,3');
  });

  it('formats time-of-day cron schedules', () => {
    expect(formatCronSchedule('04:00', [])).toBe('0 4 * * *');
  });

  it('formats display labels for interval schedules', () => {
    expect(formatScheduleForDisplay('*/10 * * * 1,3')).toBe('毎週月、水の10分ごと');
  });

  it('formats display labels for time schedules', () => {
    expect(formatScheduleForDisplay('0 4 * * *')).toBe('毎日午前4時');
  });
});
