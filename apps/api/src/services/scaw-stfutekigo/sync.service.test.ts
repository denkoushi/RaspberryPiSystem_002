import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCAW_STFUTEKIGO_DASHBOARD_ID } from './constants.js';
import { isScawStfutekigoSnapshotOlder, ScawStfutekigoSyncService } from './sync.service.js';

describe('scawSTFUTEKIGO snapshot ordering', () => {
  it('treats only a non-null persisted timestamp newer than the incoming one as older', () => {
    expect(
      isScawStfutekigoSnapshotOlder(new Date('2026-09-02T01:00:00.000Z'), new Date('2026-09-02T00:00:00.000Z'))
    ).toBe(true);
    expect(
      isScawStfutekigoSnapshotOlder(new Date('2026-09-02T00:00:00.000Z'), new Date('2026-09-02T01:00:00.000Z'))
    ).toBe(false);
    expect(isScawStfutekigoSnapshotOlder(null, new Date('2026-09-02T00:00:00.000Z'))).toBe(false);
  });
});

describe('scawSTFUTEKIGO projection marker', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('replays a completed run without treating deleted staging as an empty snapshot', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 'old-run',
      csvDashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID,
      status: 'COMPLETED',
      startedAt: new Date('2026-09-01T01:00:00.000Z'),
      sourceReceivedAt: null,
      completedAt: new Date('2026-09-01T01:05:00.000Z'),
      errorMessage: null,
      rowsProcessed: 1,
    });
    const stagingFindMany = vi.fn().mockResolvedValue([]);
    const currentCount = vi.fn();
    const service = new ScawStfutekigoSyncService({
      csvDashboardIngestRun: { findUnique },
      csvDashboardRow: { findMany: stagingFindMany, deleteMany: vi.fn() },
      scawStfutekigoCurrent: { count: currentCount },
    } as never);

    await expect(service.syncFromScawStfutekigoDashboard({ ingestRunId: 'old-run' })).resolves.toMatchObject({
      skippedAsOlder: false,
      skippedAsAlreadyApplied: true,
      rowsScanned: 0,
    });
    expect(currentCount).toHaveBeenCalledTimes(2);
    expect(stagingFindMany).toHaveBeenCalled();
  });

  it('marks a completed ingest run failed when projection validation fails', async () => {
    const update = vi.fn().mockResolvedValue({});
    const findUnique = vi.fn().mockResolvedValue({
      id: 'failed-run',
      csvDashboardId: SCAW_STFUTEKIGO_DASHBOARD_ID,
      status: 'COMPLETED',
      startedAt: new Date('2026-09-02T01:00:00.000Z'),
      sourceReceivedAt: new Date('2026-09-02T01:00:00.000Z'),
      completedAt: new Date('2026-09-02T01:05:00.000Z'),
      errorMessage: null,
      rowsProcessed: 1,
    });
    const service = new ScawStfutekigoSyncService({
      csvDashboardIngestRun: { findUnique, update },
      csvDashboardRow: {
        findMany: vi.fn().mockResolvedValue([{ rowData: { nonconformityNo: 'N-1' }, sourceRowOrdinal: 1 }]),
      },
      scawStfutekigoCurrent: { count: vi.fn().mockResolvedValue(0) },
    } as never);

    await expect(service.syncFromScawStfutekigoDashboard({ ingestRunId: 'failed-run' })).rejects.toThrow(
      'missing semantic columns'
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'failed-run' },
      data: {
        status: 'FAILED',
        errorMessage: expect.stringContaining('missing semantic columns'),
        completedAt: expect.any(Date),
      },
    });
  });
});
