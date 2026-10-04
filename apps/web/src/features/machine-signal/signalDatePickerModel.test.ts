import { describe, expect, it } from 'vitest';

import {
  addSignalDays, buildSignalMonthCells, buildSignalPresetRange, formatSignalPickerDay,
  formatSignalPickerRange, isSignalRangeAllowed, moveSignalMonth, normalizeSignalRange,
  signalRangeDayCount, signalRangeSelection
} from './signalDatePickerModel';

describe('signalDatePickerModel', () => {
  it('lays out a month from Sunday with leading and trailing empty cells', () => {
    const cells = buildSignalMonthCells('2026-10-01');
    expect(cells).toHaveLength(35);
    expect(cells.slice(0, 4)).toEqual([null, null, null, null]);
    expect(cells[4]).toBe('2026-10-01');
    expect(cells[34]).toBe('2026-10-31');
    expect(buildSignalMonthCells('2026-02-01')).toHaveLength(28);
    expect(buildSignalMonthCells('2024-02-01').filter(Boolean)).toHaveLength(29);
  });

  it('moves across years and counts an inclusive range', () => {
    expect(moveSignalMonth('2026-01-31', -1)).toBe('2025-12-01');
    expect(moveSignalMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(signalRangeDayCount('2026-09-02', '2026-10-01')).toBe(30);
  });

  it('normalizes reverse clicks and turns a single-day range into a day', () => {
    expect(normalizeSignalRange('2026-10-01', '2026-09-02')).toEqual({ from: '2026-09-02', to: '2026-10-01' });
    expect(signalRangeSelection(normalizeSignalRange('2026-10-01', '2026-10-01'))).toEqual({ mode: 'day', date: '2026-10-01' });
    expect(signalRangeSelection(normalizeSignalRange('2026-09-02', '2026-10-01'))).toEqual({ mode: 'range', from: '2026-09-02', to: '2026-10-01' });
  });

  it('builds presets relative to the last report, including previous year and leap month', () => {
    expect(buildSignalPresetRange('2026-10-01', '7')).toEqual({ from: '2026-09-25', to: '2026-10-01' });
    expect(buildSignalPresetRange('2026-10-01', '30')).toEqual({ from: '2026-09-02', to: '2026-10-01' });
    expect(buildSignalPresetRange('2026-10-15', 'month')).toEqual({ from: '2026-10-01', to: '2026-10-15' });
    expect(buildSignalPresetRange('2026-01-01', 'last')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(buildSignalPresetRange('2024-03-01', 'last')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('allows 92 inclusive days in either direction and disallows 93', () => {
    const first = '2026-07-02';
    expect(isSignalRangeAllowed(first, addSignalDays(first, 91))).toBe(true);
    expect(isSignalRangeAllowed(addSignalDays(first, 91), first)).toBe(true);
    expect(isSignalRangeAllowed(first, addSignalDays(first, 92))).toBe(false);
    expect(isSignalRangeAllowed(addSignalDays(first, 92), first)).toBe(false);
  });

  it('formats the approved day and range labels', () => {
    expect(formatSignalPickerDay('2026-10-01')).toBe('10/01（木）');
    expect(formatSignalPickerRange('2026-09-02', '2026-10-01')).toBe('9/2〜10/1（30日）');
  });

  it.each(['Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Honolulu'])('keeps calendar dates in %s, including a DST boundary', (timezone) => {
    const previous = process.env.TZ;
    process.env.TZ = timezone;
    try {
      expect(addSignalDays('2026-03-08', 1)).toBe('2026-03-09');
      expect(formatSignalPickerDay('2026-10-01')).toBe('10/01（木）');
      expect(buildSignalMonthCells('2026-10-01')[4]).toBe('2026-10-01');
      expect(signalRangeDayCount('2026-03-07', '2026-03-09')).toBe(3);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
