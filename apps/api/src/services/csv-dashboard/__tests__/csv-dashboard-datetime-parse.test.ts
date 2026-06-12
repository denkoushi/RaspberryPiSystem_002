import { describe, expect, it } from 'vitest';

import { parseCsvDashboardDateColumnToUtc } from '../csv-dashboard-datetime-parse.js';
import { parseFkojunstStatusMailFupdteDt } from '../fkojunst-status-mail-fupdtedt-parse.js';

describe('csv-dashboard-datetime-parse', () => {
  describe('parseFkojunstStatusMailFupdteDt re-export', () => {
    it('delegates to JST wall-clock parser', () => {
      const d = parseFkojunstStatusMailFupdteDt('04/28/2026 13:05:09');
      expect(d!.toISOString()).toBe('2026-04-28T04:05:09.000Z');
    });
  });

  describe('parseCsvDashboardDateColumnToUtc', () => {
    it('parses YYYY/M/D as JST midnight → UTC', () => {
      const d = parseCsvDashboardDateColumnToUtc('2026/1/8');
      expect(d).not.toBeNull();
      expect(d!.toISOString()).toBe('2026-01-07T15:00:00.000Z');
    });

    it('parses YYYY/M/D H:M as JST wall time → UTC', () => {
      const d = parseCsvDashboardDateColumnToUtc('2026/1/8 8:13');
      expect(d).not.toBeNull();
      expect(d!.toISOString()).toBe('2026-01-07T23:13:00.000Z');
    });

    it('parses ISO8601 with Z as absolute instant', () => {
      const d = parseCsvDashboardDateColumnToUtc('2026-05-01T02:35:51Z');
      expect(d).not.toBeNull();
      expect(d!.toISOString()).toBe('2026-05-01T02:35:51.000Z');
    });

    it('returns null for unparseable', () => {
      expect(parseCsvDashboardDateColumnToUtc('')).toBeNull();
      expect(parseCsvDashboardDateColumnToUtc('01/02/2026')).toBeNull();
    });
  });
});
