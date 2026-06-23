import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dedupeFkojunstMailRowsByLatest, type FkojunstMailNormalizedRow } from '../fkojunst-status-mail-sync.pipeline.js';
import {
  buildProcessChangeResidualEvidenceCreateInputs,
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
  it('uses persisted evidence when the raw mail revision matches', async () => {
    const rowsRevision = '3:2026-04-23T00:00:00.000Z:2026-04-24T00:00:00.000Z';
    const queryRaw = vi.fn();
    const findUnique = vi.fn().mockResolvedValue({
      rawMailRowsRevision: rowsRevision,
      algorithmVersion: 1,
      evidenceCount: 1
    });
    const findMany = vi.fn().mockResolvedValue([
      {
        productNo: 'PCR-PERSISTED',
        fkojun: '210',
        resourceCd: '1',
        currentStatusCode: 'R',
        currentSourceUpdatedAt: new Date('2026-04-23T15:50:35.000Z'),
        completedOtherResourceCd: '2',
        completedOtherStatusCode: 'C',
        completedOtherSourceUpdatedAt: new Date('2026-04-24T15:50:35.000Z')
      }
    ]);
    const telemetry = vi.fn();
    const prisma = {
      $queryRaw: queryRaw,
      productionScheduleProcessChangeResidualSnapshot: { findUnique },
      productionScheduleProcessChangeResidualEvidence: { findMany }
    };

    const materialization = await materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: rowsRevision,
      telemetry
    });

    expect(queryRaw).not.toHaveBeenCalled();
    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(materialization.rawMailRowsRevision).toBe(rowsRevision);
    expect(
      materialization.keys.has(
        buildProcessChangeResidualStrongEvidenceKey({
          productNo: 'PCR-PERSISTED',
          fkojun: '210',
          resourceCd: '1'
        })
      )
    ).toBe(true);
    expect(telemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheHit: false,
        persistedHit: true,
        persistedEvidenceRowCount: 1,
        strongEvidenceKeyCount: 1
      })
    );
  });

  it('falls back to raw rows when persisted evidence revision is stale', async () => {
    const requestedRevision = 'requested-revision';
    const observedRevision = '1:2026-04-23T00:00:00.000Z:2026-04-24T00:00:00.000Z';
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: 'raw-1',
        FKOJUN: '210',
        FKOTEICD: '1',
        FSEZONO: 'PCR-CACHE',
        FKOJUNST: 'S',
        FUPDTEDT: '2026-04-23T15:50:35.987',
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-24T00:00:00.000Z'),
        sourceRowOrdinal: 1,
        sourceIngestRunStartedAt: null,
        sourceIngestRunCompletedAt: null
      }
    ]);
    const findUnique = vi.fn().mockResolvedValue({
      rawMailRowsRevision: 'stale-revision',
      algorithmVersion: 1,
      evidenceCount: 1
    });
    const findMany = vi.fn();
    const prisma = {
      $queryRaw: queryRaw,
      productionScheduleProcessChangeResidualSnapshot: { findUnique },
      productionScheduleProcessChangeResidualEvidence: { findMany }
    };

    const materialization = await materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: requestedRevision
    });

    expect(findUnique).toHaveBeenCalledTimes(1);
    expect(findMany).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(materialization.rawMailRowsRevision).toBe(observedRevision);
  });

  it('reuses materialization by raw mail revision', async () => {
    const rowsRevision = '1:2026-04-23T00:00:00.000Z:2026-04-23T00:00:00.000Z';
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: 'raw-1',
        FKOJUN: '210',
        FKOTEICD: '1',
        FSEZONO: 'PCR-CACHE',
        FKOJUNST: 'S',
        FUPDTEDT: '2026-04-23T15:50:35.987',
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: null,
        sourceRowOrdinal: 1,
        sourceIngestRunStartedAt: null,
        sourceIngestRunCompletedAt: null
      }
    ]);
    const prisma = {
      $queryRaw: queryRaw
    };

    const first = await materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: rowsRevision
    });
    const second = await materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: rowsRevision
    });

    expect(second).toBe(first);
    expect(first.rawMailRowsRevision).toBe(rowsRevision);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('emits cache-hit telemetry without refetching source rows', async () => {
    const rowsRevision = '1:2026-04-23T00:00:00.000Z:2026-04-23T00:00:00.000Z';
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: 'raw-1',
        FKOJUN: '210',
        FKOTEICD: '1',
        FSEZONO: 'PCR-CACHE',
        FKOJUNST: 'S',
        FUPDTEDT: '2026-04-23T15:50:35.987',
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: null,
        sourceRowOrdinal: 1,
        sourceIngestRunStartedAt: null,
        sourceIngestRunCompletedAt: null
      }
    ]);
    const prisma = {
      $queryRaw: queryRaw
    };
    const telemetry = vi.fn();

    await materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: rowsRevision
    });
    await materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: rowsRevision,
      telemetry
    });

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(telemetry).toHaveBeenCalledWith({
      cacheHit: true,
      strongEvidenceKeyCount: 0
    });
  });

  it('shares an in-flight materialization across concurrent calls', async () => {
    const rowsRevision = '1:2026-04-23T00:00:00.000Z:2026-04-23T00:00:00.000Z';
    let resolveRows: (rows: unknown[]) => void = () => {};
    const rowsPromise = new Promise<unknown[]>((resolve) => {
      resolveRows = resolve;
    });
    const queryRaw = vi.fn().mockReturnValue(rowsPromise);
    const prisma = {
      $queryRaw: queryRaw
    };
    const firstTelemetry = vi.fn();
    const secondTelemetry = vi.fn();

    const first = materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: rowsRevision,
      telemetry: firstTelemetry
    });
    const second = materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: rowsRevision,
      telemetry: secondTelemetry
    });

    await Promise.resolve();

    expect(queryRaw).toHaveBeenCalledTimes(1);
    resolveRows([
      {
        id: 'raw-1',
        FKOJUN: '210',
        FKOTEICD: '1',
        FSEZONO: 'PCR-CACHE',
        FKOJUNST: 'S',
        FUPDTEDT: '2026-04-23T15:50:35.987',
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: null,
        sourceRowOrdinal: 1,
        sourceIngestRunStartedAt: null,
        sourceIngestRunCompletedAt: null
      }
    ]);

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult).toBe(firstResult);
    expect(firstResult.rawMailRowsRevision).toBe(rowsRevision);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(firstTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheHit: false,
        rawRowCount: 1
      })
    );
    expect(secondTelemetry).toHaveBeenCalledWith({
      cacheHit: true,
      strongEvidenceKeyCount: 0
    });
  });

  it('emits source row counts and stage durations on cache miss', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: 'raw-1',
        FKOJUN: '210',
        FKOTEICD: '1',
        FSEZONO: 'PCR-CACHE',
        FKOJUNST: 'S',
        FUPDTEDT: '2026-04-23T15:50:35.987',
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-24T00:00:00.000Z'),
        sourceRowOrdinal: 1,
        sourceIngestRunStartedAt: null,
        sourceIngestRunCompletedAt: null
      }
    ]);
    const prisma = {
      $queryRaw: queryRaw
    };
    const telemetry = vi.fn();

    await materializeProcessChangeResidualStrongEvidence(prisma as never, { telemetry });

    expect(telemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        cacheHit: false,
        rawRowCount: 1,
        normalizedRowCount: 1,
        dedupedRowCount: 1,
        strongEvidenceKeyCount: 0,
        sourceRowFetchDurationMs: expect.any(Number),
        normalizeDurationMs: expect.any(Number),
        dedupeDurationMs: expect.any(Number),
        buildEvidenceDurationMs: expect.any(Number)
      })
    );
    for (const [event] of telemetry.mock.calls) {
      expect(event.sourceRowFetchDurationMs).toBeGreaterThanOrEqual(0);
      expect(event.normalizeDurationMs).toBeGreaterThanOrEqual(0);
      expect(event.dedupeDurationMs).toBeGreaterThanOrEqual(0);
      expect(event.buildEvidenceDurationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('does not fail materialization when telemetry callback throws', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: 'raw-1',
        FKOJUN: '210',
        FKOTEICD: '1',
        FSEZONO: 'PCR-CACHE',
        FKOJUNST: 'S',
        FUPDTEDT: '2026-04-23T15:50:35.987',
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-24T00:00:00.000Z'),
        sourceRowOrdinal: 1,
        sourceIngestRunStartedAt: null,
        sourceIngestRunCompletedAt: null
      }
    ]);
    const prisma = {
      $queryRaw: queryRaw
    };

    await expect(
      materializeProcessChangeResidualStrongEvidence(prisma as never, {
        telemetry: () => {
          throw new Error('telemetry sink failed');
        }
      })
    ).resolves.toEqual(
      expect.objectContaining({
        rawMailRowsRevision: '1:2026-04-23T00:00:00.000Z:2026-04-24T00:00:00.000Z'
      })
    );
  });

  it('stamps materialization with the revision observed from fetched raw rows', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        id: 'raw-1',
        FKOJUN: '210',
        FKOTEICD: '1',
        FSEZONO: 'PCR-CACHE',
        FKOJUNST: 'S',
        FUPDTEDT: '2026-04-23T15:50:35.987',
        createdAt: new Date('2026-04-23T00:00:00.000Z'),
        updatedAt: new Date('2026-04-24T00:00:00.000Z'),
        sourceRowOrdinal: 1,
        sourceIngestRunStartedAt: null,
        sourceIngestRunCompletedAt: null
      }
    ]);
    const prisma = {
      $queryRaw: queryRaw
    };

    const materialization = await materializeProcessChangeResidualStrongEvidence(prisma as never, {
      fkojunstStatusMailRowsRevision: 'stale-requested-revision'
    });

    expect(materialization.rawMailRowsRevision).toBe(
      '1:2026-04-23T00:00:00.000Z:2026-04-24T00:00:00.000Z'
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});

describe('buildProcessChangeResidualEvidenceCreateInputs', () => {
  it('serializes strong evidence rows for sync-time persistence', () => {
    const dedupedRows: FkojunstMailNormalizedRow[] = [
      {
        sourceRowId: 'current',
        fkojun: '210',
        fkoteicd: '1',
        fsezono: 'PCR-PERSIST',
        statusCode: 'R',
        sourceUpdatedAt: new Date('2026-04-23T15:50:35.000Z'),
        hasUnparseableDate: false
      },
      {
        sourceRowId: 'other',
        fkojun: '210',
        fkoteicd: '2',
        fsezono: 'PCR-PERSIST',
        statusCode: 'C',
        sourceUpdatedAt: new Date('2026-04-24T15:50:35.000Z'),
        hasUnparseableDate: false
      }
    ];

    const materialization = buildProcessChangeResidualStrongEvidenceFromDedupedRows(dedupedRows);
    const inputs = buildProcessChangeResidualEvidenceCreateInputs(materialization);

    expect(inputs).toEqual([
      expect.objectContaining({
        productNo: 'PCR-PERSIST',
        fkojun: '210',
        resourceCd: '1',
        currentStatusCode: 'R',
        currentSourceUpdatedAt: new Date('2026-04-23T15:50:35.000Z'),
        completedOtherResourceCd: '2',
        completedOtherStatusCode: 'C',
        completedOtherSourceUpdatedAt: new Date('2026-04-24T15:50:35.000Z')
      })
    ]);
  });
});
