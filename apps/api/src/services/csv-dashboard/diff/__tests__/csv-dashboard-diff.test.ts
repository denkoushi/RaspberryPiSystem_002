import { describe, expect, it } from 'vitest';
import { computeCsvDashboardDedupDiff } from '../csv-dashboard-diff.js';

describe('computeCsvDashboardDedupDiff', () => {
  it('updates when incoming updatedAt is newer even if completed', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        {
          data: { productNo: '1', progress: '', updatedAt: '2026/01/26 10:00' },
          occurredAt: new Date('2026-01-26T01:00:00Z'),
          hash: 'hash-1'
        }
      ],
      existingRows: [
        {
          id: 'row-1',
          dataHash: 'hash-1',
          occurredAt: new Date('2026-01-25T01:00:00Z'),
          rowData: { productNo: '1', progress: '完了', updatedAt: '2026/01/25 10:00' }
        }
      ]
    });

    expect(result.rowsToCreate).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.rowsAdded).toBe(1);
    expect(result.rowsSkipped).toBe(0);
  });

  it('skips when incoming updatedAt is older or equal', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        {
          data: { productNo: '2', updatedAt: '2026/01/25 10:00' },
          occurredAt: new Date('2026-01-25T01:00:00Z'),
          hash: 'hash-2'
        }
      ],
      existingRows: [
        {
          id: 'row-2',
          dataHash: 'hash-2',
          occurredAt: new Date('2026-01-25T01:00:00Z'),
          rowData: { productNo: '2', updatedAt: '2026/01/26 09:00' }
        }
      ]
    });

    expect(result.rowsToCreate).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
    expect(result.rowsAdded).toBe(0);
    expect(result.rowsSkipped).toBe(1);
  });

  it('falls back to occurredAt when updatedAt is missing', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        {
          data: { productNo: '3' },
          occurredAt: new Date('2026-01-26T01:00:00Z'),
          hash: 'hash-3'
        }
      ],
      existingRows: [
        {
          id: 'row-3',
          dataHash: 'hash-3',
          occurredAt: new Date('2026-01-25T01:00:00Z'),
          rowData: { productNo: '3' }
        }
      ]
    });

    expect(result.rowsToCreate).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.rowsAdded).toBe(1);
    expect(result.rowsSkipped).toBe(0);
  });

  it('updates when maxProductNoWins is enabled and incoming ProductNo is larger', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        {
          data: { ProductNo: '1000000009', updatedAt: '2026/01/25 09:00' },
          occurredAt: new Date('2026-01-25T00:00:00Z'),
          hash: 'hash-product-no',
        },
      ],
      existingRows: [
        {
          id: 'row-product-no',
          dataHash: 'hash-product-no',
          occurredAt: new Date('2026-01-25T01:00:00Z'),
          rowData: { ProductNo: '1000000001', updatedAt: '2026/01/26 10:00' },
        },
      ],
      options: {
        maxProductNoWins: true,
        productNoColumn: 'ProductNo',
      },
    });

    expect(result.updates).toHaveLength(1);
    expect(result.rowsAdded).toBe(1);
    expect(result.rowsSkipped).toBe(0);
  });

  it('skips when maxProductNoWins is enabled and incoming ProductNo is smaller', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'dashboard-1',
      completedValue: '完了',
      incomingRows: [
        {
          data: { ProductNo: '1000000001', updatedAt: '2026/01/27 10:00' },
          occurredAt: new Date('2026-01-27T01:00:00Z'),
          hash: 'hash-product-no-2',
        },
      ],
      existingRows: [
        {
          id: 'row-product-no-2',
          dataHash: 'hash-product-no-2',
          occurredAt: new Date('2026-01-25T01:00:00Z'),
          rowData: { ProductNo: '1000000009', updatedAt: '2026/01/25 10:00' },
        },
      ],
      options: {
        maxProductNoWins: true,
        productNoColumn: 'ProductNo',
      },
    });

    expect(result.updates).toHaveLength(0);
    expect(result.rowsAdded).toBe(0);
    expect(result.rowsSkipped).toBe(1);
  });

  it('keeps the first incoming row for duplicate hashes when firstIncomingHashWins is enabled', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'fkojunst-status-mail-dashboard',
      completedValue: '完了',
      incomingRows: [
        {
          data: { FKOJUNST: 'S' },
          occurredAt: new Date('2026-01-25T00:00:00Z'),
          sourceRowOrdinal: 1,
          hash: 'same-mail-key'
        },
        {
          data: { FKOJUNST: 'R' },
          occurredAt: new Date('2026-01-25T00:00:00Z'),
          sourceRowOrdinal: 2,
          hash: 'same-mail-key'
        }
      ],
      existingRows: [],
      options: { firstIncomingHashWins: true }
    });

    expect(result.rowsToCreate).toHaveLength(1);
    expect(result.rowsToCreate[0]?.rowData).toEqual({ FKOJUNST: 'S' });
    expect(result.rowsToCreate[0]?.sourceRowOrdinal).toBe(1);
    expect(result.rowsSkipped).toBe(1);
  });

  it('refreshes duplicate FKOJUNST_Status rows with incoming rowData without counting them as added', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'fkojunst-status-mail-dashboard',
      completedValue: '完了',
      incomingRows: [
        {
          data: { FKOJUN: '100', FKOTEICD: '021', FSEZONO: 'P1', FKOJUNST: 'C', FUPDTEDT: 'not-a-date' },
          occurredAt: new Date('2026-02-02T00:00:00Z'),
          sourceIngestRunId: 'run-2',
          sourceRowOrdinal: 1,
          sourceIngestRunStartedAt: new Date('2026-02-02T00:00:00Z'),
          hash: 'same-mail-key-old-unparseable'
        }
      ],
      existingRows: [
        {
          id: 'existing-mail-row',
          dataHash: 'same-mail-key-old-unparseable',
          occurredAt: new Date('2026-02-02T00:00:00Z'),
          rowData: { FKOJUN: '100', FKOTEICD: '021', FSEZONO: 'P1', FKOJUNST: 'S', FUPDTEDT: 'not-a-date' }
        }
      ],
      options: { firstIncomingHashWins: true, refreshSourceMetadataOnDuplicate: true }
    });

    expect(result.rowsToCreate).toHaveLength(0);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]).toMatchObject({
      id: 'existing-mail-row',
      occurredAt: new Date('2026-02-02T00:00:00Z'),
      rowData: { FKOJUN: '100', FKOTEICD: '021', FSEZONO: 'P1', FKOJUNST: 'C', FUPDTEDT: 'not-a-date' },
      sourceIngestRunId: 'run-2',
      sourceRowOrdinal: 1,
      sourceIngestRunStartedAt: new Date('2026-02-02T00:00:00Z')
    });
    expect(result.rowsAdded).toBe(0);
    expect(result.rowsSkipped).toBe(1);
  });

  it('prefers completed-run existing rows over newer failed-run duplicates for the same hash', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'fkojunst-status-mail-dashboard',
      completedValue: '完了',
      incomingRows: [
        {
          data: { FKOJUN: '100', FKOTEICD: '021', FSEZONO: 'P1', FKOJUNST: 'C', FUPDTEDT: 'not-a-date' },
          occurredAt: new Date('2026-02-03T00:00:00Z'),
          sourceIngestRunId: 'run-3',
          sourceRowOrdinal: 1,
          sourceIngestRunStartedAt: new Date('2026-02-03T00:00:00Z'),
          hash: 'same-mail-key-with-failed-duplicate'
        }
      ],
      existingRows: [
        {
          id: 'failed-duplicate-newer-row',
          dataHash: 'same-mail-key-with-failed-duplicate',
          occurredAt: new Date('2026-02-03T00:00:00Z'),
          createdAt: new Date('2026-02-02T00:00:00Z'),
          sourceIngestRunId: 'run-2',
          sourceIngestRun: {
            status: 'FAILED',
            completedAt: new Date('2026-02-02T00:10:00Z')
          },
          rowData: { FKOJUN: '100', FKOTEICD: '021', FSEZONO: 'P1', FKOJUNST: 'S', FUPDTEDT: 'not-a-date' }
        },
        {
          id: 'completed-visible-older-row',
          dataHash: 'same-mail-key-with-failed-duplicate',
          occurredAt: new Date('2026-02-03T00:00:00Z'),
          createdAt: new Date('2026-02-01T00:00:00Z'),
          sourceIngestRunId: 'run-1',
          sourceIngestRun: {
            status: 'COMPLETED',
            completedAt: new Date('2026-02-01T00:10:00Z')
          },
          rowData: { FKOJUN: '100', FKOTEICD: '021', FSEZONO: 'P1', FKOJUNST: 'S', FUPDTEDT: 'not-a-date' }
        }
      ],
      options: { firstIncomingHashWins: true, refreshSourceMetadataOnDuplicate: true }
    });

    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]?.id).toBe('completed-visible-older-row');
    expect(result.updates[0]?.sourceIngestRunId).toBe('run-3');
    expect(result.rowsAdded).toBe(0);
    expect(result.rowsSkipped).toBe(1);
  });

  it('uses later source ordinal for duplicate FKOJUNST_Status hashes when FUPDTEDT is unparseable', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'fkojunst-status-mail-dashboard',
      completedValue: '完了',
      incomingRows: [
        {
          data: { FKOJUN: '100', FKOTEICD: '021', FSEZONO: 'P1', FKOJUNST: 'S', FUPDTEDT: 'not-a-date' },
          occurredAt: new Date('2026-02-02T00:00:00Z'),
          sourceRowOrdinal: 1,
          hash: 'same-mail-key-unparseable'
        },
        {
          data: { FKOJUN: '100', FKOTEICD: '021', FSEZONO: 'P1', FKOJUNST: 'R', FUPDTEDT: 'not-a-date' },
          occurredAt: new Date('2026-02-02T00:00:00Z'),
          sourceRowOrdinal: 2,
          hash: 'same-mail-key-unparseable'
        }
      ],
      existingRows: [],
      options: {
        firstIncomingHashWins: true,
        preferLaterUnparseableDuplicate: true
      }
    });

    expect(result.rowsToCreate).toHaveLength(1);
    expect(result.rowsToCreate[0]?.rowData).toEqual({
      FKOJUN: '100',
      FKOTEICD: '021',
      FSEZONO: 'P1',
      FKOJUNST: 'R',
      FUPDTEDT: 'not-a-date'
    });
    expect(result.rowsToCreate[0]?.sourceRowOrdinal).toBe(2);
    expect(result.rowsSkipped).toBe(1);
  });

  it('keeps first source ordinal for duplicate FKOJUNST_Status hashes when FUPDTEDT is parseable', () => {
    const result = computeCsvDashboardDedupDiff({
      dashboardId: 'fkojunst-status-mail-dashboard',
      completedValue: '完了',
      incomingRows: [
        {
          data: { FKOJUN: '100', FKOTEICD: '021', FSEZONO: 'P1', FKOJUNST: 'S', FUPDTEDT: '04/28/2026 00:00:00' },
          occurredAt: new Date('2026-02-02T00:00:00Z'),
          sourceRowOrdinal: 1,
          hash: 'same-mail-key-parseable'
        },
        {
          data: { FKOJUN: '100', FKOTEICD: '021', FSEZONO: 'P1', FKOJUNST: 'R', FUPDTEDT: '04/28/2026 00:00:00' },
          occurredAt: new Date('2026-02-02T00:00:00Z'),
          sourceRowOrdinal: 2,
          hash: 'same-mail-key-parseable'
        }
      ],
      existingRows: [],
      options: {
        firstIncomingHashWins: true,
        preferLaterUnparseableDuplicate: true
      }
    });

    expect(result.rowsToCreate).toHaveLength(1);
    expect(result.rowsToCreate[0]?.rowData).toEqual({
      FKOJUN: '100',
      FKOTEICD: '021',
      FSEZONO: 'P1',
      FKOJUNST: 'S',
      FUPDTEDT: '04/28/2026 00:00:00'
    });
    expect(result.rowsToCreate[0]?.sourceRowOrdinal).toBe(1);
    expect(result.rowsSkipped).toBe(1);
  });
});

describe('unchanged row refresh window', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const day = 86_400_000;
  type Params = Parameters<typeof computeCsvDashboardDedupDiff>[0];
  const diff = (overrides: Partial<Params> = {}, ageDays = 1, hash = 'hash-1') => computeCsvDashboardDedupDiff({
    dashboardId: 'dashboard-1', completedValue: '完了', now,
    options: { skipUnchangedRowsWithinRefreshWindow: true },
    incomingRows: [{ hash, data: { value: 'same' }, occurredAt: now }],
    existingRows: [{ id: 'row-1', dataHash: hash, rowData: { value: 'same' }, occurredAt: new Date(+now - ageDays * day) }],
    ...overrides
  });

  it('preserves updates when the option is disabled', () => {
    expect(diff({ options: {} })).toMatchObject({ rowsAdded: 1, rowsSkipped: 0, rowsSkippedUnchanged: 0 });
  });

  it('skips equal JSON recursively regardless of object key order and JSON serialization', () => {
    const data = { value: 'same', nested: { b: [1, { d: null, c: true }], a: 2 }, absent: undefined, date: now };
    const result = diff({
      incomingRows: [{ hash: 'hash-1', data, occurredAt: now }],
      existingRows: [{ id: 'row-1', dataHash: 'hash-1', occurredAt: new Date(+now - day), rowData: {
        date: now.toISOString(), nested: { a: 2, b: [1, { c: true, d: null }] }, value: 'same'
      } }]
    });
    expect(result).toMatchObject({ updates: [], rowsAdded: 0, rowsSkipped: 1, rowsSkippedUnchanged: 1 });
  });

  it.each([{ value: 'changed' }, { value: 1 }, { value: 'same', extra: null }, { value: ['same'] }])('updates changed JSON %j', (data) => {
    expect(diff({ incomingRows: [{ hash: 'hash-1', data, occurredAt: now }] }).updates).toHaveLength(1);
  });

  it.each([
    { status: 'FAILED', completedAt: now },
    { status: 'PROCESSING', completedAt: null },
    { status: 'COMPLETED', completedAt: null },
    null
  ])('updates invisible existing rows for run %j', (sourceIngestRun) => {
    expect(diff({ existingRows: [{ id: 'row-1', dataHash: 'hash-1', rowData: { value: 'same' },
      occurredAt: new Date(+now - day), sourceIngestRunId: 'old-run', sourceIngestRun }] }).updates).toHaveLength(1);
  });

  it('skips reader-visible completed-run rows', () => {
    expect(diff({ existingRows: [{ id: 'row-1', dataHash: 'hash-1', rowData: { value: 'same' },
      occurredAt: new Date(+now - day), sourceIngestRunId: 'old-run', sourceIngestRun: { status: 'COMPLETED', completedAt: now } }] }).rowsSkippedUnchanged).toBe(1);
  });

  it('refreshes beyond 37 days and skips at 22 days', () => {
    expect(diff({}, 38).updates).toHaveLength(1);
    expect(diff({}, 22).rowsSkippedUnchanged).toBe(1);
  });

  it('uses deterministic per-hash thresholds covering 23 through 37 days, including the boundary', () => {
    const thresholds = Array.from({ length: 100 }, (_, i) => {
      const hash = `hash-${i}`;
      const firstRefresh = Array.from({ length: 38 }, (_, age) => age + 1)
        .find((age) => diff({}, age, hash).updates.length === 1)!;
      expect(diff({}, firstRefresh - 0.001, hash).rowsSkippedUnchanged).toBe(1);
      expect(diff({}, firstRefresh, hash).updates).toHaveLength(1);
      return firstRefresh;
    });
    expect(new Set(thresholds).size).toBe(15);
    expect(Math.min(...thresholds)).toBe(23);
    expect(Math.max(...thresholds)).toBe(37);
  });

  it.each([true, false])('preserves the older/equal updatedAt path (metadata refresh=%s)', (refreshSourceMetadataOnDuplicate) => {
    const result = diff({
      options: { skipUnchangedRowsWithinRefreshWindow: true, refreshSourceMetadataOnDuplicate },
      incomingRows: [{ hash: 'hash-1', data: { value: 'same' }, occurredAt: new Date(+now - 2 * day) }]
    });
    expect(result.updates).toHaveLength(refreshSourceMetadataOnDuplicate ? 1 : 0);
    expect(result.rowsSkipped).toBe(1);
    expect(result.rowsSkippedUnchanged).toBe(0);
  });

  it.each([
    { incoming: '2', existing: '1', updates: 1, skippedUnchanged: 0 },
    { incoming: '1', existing: '1', updates: 0, skippedUnchanged: 1 },
    { incoming: '1', existing: '2', updates: 0, skippedUnchanged: 0 }
  ])('combines maxProductNoWins with refresh: %j', ({ incoming, existing, updates, skippedUnchanged }) => {
    const result = diff({
      options: { maxProductNoWins: true, skipUnchangedRowsWithinRefreshWindow: true },
      incomingRows: [{ hash: 'hash-1', data: { ProductNo: incoming }, occurredAt: now }],
      existingRows: [{ id: 'row-1', dataHash: 'hash-1', rowData: { ProductNo: existing }, occurredAt: new Date(+now - day) }]
    });
    expect(result.updates).toHaveLength(updates);
    expect(result.rowsSkippedUnchanged).toBe(skippedUnchanged);
  });
});
