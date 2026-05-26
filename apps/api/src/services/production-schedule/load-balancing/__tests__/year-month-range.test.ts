import { describe, expect, it } from 'vitest';

import { listYearMonthsInclusive, parseYearMonthRangeInclusive } from '../year-month-range.js';

describe('year-month-range', () => {
  it('lists inclusive months between from and to', () => {
    expect(listYearMonthsInclusive('2026-01', '2026-03')).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('rejects ranges wider than maxMonths', () => {
    expect(() =>
      parseYearMonthRangeInclusive({ fromMonth: '2026-01', toMonth: '2027-02', maxMonths: 12 })
    ).toThrow(/最大 12/);
  });

  it('rejects fromMonth after toMonth', () => {
    expect(() => listYearMonthsInclusive('2026-05', '2026-04')).toThrow(/以前/);
  });
});
