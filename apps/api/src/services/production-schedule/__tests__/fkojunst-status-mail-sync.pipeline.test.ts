import { describe, expect, it } from 'vitest';

import {
  buildFkojunstMailReplacementCreateInputs,
  buildFkojunstMailStatusKey,
  dedupeFkojunstMailRowsByLatest,
  FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_BY,
  parseFkojunstStatusMailFupdteDt,
  toFkojunstMailNormalizedRow,
  type FkojunstMailNormalizedRow,
} from '../fkojunst-status-mail-sync.pipeline.js';

describe('fkojunst-status-mail-sync.pipeline', () => {
  it('orders raw mail rows by ingest generation before CSV row ordinal', () => {
    expect(FKOJUNST_STATUS_MAIL_SOURCE_ROW_ORDER_BY).toEqual([
      { sourceIngestRun: { completedAt: 'asc' } },
      { sourceIngestRunStartedAt: 'asc' },
      { sourceRowOrdinal: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' }
    ]);
  });

  it('parses FUPDTEDT in MM/DD/YYYY HH:mm:ss as JST wall clock', () => {
    const d = parseFkojunstStatusMailFupdteDt('04/28/2026 13:05:09');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-04-28T04:05:09.000Z');
  });

  it('returns null for unparseable FUPDTEDT', () => {
    expect(parseFkojunstStatusMailFupdteDt('2026-04-28')).toBeNull();
    expect(parseFkojunstStatusMailFupdteDt('')).toBeNull();
  });

  it('parses FUPDTEDT as ISO8601 with Z', () => {
    const d = parseFkojunstStatusMailFupdteDt('2026-04-23T15:50:35Z');
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe('2026-04-23T15:50:35.000Z');
  });

  it('dedupes by key keeping first row when sourceUpdatedAt ties', () => {
    const first: FkojunstMailNormalizedRow = {
      sourceRowId: 'a',
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'P1',
      statusCode: 'S',
      sourceUpdatedAt: new Date('2026-01-01T00:00:00Z'),
      hasUnparseableDate: false
    };
    const second: FkojunstMailNormalizedRow = {
      ...first,
      sourceRowId: 'b',
      statusCode: 'R'
    };
    const out = dedupeFkojunstMailRowsByLatest([first, second]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('a');
    expect(out[0]!.statusCode).toBe('S');
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

  it('lets a later parseable row replace an older unparseable-date row for the same key', () => {
    const parseable: FkojunstMailNormalizedRow = {
      sourceRowId: 'a',
      sourceRowOrdinal: 2,
      sourceIngestRunStartedAt: new Date('2026-02-01T00:00:00Z'),
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
      sourceRowOrdinal: 1,
      sourceIngestRunStartedAt: new Date('2026-02-01T00:00:00Z'),
      statusCode: '?',
      sourceUpdatedAt: new Date('1970-01-01T00:00:00Z'),
      hasUnparseableDate: true,
    };
    const out = dedupeFkojunstMailRowsByLatest([unparseable, parseable]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('a');
    expect(out[0]!.statusCode).toBe('S');
  });

  it('uses the later source row when a newer row has an unparseable date for the same key', () => {
    const parseable: FkojunstMailNormalizedRow = {
      sourceRowId: 'a',
      sourceRowOrdinal: 1,
      sourceIngestRunStartedAt: new Date('2026-02-01T00:00:00Z'),
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'P1',
      statusCode: 'S',
      sourceUpdatedAt: new Date('2026-02-01T00:00:00Z'),
      hasUnparseableDate: false
    };
    const unparseable: FkojunstMailNormalizedRow = {
      ...parseable,
      sourceRowId: 'b',
      sourceRowOrdinal: 2,
      sourceIngestRunStartedAt: new Date('2026-02-01T00:00:00Z'),
      statusCode: '?',
      sourceUpdatedAt: new Date('1970-01-01T00:00:00Z'),
      hasUnparseableDate: true
    };
    const out = dedupeFkojunstMailRowsByLatest([parseable, unparseable]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('b');
    expect(out[0]!.statusCode).toBe('?');
  });

  it('uses sourceRowOrdinal order for DEDUP-updated rows even when createdAt order is older', () => {
    const parseable: FkojunstMailNormalizedRow = {
      sourceRowId: 'parseable-new-row-created-later',
      sourceRowOrdinal: 1,
      sourceIngestRunStartedAt: new Date('2026-02-02T00:00:00Z'),
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'P1',
      statusCode: 'R',
      sourceUpdatedAt: new Date('2026-02-01T00:00:00Z'),
      hasUnparseableDate: false
    };
    const unparseableDedupUpdatedExistingRow: FkojunstMailNormalizedRow = {
      ...parseable,
      sourceRowId: 'unparseable-existing-row-created-earlier',
      sourceRowOrdinal: 2,
      sourceIngestRunStartedAt: new Date('2026-02-02T00:00:00Z'),
      statusCode: 'S',
      sourceUpdatedAt: new Date('1970-01-01T00:00:00Z'),
      hasUnparseableDate: true
    };
    const out = dedupeFkojunstMailRowsByLatest([parseable, unparseableDedupUpdatedExistingRow]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('unparseable-existing-row-created-earlier');
    expect(out[0]!.hasUnparseableDate).toBe(true);
  });

  it('uses ingest generation before sourceRowOrdinal across multiple DEDUP imports', () => {
    const oldParseableHighOrdinal: FkojunstMailNormalizedRow = {
      sourceRowId: 'old-parseable-row-100',
      sourceIngestRunStartedAt: new Date('2026-02-01T00:00:00Z'),
      sourceIngestRunCompletedAt: new Date('2026-02-01T00:10:00Z'),
      sourceRowOrdinal: 100,
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'P1',
      statusCode: 'R',
      sourceUpdatedAt: new Date('2026-02-01T00:00:00Z'),
      hasUnparseableDate: false
    };
    const newUnparseableLowOrdinal: FkojunstMailNormalizedRow = {
      ...oldParseableHighOrdinal,
      sourceRowId: 'new-unparseable-row-1',
      sourceIngestRunStartedAt: new Date('2026-02-02T00:00:00Z'),
      sourceIngestRunCompletedAt: new Date('2026-02-02T00:10:00Z'),
      sourceRowOrdinal: 1,
      statusCode: 'S',
      sourceUpdatedAt: new Date('1970-01-01T00:00:00Z'),
      hasUnparseableDate: true
    };
    const out = dedupeFkojunstMailRowsByLatest([oldParseableHighOrdinal, newUnparseableLowOrdinal]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('new-unparseable-row-1');
    expect(out[0]!.hasUnparseableDate).toBe(true);
  });

  it('uses completedAt generation before startedAt when concurrent imports finish out of start order', () => {
    const startedLaterCompletedEarlier: FkojunstMailNormalizedRow = {
      sourceRowId: 'started-later-completed-earlier',
      sourceIngestRunStartedAt: new Date('2026-02-02T00:00:00Z'),
      sourceIngestRunCompletedAt: new Date('2026-02-02T00:05:00Z'),
      sourceRowOrdinal: 100,
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'P1',
      statusCode: 'R',
      sourceUpdatedAt: new Date('2026-02-02T00:00:00Z'),
      hasUnparseableDate: false
    };
    const startedEarlierCompletedLater: FkojunstMailNormalizedRow = {
      ...startedLaterCompletedEarlier,
      sourceRowId: 'started-earlier-completed-later',
      sourceIngestRunStartedAt: new Date('2026-02-01T00:00:00Z'),
      sourceIngestRunCompletedAt: new Date('2026-02-02T00:10:00Z'),
      sourceRowOrdinal: 1,
      statusCode: 'S',
      sourceUpdatedAt: new Date('1970-01-01T00:00:00Z'),
      hasUnparseableDate: true
    };
    const out = dedupeFkojunstMailRowsByLatest([
      startedLaterCompletedEarlier,
      startedEarlierCompletedLater
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('started-earlier-completed-later');
  });

  it('lets a post-migration parseable row replace a legacy unparseable row without source order metadata', () => {
    const legacyUnparseable: FkojunstMailNormalizedRow = {
      sourceRowId: 'legacy-bad',
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'P1',
      statusCode: 'C',
      sourceUpdatedAt: new Date('1970-01-01T00:00:00Z'),
      hasUnparseableDate: true
    };
    const newParseable: FkojunstMailNormalizedRow = {
      sourceRowId: 'new-good',
      sourceRowOrdinal: 1,
      sourceIngestRunStartedAt: new Date('2026-02-02T00:00:00Z'),
      sourceIngestRunCompletedAt: new Date('2026-02-02T00:10:00Z'),
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'P1',
      statusCode: 'S',
      sourceUpdatedAt: new Date('2026-02-02T00:00:00Z'),
      hasUnparseableDate: false
    };

    const out = dedupeFkojunstMailRowsByLatest([legacyUnparseable, newParseable]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('new-good');
    expect(out[0]!.statusCode).toBe('S');
  });

  it('keeps unparseable rows conservative when sourceRowOrdinal is missing', () => {
    const parseable: FkojunstMailNormalizedRow = {
      sourceRowId: 'a',
      sourceRowOrdinal: null,
      fkojun: '1',
      fkoteicd: 'R1',
      fsezono: 'P1',
      statusCode: 'S',
      sourceUpdatedAt: new Date('2026-02-01T00:00:00Z'),
      hasUnparseableDate: false
    };
    const unparseable: FkojunstMailNormalizedRow = {
      ...parseable,
      sourceRowId: 'b',
      statusCode: '?',
      sourceUpdatedAt: new Date('1970-01-01T00:00:00Z'),
      hasUnparseableDate: true
    };
    const out = dedupeFkojunstMailRowsByLatest([unparseable, parseable]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('b');
    expect(out[0]!.statusCode).toBe('?');
  });

  it('normalizes valid S/R/C/P/X/O; C/X は外部完了、O/P は一覧非表示・未完了（異常・空は隠しセンチネル）', () => {
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
