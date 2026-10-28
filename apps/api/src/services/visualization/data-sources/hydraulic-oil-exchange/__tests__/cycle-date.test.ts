import { describe, expect, it } from 'vitest';
import { exchangeDates, formatCyclePill, jstDate, normalizeCycle, parseCycle } from '../cycle-date.js';

const today = new Date('2026-10-28T00:00:00+09:00');
describe('hydraulic oil cycle and JST calendar dates', () => {
  it.each([
    ['毎日', 1, 'D'], ['週１回', 1, 'W'], ['２週に１回', 2, 'W'], ['月１回', 1, 'M'],
    ['３ヶ月１回', 3, 'M'], ['３か月１回', 3, 'M'], ['３カ月１回', 3, 'M'], ['３ヵ月１回', 3, 'M'],
    ['半年１回', 6, 'M'], ['年１回', 1, 'Y'], ['半年に１回', 6, 'M'], ['2日に1回', 2, 'D'],
    ['月に1回', 1, 'M'], ['2年に1回', 2, 'Y'],
    ['6M', 6, 'M'], ['12M', 12, 'M'], ['1Y', 1, 'Y'], ['3ヶ月', 3, 'M'],
    [' ６ｍ ', 6, 'M'], ['2D', 2, 'D'], ['2W', 2, 'W'], ['2日', 2, 'D'],
    ['2週', 2, 'W'], ['2か月', 2, 'M'], ['2カ月', 2, 'M'], ['2ヵ月', 2, 'M'], ['2月', 2, 'M'], ['2年', 2, 'Y'],
  ])('parses %s', (input, amount, unit) => {
    expect(parseCycle(input)).toEqual({ amount, unit });
  });
  it.each(['', '不明', '6', '1.5M', '-1M', '0M', '9007199254740992M', '0月1回', '月2回', '1.5ヶ月1回'])('rejects %s', (input) => {
    expect(parseCycle(input)).toBeNull();
    expect(exchangeDates(today, input, today)).toMatchObject({ state: 'unknown', remainingDays: null, nextDate: null });
  });
  it.each([
    ['2026-03-31', '半年１回', '2026-09-30'],
    ['2025-08-31', '6M', '2026-02-28'], ['2023-08-31', '6M', '2024-02-29'],
    ['2024-02-29', '12M', '2025-02-28'], ['2024-02-29', '1Y', '2025-02-28'],
    ['2026-01-31', '3ヶ月', '2026-04-30'], ['2026-10-28', '2W', '2026-11-11'],
    ['2026-10-28', '2D', '2026-10-30'],
  ])('%s + %s = %s', (last, cycle, nextDate) => {
    expect(exchangeDates(new Date(`${last}T00:00:00+09:00`), cycle, today).nextDate).toBe(nextDate);
  });
  it.each([[-1, 'overdue'], [0, 'soon'], [30, 'soon'], [31, 'ok']])('classifies remaining %i', (days, state) => {
    const last = new Date(today.getTime() + (Number(days) - 1) * 86_400_000);
    expect(exchangeDates(last, '1D', today)).toMatchObject({ remainingDays: days, state });
  });
  it.each([['半年１回', '6M'], ['年１回', 'Y'], ['３ヶ月１回', '3M'], ['２週に１回', '2W'],
    ['月１回', 'M'], ['週１回', 'W'], ['毎日', 'D'], ['6M', '6M'], ['1Y', 'Y'], ['1M', 'M'], ['1W', 'W'], ['1D', 'D']])('formats %s as %s', (cycle, expected) => {
    expect(formatCyclePill(cycle)).toBe(expected);
  });
  it('changes the JST date and remaining days exactly at 15:00Z', () => {
    const before = new Date('2026-10-27T14:59:59Z');
    const after = new Date('2026-10-27T15:00:00Z');
    expect(jstDate(before)).toBe('2026-10-27');
    expect(jstDate(after)).toBe('2026-10-28');
    expect(exchangeDates(before, '1D', before).remainingDays).toBe(1);
    expect(exchangeDates(before, '1D', after).remainingDays).toBe(0);
    expect(exchangeDates(after, '1D', after).lastDate).toBe('2026-10-28');
    expect(normalizeCycle(' ６ｍ ')).toBe('6M');
  });
});
