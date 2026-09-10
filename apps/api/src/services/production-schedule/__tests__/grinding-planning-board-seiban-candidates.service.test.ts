import { describe, expect, it } from 'vitest';

import {
  resolveSeibanCandidateDateRange,
  todayJstYmd
} from '../grinding-planning-board-seiban-candidates.service.js';

describe('grinding planning board seiban candidate date range', () => {
  it('uses the JST calendar date, including the UTC boundary', () => {
    expect(todayJstYmd(new Date('2026-09-10T14:59:59.999Z'))).toBe('2026-09-10');
    expect(todayJstYmd(new Date('2026-09-10T15:00:00.000Z'))).toBe('2026-09-11');
  });

  it('clamps month-end when shifting one calendar month', () => {
    expect(resolveSeibanCandidateDateRange('2024-03-31')).toEqual({
      rangeStart: '2024-02-29',
      rangeEnd: '2024-04-30'
    });
    expect(resolveSeibanCandidateDateRange('2024-01-31')).toEqual({
      rangeStart: '2023-12-31',
      rangeEnd: '2024-02-29'
    });
  });
});
