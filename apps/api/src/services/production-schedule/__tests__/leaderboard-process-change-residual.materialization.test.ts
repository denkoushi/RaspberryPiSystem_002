import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dedupeFkojunstMailRowsByLatest, type FkojunstMailNormalizedRow } from '../fkojunst-status-mail-sync.pipeline.js';
import {
  buildProcessChangeResidualStrongEvidenceFromDedupedRows,
  buildProcessChangeResidualStrongEvidenceKey,
  materializeProcessChangeResidualStrongEvidence,
  resetProcessChangeResidualStrongEvidenceMaterializationCacheForTests
} from '../leaderboard/leaderboard-process-change-residual.materialization.js';

beforeEach(() => {
  resetProcessChangeResidualStrongEvidenceMaterializationCacheForTests();
});

describe('leaderboard-process-change-residual.materialization key helper', () => {
  it('buildProcessChangeResidualStrongEvidenceKey normalizes resource cd', () => {
    expect(
      buildProcessChangeResidualStrongEvidenceKey({
        productNo: 'P1',
        fkojun: '210',
        resourceCd: '035'
      })
    ).toBe('P1\u0000210\u0000035');
  });
});

describe('buildProcessChangeResidualStrongEvidenceFromDedupedRows', () => {
  it('flags strong evidence when other resource completed at same FUPDTEDT and first row wins dedupe', () => {
    const sameAt = new Date('2026-04-13T13:02:46.000Z');
    const rows: FkojunstMailNormalizedRow[] = [
      {
        sourceRowId: 'old-s',
        fkojun: '210',
        fkoteicd: '1',
        fsezono: 'PCR0001',
        statusCode: 'S',
        sourceUpdatedAt: sameAt,
        hasUnparseableDate: false
      },
      {
        sourceRowId: 'new-r',
        fkojun: '210',
        fkoteicd: '1',
        fsezono: 'PCR0001',
        statusCode: 'R',
        sourceUpdatedAt: sameAt,
        hasUnparseableDate: false
      },
      {
        sourceRowId: 'other-c',
        fkojun: '210',
        fkoteicd: '2',
        fsezono: 'PCR0001',
        statusCode: 'C',
        sourceUpdatedAt: new Date('2026-05-12T06:46:56.000Z'),
        hasUnparseableDate: false
      }
    ];

    const deduped = dedupeFkojunstMailRowsByLatest(rows);
    expect(deduped.find((row) => row.fkoteicd === '1')?.sourceRowId).toBe('old-s');

    const materialization = buildProcessChangeResidualStrongEvidenceFromDedupedRows(deduped);
    expect(
      materialization.keys.has(
        buildProcessChangeResidualStrongEvidenceKey({
          productNo: 'PCR0001',
          fkojun: '210',
          resourceCd: '1'
        })
      )
    ).toBe(true);
  });

  it('does not flag when other resource completed before current S/R timestamp', () => {
    const rows: FkojunstMailNormalizedRow[] = [
      {
        sourceRowId: 'cur',
        fkojun: '210',
        fkoteicd: '1',
        fsezono: 'PCR0002',
        statusCode: 'R',
        sourceUpdatedAt: new Date('2026-05-12T06:46:56.000Z'),
        hasUnparseableDate: false
      },
      {
        sourceRowId: 'other',
        fkojun: '210',
        fkoteicd: '2',
        fsezono: 'PCR0002',
        statusCode: 'C',
        sourceUpdatedAt: new Date('2026-04-13T13:02:46.000Z'),
        hasUnparseableDate: false
      }
    ];

    const materialization = buildProcessChangeResidualStrongEvidenceFromDedupedRows(
      dedupeFkojunstMailRowsByLatest(rows)
    );
    expect(materialization.keys.size).toBe(0);
  });
});

describe('dedupeFkojunstMailRowsByLatest alignment', () => {
  it('unparseable latest row blocks parseable older row from winning', () => {
    const parseable: FkojunstMailNormalizedRow = {
      sourceRowId: 'a',
      fkojun: '210',
      fkoteicd: '1',
      fsezono: 'PCR0004',
      statusCode: 'R',
      sourceUpdatedAt: new Date('2026-04-13T13:02:46.000Z'),
      hasUnparseableDate: false
    };
    const unparseable: FkojunstMailNormalizedRow = {
      ...parseable,
      sourceRowId: 'b',
      statusCode: 'S',
      sourceUpdatedAt: new Date('1970-01-01T00:00:00.000Z'),
      hasUnparseableDate: true
    };
    const out = dedupeFkojunstMailRowsByLatest([parseable, unparseable]);
    expect(out).toHaveLength(1);
    expect(out[0]!.sourceRowId).toBe('b');
    expect(out[0]!.hasUnparseableDate).toBe(true);
  });
});

describe('materializeProcessChangeResidualStrongEvidence cache key', () => {
  it('reuses materialization by raw mail revision', async () => {
    const rowsRevision = '1:2026-04-23T00:00:00.000Z:2026-04-23T00:00:00.000Z';
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'raw-1',
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        rowData: {
          FKOJUN: '210',
          FKOTEICD: '1',
          FSEZONO: 'PCR-CACHE',
          FKOJUNST: 'S',
          FUPDTEDT: '2026-04-23T15:50:35.987'
        }
      }
    ]);
    const prisma = {
      csvDashboardRow: { findMany },
      $queryRaw: vi.fn()
    };

    const first = await materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: rowsRevision
    });
    const second = await materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: rowsRevision
    });

    expect(second).toBe(first);
    expect(first.rawMailRowsRevision).toBe(rowsRevision);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('stamps materialization with the revision observed from fetched raw rows', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'raw-1',
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-24T00:00:00.000Z'),
        rowData: {
          FKOJUN: '210',
          FKOTEICD: '1',
          FSEZONO: 'PCR-CACHE',
          FKOJUNST: 'S',
          FUPDTEDT: '2026-04-23T15:50:35.987'
        }
      }
    ]);
    const prisma = {
      csvDashboardRow: { findMany },
      $queryRaw: vi.fn()
    };

    const materialization = await materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: 'stale-requested-revision'
    });

    expect(materialization.rawMailRowsRevision).toBe(
      '1:2026-04-23T00:00:00.000Z:2026-04-24T00:00:00.000Z'
    );
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
