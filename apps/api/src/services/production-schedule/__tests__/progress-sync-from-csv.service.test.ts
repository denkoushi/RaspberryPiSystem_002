import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressSyncFromCsvService } from '../progress-sync-from-csv.service.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    productionScheduleProgress: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

describe('ProgressSyncFromCsvService', () => {
  const service = new ProgressSyncFromCsvService();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CSVが新しい場合は完了を反映する', async () => {
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({
      updatedAt: new Date('2026-02-24T00:00:00.000Z'),
    } as never);

    await service.sync({
      candidates: [
        {
          rowId: 'row-1',
          rowData: { progress: '完了', updatedAt: '2026/02/25 10:00' },
          occurredAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    });

    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { csvDashboardRowId: 'row-1' },
        create: expect.objectContaining({ isCompleted: true }),
        update: expect.objectContaining({ isCompleted: true }),
      })
    );
  });

  it('CSVが新しい場合は空文字を未完了として反映する', async () => {
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({
      updatedAt: new Date('2026-02-24T00:00:00.000Z'),
    } as never);

    await service.sync({
      candidates: [
        {
          rowId: 'row-2',
          rowData: { progress: '', updatedAt: '2026/02/25 10:00' },
          occurredAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    });

    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { csvDashboardRowId: 'row-2' },
        create: expect.objectContaining({ isCompleted: false }),
        update: expect.objectContaining({ isCompleted: false }),
      })
    );
  });

  it('同時刻の場合は本システム側を優先して更新しない', async () => {
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({
      updatedAt: new Date('2026-02-24T16:00:00.000Z'),
    } as never);

    await service.sync({
      candidates: [
        {
          rowId: 'row-3',
          rowData: { progress: '完了', updatedAt: '2026/02/25 10:00' },
          occurredAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    });

    expect(prisma.productionScheduleProgress.upsert).not.toHaveBeenCalled();
  });

  it('CSVが古い場合は更新しない', async () => {
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({
      updatedAt: new Date('2026-02-24T20:00:00.000Z'),
    } as never);

    await service.sync({
      candidates: [
        {
          rowId: 'row-4',
          rowData: { progress: '完了', updatedAt: '2026/02/25 10:00' },
          occurredAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    });

    expect(prisma.productionScheduleProgress.upsert).not.toHaveBeenCalled();
  });

  it('既存レコードがなければ新規作成する', async () => {
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue(null);

    await service.sync({
      candidates: [
        {
          rowId: 'row-5',
          rowData: { progress: '完了', updatedAt: '2026/02/25 10:00' },
          occurredAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    });

    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { csvDashboardRowId: 'row-5' },
      })
    );
  });
});
