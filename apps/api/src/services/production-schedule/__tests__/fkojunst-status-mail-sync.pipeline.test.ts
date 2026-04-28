import { describe, expect, it } from 'vitest';

import {
  buildFkojunstMailReplacementCreateInputs,
  buildFkojunstMailStatusKey,
  dedupeFkojunstMailRowsByLatest,
  parseFkojunstStatusMailFupdteDt,
  toFkojunstMailNormalizedRow,
  type FkojunstMailNormalizedRow,
} from '../fkojunst-status-mail-sync.pipeline.js';

describe('fkojunst-status-mail-sync.pipeline', () => {
  it('parses FUPDTEDT in MM/DD/YYYY HH:mm:ss', () => {
    const d = parseFkojunstStatusMailFupdteDt('04/28/2026 13:05:09');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(3);
    expect(d!.getDate()).toBe(28);
    expect(d!.getHours()).toBe(13);
    expect(d!.getMinutes()).toBe(5);
  });

  it('returns null for unparseable FUPDTEDT', () => {
    expect(parseFkojunstStatusMailFupdteDt('2026-04-28')).toBeNull();
    expect(parseFkojunstStatusMailFupdteDt('')).toBeNull();
  });

  it('dedupes by key keeping latest sourceUpdatedAt', () => {
    const older: FkojunstMailNormalizedRow = {
      sourceRowId: 'a',
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'P1',
      statusCode: 'S',
      sourceUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      hasUnparseableDate: false,
    };
    const newer: FkojunstMailNormalizedRow = {
      ...older,
      sourceRowId: 'b',
      statusCode: 'R',
      sourceUpdatedAt: new Date('2026-02-01T00:00:00Z'),
    };
    const out = dedupeFkojunstMailRowsByLatest([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('b');
    expect(out[0]!.statusCode).toBe('R');
  });

  it('prioritizes unparseable-date rows for the same key so uncertain rows stay hidden', () => {
    const parseable: FkojunstMailNormalizedRow = {
      sourceRowId: 'a',
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'P1',
      statusCode: 'S',
      sourceUpdatedAt: new Date('2026-02-01T00:00:00Z'),
      hasUnparseableDate: false,
    };
    const unparseable: FkojunstMailNormalizedRow = {
      ...parseable,
      sourceRowId: 'b',
      statusCode: '?',
      sourceUpdatedAt: new Date('1970-01-01T00:00:00Z'),
      hasUnparseableDate: true,
    };
    const out = dedupeFkojunstMailRowsByLatest([parseable, unparseable]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('b');
    expect(out[0]!.statusCode).toBe('?');
  });

  it('normalizes valid S/R/C/P/X/O and preserves invalid or empty status as hidden sentinels', () => {
    const base = {
      FKOJUN: '10',
      FKOTEICD: 'r01',
      FSEZONO: '0001',
      FUPDTEDT: '04/28/2026 00:00:00',
    };
    expect(toFkojunstMailNormalizedRow('1', { ...base, FKOJUNST: 's' }).row?.statusCode).toBe('S');
    expect(toFkojunstMailNormalizedRow('1', { ...base, FKOJUNST: 'O' }).row?.statusCode).toBe('O');
    expect(toFkojunstMailNormalizedRow('1', { ...base, FKOJUNST: '' }).row?.statusCode).toBe('');
    const bad = toFkojunstMailNormalizedRow('1', { ...base, FKOJUNST: 'Z' });
    expect(bad.row?.statusCode).toBe('?');
    expect(bad.skippedInvalidStatus).toBe(true);
  });

  it('keeps rows with unparseable dates as hidden sentinels', () => {
    const row = toFkojunstMailNormalizedRow('1', {
      FKOJUN: '10',
      FKOTEICD: 'r01',
      FSEZONO: '0001',
      FKOJUNST: 'S',
      FUPDTEDT: 'not-a-date',
    });
    expect(row.row).not.toBeNull();
    expect(row.row?.hasUnparseableDate).toBe(true);
    expect(row.skippedUnparseableDate).toBe(true);
  });

  it('buildFkojunstMailReplacementCreateInputs skips unmatched keys', () => {
    const row: FkojunstMailNormalizedRow = {
      sourceRowId: 's1',
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'PN',
      statusCode: 'S',
      sourceUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      hasUnparseableDate: false,
    };
    const key = buildFkojunstMailStatusKey({ fkojun: '1', fkoteicd: 'R1', fsezono: 'PN' });
    const winnerIdByKey = new Map([[key, 'winner-row']]);
    const { matched, unmatched, createInputs } = buildFkojunstMailReplacementCreateInputs([row], winnerIdByKey);
    expect(matched).toBe(1);
    expect(unmatched).toBe(0);
    expect(createInputs).toHaveLength(1);
    expect(createInputs[0]!.csvDashboardRowId).toBe('winner-row');

    const empty = buildFkojunstMailReplacementCreateInputs([row], new Map());
    expect(empty.matched).toBe(0);
    expect(empty.unmatched).toBe(1);
    expect(empty.createInputs).toHaveLength(0);
  });
});
