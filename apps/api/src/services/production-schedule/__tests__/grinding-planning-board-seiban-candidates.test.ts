import { describe, expect, it } from 'vitest';

import {
  resolveSeibanCandidateDateRange,
  todayJstYmd
} from '../grinding-planning-board-seiban-candidates.service.js';

describe('grinding planning board seiban candidate date range', () => {
  it('uses the same calendar day one month before and after today', () => {
    expect(resolveSeibanCandidateDateRange('2026-09-11')).toEqual({
      rangeStart: '2026-08-11',
      rangeEnd: '2026-10-11'
    });
  });

  it('clamps a calendar day at month end', () => {
    expect(resolveSeibanCandidateDateRange('2026-03-31')).toEqual({
      rangeStart: '2026-02-28',
      rangeEnd: '2026-04-30'
    });
  });

  it('uses JST when deriving today', () => {
    expect(todayJstYmd(new Date('2026-09-10T15:00:00.000Z'))).toBe('2026-09-11');
  });
});
