import { describe, expect, it } from 'vitest';

import { minuteToTimeText, numberOrNull, planSignalUpload, timeTextToMinute } from './machineSignalAdminModel';

describe('machineSignalAdminModel', () => {
  it('converts between minutes and a clock text', () => {
    expect(minuteToTimeText(495)).toBe('08:15');
    expect(minuteToTimeText(null)).toBe('');
    expect(timeTextToMinute('08:15')).toBe(495);
    expect(timeTextToMinute('')).toBeNull();
    expect(timeTextToMinute('24:00')).toBeNull();
  });

  it('reads an optional non-negative number', () => {
    expect(numberOrNull('')).toBeNull();
    expect(numberOrNull('7.5')).toBe(7.5);
    expect(numberOrNull('-1')).toBeNull();
    expect(numberOrNull('abc')).toBeNull();
  });

  it('keeps only daily report files and splits them into batches of fifty', () => {
    const files = [
      ...Array.from({ length: 120 }, (_, index) => ({ name: `DailySummary_Signal${index + 1}_20241001.csv` })),
      { name: 'desktop.ini' },
      { name: 'memo.csv' }
    ];
    const plan = planSignalUpload(files);
    expect(plan.batches.map((batch) => batch.length)).toEqual([50, 50, 20]);
    expect(plan.ignored).toBe(2);
  });
});
