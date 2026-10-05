import { describe, expect, it } from 'vitest';

import { formatDueDateJa, formatShortPeriodLabel, formatTimeJa, isLatestPeriod, shiftPeriod } from './period';

describe('shiftPeriod', () => {
  it.each([
    ['2026-01', -1, '2025-12'],
    ['2025-12', 1, '2026-01'],
    ['2026-10', -1, '2026-09'],
    ['2026-10', 1, '2026-11'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2025-12-31', 1, '2026-01-01'],
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-03-01', -1, '2026-02-28'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2026-04-30', 1, '2026-05-01'],
    ['2026-10', 0, '2026-10']
  ])('%s を %s 期間動かすと %s', (period, delta, expected) => {
    expect(shiftPeriod(period, delta)).toBe(expected);
  });
  it.each(['invalid', '2026-13', '2026-02-30'])('無効な期間 %s は変えない', (period) => {
    expect(shiftPeriod(period, 1)).toBe(period);
  });
});

describe('isLatestPeriod', () => {
  const now = new Date('2026-10-05T03:00:00Z');
  it.each([
    ['2026-09', false], ['2026-10', true], ['2026-11', true],
    ['2026-10-04', false], ['2026-10-05', true], ['2026-10-06', true],
    ['invalid', true]
  ])('%s の次ボタン停止は %s', (period, expected) => {
    expect(isLatestPeriod(period, now)).toBe(expected);
  });
  it('年末と年始を比較する', () => {
    expect(isLatestPeriod('2025-12', new Date('2026-01-01T03:00:00Z'))).toBe(false);
    expect(isLatestPeriod('2025-12-31', new Date('2026-01-01T03:00:00Z'))).toBe(false);
  });
  it('日本時間の日付境界で判定する', () => {
    const justAfterMidnightJst = new Date('2026-10-31T15:30:00Z');
    expect(isLatestPeriod('2026-10', justAfterMidnightJst)).toBe(false);
    expect(isLatestPeriod('2026-10-31', justAfterMidnightJst)).toBe(false);
    expect(isLatestPeriod('2026-11-01', justAfterMidnightJst)).toBe(true);
  });
});

describe('表示ラベル', () => {
  it('指標の月/日ラベルを短くする', () => {
    expect(formatShortPeriodLabel('2026-10')).toBe('10月');
    expect(formatShortPeriodLabel('2026-10-05')).toBe('10/5');
  });
  it('時刻と期限はホストのタイムゾーンにかかわらず日本時間にする', () => {
    expect(formatTimeJa('2026-10-04T15:05:00Z')).toBe('00:05');
    expect(formatDueDateJa('2026-10-04T15:05:00Z')).toBe('10/05');
  });
});
