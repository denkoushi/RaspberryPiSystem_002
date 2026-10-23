import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  csvDashboard: { findMany: vi.fn() },
  csvDashboardRow: { findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
  csvDashboardIngestRun: { findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: prismaMock }));

import {
  CSV_DASHBOARD_RETENTION_BATCH_SIZE,
  computeLegacyTwoYearsAgoWindowUtc,
  computeRetentionCutoffUtc,
  runCsvDashboardRetentionSweep,
} from '../csv-dashboard-retention-sweep.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `id-${i}` }));

describe('csv-dashboard-retention-sweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.csvDashboard.findMany.mockResolvedValue([{ id: 'inspection' }]);
    prismaMock.csvDashboardRow.findMany.mockResolvedValue([]);
    prismaMock.csvDashboardIngestRun.findMany.mockResolvedValue([]);
  });

  it('基準日は日本時間の前年1月1日 0:00 (UTCでは前年12月31日15:00)', () => {
    // 2027-01-01 00:30 JST = 2026-12-31 15:30 UTC → 日本時間では2027年
    expect(computeRetentionCutoffUtc(new Date('2026-12-31T15:30:00Z')).toISOString()).toBe('2025-12-31T15:00:00.000Z');
    // 2026-12-31 23:30 JST はまだ2026年 → 基準日は2025-01-01 JST
    expect(computeRetentionCutoffUtc(new Date('2026-12-31T14:30:00Z')).toISOString()).toBe('2024-12-31T15:00:00.000Z');
  });

  it('従来の削除範囲は前々年の1年分', () => {
    const w = computeLegacyTwoYearsAgoWindowUtc(new Date('2027-01-01T02:00:00Z'));
    expect(w.start.toISOString()).toBe('2024-12-31T15:00:00.000Z');
    expect(w.endExclusive.toISOString()).toBe('2025-12-31T15:00:00.000Z');
  });

  it('試運転は件数を数えるだけで削除しない', async () => {
    prismaMock.csvDashboardRow.count.mockResolvedValueOnce(10).mockResolvedValueOnce(5000);
    prismaMock.csvDashboardIngestRun.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    const result = await runCsvDashboardRetentionSweep(new Date('2027-01-01T02:00:00Z'), { dryRun: true });

    expect(result).toEqual({ deletedRows: 5010, deletedIngestRuns: 3, dryRun: true, truncated: false });
    expect(prismaMock.csvDashboardRow.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.csvDashboardIngestRun.deleteMany).not.toHaveBeenCalled();
  });

  it('日常点検の一覧だけ基準日より古い行を消し、他の一覧には前々年の範囲しか当てない', async () => {
    await runCsvDashboardRetentionSweep(new Date('2027-01-01T02:00:00Z'));

    const rowWheres = prismaMock.csvDashboardRow.findMany.mock.calls.map((c) => c[0].where);
    expect(rowWheres).toHaveLength(2);
    expect(rowWheres[0]).toEqual({
      occurredAt: { gte: new Date('2024-12-31T15:00:00Z'), lt: new Date('2025-12-31T15:00:00Z') },
    });
    expect(rowWheres[1]).toEqual({
      csvDashboardId: { in: ['inspection'] },
      occurredAt: { lt: new Date('2025-12-31T15:00:00Z') },
    });
  });

  it('5000件ずつ小分けで削除し、最後の端数で止まる', async () => {
    prismaMock.csvDashboardRow.findMany
      .mockResolvedValueOnce(ids(CSV_DASHBOARD_RETENTION_BATCH_SIZE))
      .mockResolvedValueOnce(ids(3))
      .mockResolvedValue([]);
    prismaMock.csvDashboardRow.deleteMany
      .mockResolvedValueOnce({ count: CSV_DASHBOARD_RETENTION_BATCH_SIZE })
      .mockResolvedValueOnce({ count: 3 });

    const result = await runCsvDashboardRetentionSweep(new Date('2027-01-01T02:00:00Z'));

    expect(result.deletedRows).toBe(CSV_DASHBOARD_RETENTION_BATCH_SIZE + 3);
    expect(prismaMock.csvDashboardRow.findMany.mock.calls[0][0].take).toBe(CSV_DASHBOARD_RETENTION_BATCH_SIZE);
    expect(prismaMock.csvDashboardRow.deleteMany).toHaveBeenCalledTimes(2);
    const firstDelete = prismaMock.csvDashboardRow.deleteMany.mock.calls[0][0].where.AND;
    expect(firstDelete[1].id.in).toHaveLength(CSV_DASHBOARD_RETENTION_BATCH_SIZE);
  });

  it('対象の一覧が無ければ基準日の削除はしない', async () => {
    prismaMock.csvDashboard.findMany.mockResolvedValue([]);
    await runCsvDashboardRetentionSweep(new Date('2027-01-01T02:00:00Z'));
    expect(prismaMock.csvDashboardRow.findMany).toHaveBeenCalledTimes(1);
  });
});
