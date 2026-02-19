import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';
import { ProductionScheduleCleanupService } from '../production-schedule-cleanup.service.js';

vi.mock('../../../../lib/prisma.js', () => ({
  prisma: {
    $executeRaw: vi.fn(),
    csvDashboardRow: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe('production-schedule-cleanup.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filterIncomingRowsByOneYear: basisDateが1年前threshold未満なら除外する', () => {
    const svc = new ProductionScheduleCleanupService();
    const nowUtc = new Date('2026-02-19T00:00:00.000Z');

    const recent = { data: { updatedAt: '2026/2/18 12:00' }, occurredAt: new Date('2026-02-18T00:00:00.000Z') };
    const old = { data: { updatedAt: '2025/2/18 08:00' }, occurredAt: new Date('2025-02-18T00:00:00.000Z') };

    const { kept, droppedCount, thresholdUtc } = svc.filterIncomingRowsByOneYear({
      rows: [recent, old],
      nowUtc,
    });

    expect(thresholdUtc.toISOString()).toBe('2025-02-19T00:00:00.000Z');
    expect(droppedCount).toBe(1);
    expect(kept).toEqual([recent]);
  });

  it('deleteExpiredRowsOneYear: occurredAtで候補を絞り、basisDateで最終判定して削除する', async () => {
    const svc = new ProductionScheduleCleanupService();
    const nowUtc = new Date('2026-02-19T00:00:00.000Z');

    // thresholdUtc = 2025-02-19T00:00:00Z
    // candidate1: occurredAtは古いがupdatedAtが新しい -> keep
    // candidate2: occurredAtもupdatedAtも古い -> delete
    vi.mocked(prisma.csvDashboardRow.findMany)
      .mockResolvedValueOnce([
        { id: 'a', occurredAt: new Date('2024-01-01T00:00:00.000Z'), rowData: { updatedAt: '2026/2/18 12:00' } },
        { id: 'b', occurredAt: new Date('2024-01-01T00:00:00.000Z'), rowData: { updatedAt: '2025/2/18 08:00' } },
      ] as never)
      .mockResolvedValueOnce([] as never);

    vi.mocked(prisma.csvDashboardRow.deleteMany).mockResolvedValue({ count: 1 } as never);

    const result = await svc.deleteExpiredRowsOneYear({
      csvDashboardId: 'dash',
      nowUtc,
      batchSize: 10,
    });

    expect(prisma.csvDashboardRow.findMany).toHaveBeenCalled();
    expect(prisma.csvDashboardRow.deleteMany).toHaveBeenCalledTimes(1);
    expect(vi.mocked(prisma.csvDashboardRow.deleteMany).mock.calls[0]?.[0]).toEqual({
      where: { id: { in: ['b'] } },
    });
    expect(result.deletedCount).toBe(1);
    expect(result.thresholdUtc.toISOString()).toBe('2025-02-19T00:00:00.000Z');
  });

  it('deleteDuplicateLosersGlobal: $executeRawの結果を合算し、0で停止する', async () => {
    const svc = new ProductionScheduleCleanupService();
    vi.mocked(prisma.$executeRaw).mockResolvedValueOnce(3 as never).mockResolvedValueOnce(0 as never);

    const result = await svc.deleteDuplicateLosersGlobal({ csvDashboardId: 'dash', deleteBatchSize: 1000 });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(result.deletedCount).toBe(3);
  });

  it('deleteDuplicateLosersForKeys: keysが空なら何もしない', async () => {
    const svc = new ProductionScheduleCleanupService();
    const result = await svc.deleteDuplicateLosersForKeys({ csvDashboardId: 'dash', logicalKeys: [] });

    expect(result).toEqual({ deletedCount: 0 });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

