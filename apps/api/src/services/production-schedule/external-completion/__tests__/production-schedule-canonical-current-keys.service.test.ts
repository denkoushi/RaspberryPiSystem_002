import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { NormalizedRowData } from '../../../csv-dashboard/csv-dashboard.types.js';
import { ProductionScheduleCanonicalCurrentKeysService } from '../production-schedule-canonical-current-keys.service.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const { readFile } = await import('node:fs/promises');

describe('ProductionScheduleCanonicalCurrentKeysService', () => {
  it('returns apply outcome with 2CSV intersection keys', async () => {
    const latestCompletedAt = new Date('2026-05-17T11:50:00.000Z');
    const findFirst = vi.fn().mockResolvedValue({
      completedAt: latestCompletedAt,
      csvFilePath: '/tmp/status-latest.csv',
    });
    vi.mocked(readFile).mockResolvedValue(`FKOJUN,FKOJUNST,FKOTEICD,FSEZONO,FUPDTEDT
100,S,021,1234567890,04/28/2026 00:00:00
`);
    const mockClient = {
      csvDashboardIngestRun: { findFirst },
    } as unknown as PrismaClient;
    const svc = new ProductionScheduleCanonicalCurrentKeysService({ prismaClient: mockClient });
    const reference = new Date('2026-05-17T12:00:00.000Z');
    const result = await svc.resolveScheduleCsvDisappearanceCanonicalCurrentKeys({
      scheduleDedupRows: [
        {
          data: {
            FKOJUN: '100',
            FSIGENCD: '021',
            ProductNo: '1234567890',
          } as NormalizedRowData,
        },
      ],
      scheduleIngestCompletedAt: reference,
    });

    expect(result.outcome).toBe('apply');
    if (result.outcome === 'apply') {
      expect(result.keys).toEqual(['100\t021\t1234567890']);
      expect(result.diagnostics.canonicalIntersectionKeyCount).toBe(1);
      expect(result.diagnostics.pairedStatusSnapshotAtIso).toBe(latestCompletedAt.toISOString());
    }
    expect(findFirst).toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith('/tmp/status-latest.csv', 'utf-8');
  });

  it('excludes schedule rows not present in paired status snapshot', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      completedAt: new Date('2026-05-17T00:00:00.000Z'),
      csvFilePath: '/tmp/status-nonmatch.csv',
    });
    vi.mocked(readFile).mockResolvedValue(`FKOJUN,FKOJUNST,FKOTEICD,FSEZONO,FUPDTEDT
999,S,021,1234567890,04/28/2026 00:00:00
`);
    const mockClient = {
      csvDashboardIngestRun: { findFirst },
    } as unknown as PrismaClient;
    const svc = new ProductionScheduleCanonicalCurrentKeysService({ prismaClient: mockClient });
    const result = await svc.resolveScheduleCsvDisappearanceCanonicalCurrentKeys({
      scheduleDedupRows: [
        {
          data: {
            FKOJUN: '100',
            FSIGENCD: '021',
            ProductNo: '1234567890',
          } as NormalizedRowData,
        },
      ],
      scheduleIngestCompletedAt: new Date(),
    });

    expect(result.outcome).toBe('apply');
    if (result.outcome === 'apply') {
      expect(result.keys).toEqual([]);
    }
  });

  it('skip_disappearance_sync when schedule batch is empty', async () => {
    const findMany = vi.fn();
    const findFirst = vi.fn();
    const mockClient = {
      csvDashboardIngestRun: { findFirst },
    } as unknown as PrismaClient;
    const svc = new ProductionScheduleCanonicalCurrentKeysService({ prismaClient: mockClient });
    const result = await svc.resolveScheduleCsvDisappearanceCanonicalCurrentKeys({
      scheduleDedupRows: [],
      scheduleIngestCompletedAt: new Date(),
    });
    expect(result.outcome).toBe('skip_disappearance_sync');
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('skip_disappearance_sync when no completed status ingest run exists at or before reference', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const mockClient = {
      csvDashboardIngestRun: { findFirst },
    } as unknown as PrismaClient;
    const svc = new ProductionScheduleCanonicalCurrentKeysService({ prismaClient: mockClient });
    const result = await svc.resolveScheduleCsvDisappearanceCanonicalCurrentKeys({
      scheduleDedupRows: [
        { data: { FKOJUN: '100', FSIGENCD: '021', ProductNo: '1234567890' } as NormalizedRowData },
      ],
      scheduleIngestCompletedAt: new Date(),
    });
    expect(result.outcome).toBe('skip_disappearance_sync');
    if (result.outcome === 'skip_disappearance_sync') {
      expect(result.reason).toBe('no_status_ingest_run_at_or_before_reference_at');
    }
  });

  it('skip_disappearance_sync when paired ingest run exists but no rows are available by paired snapshot time', async () => {
    const latestCompletedAt = new Date('2026-05-17T00:00:00.000Z');
    const findFirst = vi.fn().mockResolvedValue({
      completedAt: latestCompletedAt,
      csvFilePath: '/tmp/status-empty.csv',
    });
    vi.mocked(readFile).mockResolvedValue(`FKOJUN,FKOJUNST,FKOTEICD,FSEZONO,FUPDTEDT
`);
    const mockClient = {
      csvDashboardIngestRun: { findFirst },
    } as unknown as PrismaClient;
    const svc = new ProductionScheduleCanonicalCurrentKeysService({ prismaClient: mockClient });
    const result = await svc.resolveScheduleCsvDisappearanceCanonicalCurrentKeys({
      scheduleDedupRows: [
        { data: { FKOJUN: '100', FSIGENCD: '021', ProductNo: '1234567890' } as NormalizedRowData },
      ],
      scheduleIngestCompletedAt: new Date(),
    });
    expect(result.outcome).toBe('skip_disappearance_sync');
    if (result.outcome === 'skip_disappearance_sync') {
      expect(result.reason).toBe('no_status_csv_rows_at_or_before_reference_at');
      expect(result.diagnostics.pairedStatusSnapshotAtIso).toBe(latestCompletedAt.toISOString());
    }
  });

  it('dedupes identical external completion keys in intersection', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      completedAt: new Date('2026-05-17T00:00:00.000Z'),
      csvFilePath: '/tmp/status-dedupe.csv',
    });
    vi.mocked(readFile).mockResolvedValue(`FKOJUN,FKOJUNST,FKOTEICD,FSEZONO,FUPDTEDT
100,S,021,1111111111,04/28/2026 00:00:00
100,S,021,1111111111,04/27/2026 00:00:00
`);
    const mockClient = {
      csvDashboardIngestRun: { findFirst },
    } as unknown as PrismaClient;
    const svc = new ProductionScheduleCanonicalCurrentKeysService({ prismaClient: mockClient });
    const result = await svc.resolveScheduleCsvDisappearanceCanonicalCurrentKeys({
      scheduleDedupRows: [
        { data: { FKOJUN: '100', FSIGENCD: '021', ProductNo: '1111111111' } as NormalizedRowData },
        { data: { FKOJUN: '100', FSIGENCD: '021', ProductNo: '1111111111' } as NormalizedRowData },
      ],
      scheduleIngestCompletedAt: new Date(),
    });
    expect(result.outcome).toBe('apply');
    if (result.outcome === 'apply') {
      expect(result.keys).toEqual(['100\t021\t1111111111']);
    }
  });
});
