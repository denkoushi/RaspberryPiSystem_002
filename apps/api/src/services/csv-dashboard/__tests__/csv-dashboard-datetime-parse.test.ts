import { describe, expect, it } from 'vitest';

import {
  parseCsvDashboardDateColumnToUtc,
  parseFkojunstStatusMailFupdteDt,
} from '../csv-dashboard-datetime-parse.js';

describe('csv-dashboard-datetime-parse', () => {
  describe('parseFkojunstStatusMailFupdteDt', () => {
    it('parses US-style MM/DD/YYYY HH:mm:ss (local components)', () => {
      const d = parseFkojunstStatusMailFupdteDt('04/28/2026 13:05:09');
      expect(d).not.toBeNull();
      expect(d!.getFullYear()).toBe(2026);
      expect(d!.getMonth()).toBe(3);
      expect(d!.getDate()).toBe(28);
      expect(d!.getHours()).toBe(13);
      expect(d!.getMinutes()).toBe(5);
    });

    it('parses ISO8601 with Z', () => {
      const d = parseFkojunstStatusMailFupdteDt('2026-04-23T15:50:35Z');
      expect(d).not.toBeNull();
      expect(d!.toISOString()).toBe('2026-04-23T15:50:35.000Z');
    });

    it('parses ISO8601 without Z (local interpretation per Date.parse)', () => {
      const d = parseFkojunstStatusMailFupdteDt('2026-04-23T15:50:35');
      expect(d).not.toBeNull();
      expect(Number.isNaN(d!.getTime())).toBe(false);
    });

    it('rejects date-only ISO (ambiguous for FUPDTEDT)', () => {
      expect(parseFkojunstStatusMailFupdteDt('2026-04-28')).toBeNull();
    });

    it('returns null for empty and garbage', () => {
      expect(parseFkojunstStatusMailFupdteDt('')).toBeNull();
      expect(parseFkojunstStatusMailFupdteDt('not-a-date')).toBeNull();
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
