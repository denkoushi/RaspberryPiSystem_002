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

  it('parses minute list format with regular interval as intervalMinutes', () => {
    const parsed = parseCronSchedule('15,25,35,45,55 * * * 0,1,2,3,4,5,6');
    expect(parsed.mode).toBe('intervalMinutes');
    expect(parsed.intervalMinutes).toBe(10);
    expect(parsed.daysOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(parsed.isEditable).toBe(true);
  });

  it('parses minute list format with irregular interval as custom', () => {
    const parsed = parseCronSchedule('15,20,35,45 * * * 1,3');
    expect(parsed.mode).toBe('custom');
    expect(parsed.isEditable).toBe(false);
    expect(parsed.reason).toContain('分のリスト形式');
  });

  it('formats display labels for minute list format with regular interval', () => {
    // 規則的な間隔（10分間隔）は intervalMinutes モードとして表示される
    expect(formatScheduleForDisplay('15,25,35,45,55 * * * 0,1,2,3,4,5,6')).toBe('毎週日、月、火、水、木、金、土の10分ごと');
    expect(formatScheduleForDisplay('18,28,38,48,58 * * * 1,2,3,4,5')).toBe('毎週月、火、水、木、金の10分ごと');
  });

  it('formats display labels for minute list format with irregular interval', () => {
    // 規則的でない間隔は custom モードとして表示される
    expect(formatScheduleForDisplay('15,20,35,45 * * * 1,3')).toBe('毎週月、水の 15、20、35、45分');
  });
});
