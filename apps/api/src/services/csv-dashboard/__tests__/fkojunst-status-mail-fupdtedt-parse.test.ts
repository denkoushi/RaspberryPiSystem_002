import { describe, expect, it } from 'vitest';

import {
  parseFkojunstStatusMailFupdteDt,
  wallClockJstToUtcDate
} from '../fkojunst-status-mail-fupdtedt-parse.js';

describe('fkojunst-status-mail-fupdtedt-parse', () => {
  it('parses US-style MM/DD/YYYY HH:mm:ss as JST wall clock', () => {
    const d = parseFkojunstStatusMailFupdteDt('04/28/2026 13:05:09');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-04-28T04:05:09.000Z');
  });

  it('parses ISO8601 with Z as absolute instant', () => {
    const d = parseFkojunstStatusMailFupdteDt('2026-04-23T15:50:35Z');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-04-23T15:50:35.000Z');
  });

  it('parses ISO8601 without offset as JST wall clock', () => {
    const d = parseFkojunstStatusMailFupdteDt('2026-04-23T15:50:35');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-04-23T06:50:35.000Z');
  });

  it('preserves fractional seconds on offset-less ISO wall clock', () => {
    const d = parseFkojunstStatusMailFupdteDt('2026-04-23T15:50:35.987');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-04-23T06:50:35.987Z');
  });

  it('preserves fractional seconds on Z-suffixed ISO', () => {
    const d = parseFkojunstStatusMailFupdteDt('2026-04-23T15:50:35.987Z');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-04-23T15:50:35.987Z');
  });

  it('rejects invalid calendar ISO before any cast', () => {
    expect(parseFkojunstStatusMailFupdteDt('2026-13-01T00:00:00')).toBeNull();
    expect(parseFkojunstStatusMailFupdteDt('2026-02-30T00:00:00Z')).toBeNull();
    expect(parseFkojunstStatusMailFupdteDt('2026-02-30T00:00:00+09:00')).toBeNull();
    expect(wallClockJstToUtcDate({ year: 2026, month: 13, day: 1, hour: 0, minute: 0, second: 0 })).toBeNull();
  });

  it('returns null for empty, garbage, and date-only ISO', () => {
    expect(parseFkojunstStatusMailFupdteDt('')).toBeNull();
    expect(parseFkojunstStatusMailFupdteDt('not-a-date')).toBeNull();
    expect(parseFkojunstStatusMailFupdteDt('2026-04-23T15:50:35 garbage')).toBeNull();
    expect(parseFkojunstStatusMailFupdteDt('2026-04-28')).toBeNull();
  });
});
