import { describe, expect, it } from 'vitest';

import { parseJstDate, resolveUpdatedAt } from '../csv-dashboard-updated-at.js';

describe('parseJstDate', () => {
  it('interprets "YYYY/M/D H:mm" as JST regardless of the process timezone', () => {
    expect(parseJstDate('2026/1/5 9:07')?.toISOString()).toBe('2026-01-05T00:07:00.000Z');
  });

  it('treats a date-only value as JST midnight (previous day in UTC)', () => {
    expect(parseJstDate('2026/03/01')?.toISOString()).toBe('2026-02-28T15:00:00.000Z');
  });

  it('trims surrounding whitespace', () => {
    expect(parseJstDate('  2026/12/31 23:59  ')?.toISOString()).toBe('2026-12-31T14:59:00.000Z');
  });

  it('returns Date instances unchanged', () => {
    const value = new Date('2026-01-01T00:00:00Z');
    expect(parseJstDate(value)).toBe(value);
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['ISO with dashes', '2026-01-05'],
    ['ISO datetime', '2026-01-05T09:00:00+09:00'],
    ['seconds included', '2026/01/05 09:00:00'],
    ['full-width digits', '２０２６/１/５'],
    ['Japanese era', '令和8/1/5'],
    ['two-digit year', '26/1/5'],
  ])('returns null for unsupported %s strings', (_label, value) => {
    expect(parseJstDate(value)).toBeNull();
  });

  it.each([[20260105], [null], [undefined], [{}]])('returns null for non-string non-Date value %j', value => {
    expect(parseJstDate(value)).toBeNull();
  });

  it('rolls over out-of-range components instead of rejecting them', () => {
    // NOTE: possible bug: month 13 / day 32 / hour 25 are accepted via Date.UTC overflow rather than rejected.
    expect(parseJstDate('2026/13/1')?.toISOString()).toBe('2026-12-31T15:00:00.000Z');
    expect(parseJstDate('2026/2/30')?.toISOString()).toBe('2026-03-01T15:00:00.000Z');
    expect(parseJstDate('2026/1/1 25:00')?.toISOString()).toBe('2026-01-01T16:00:00.000Z');
  });
});

describe('resolveUpdatedAt', () => {
  const fallback = new Date('2020-01-01T00:00:00Z');

  it('uses rowData.updatedAt when parseable', () => {
    expect(resolveUpdatedAt({ updatedAt: '2026/4/1 8:30' }, fallback).toISOString()).toBe('2026-03-31T23:30:00.000Z');
  });

  it.each([
    ['missing updatedAt', { other: 'x' }],
    ['unparseable updatedAt', { updatedAt: 'yesterday' }],
    ['null rowData', null],
    ['array rowData', ['2026/4/1']],
    ['string rowData', '2026/4/1'],
  ])('falls back for %s', (_label, rowData) => {
    expect(resolveUpdatedAt(rowData as never, fallback)).toBe(fallback);
  });
});
