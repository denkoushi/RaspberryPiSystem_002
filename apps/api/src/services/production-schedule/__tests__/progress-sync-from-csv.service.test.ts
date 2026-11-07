import { synchronizeSessakuPieceSources } from '../sessaku-pieces/piece-sync.js';
vi.mock('../sessaku-pieces/piece-sync.js', () => ({ synchronizeSessakuPieceSources: vi.fn() }));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressSyncFromCsvService } from '../progress-sync-from-csv.service.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    csvDashboardRow: { findMany: vi.fn().mockResolvedValue([]) },
    productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([]) },
    productionScheduleProgress: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    dueManagementOutcomeEvent: {
      create: vi.fn(),
    },
  },
}));

describe('ProgressSyncFromCsvService', () => {
  const service = new ProgressSyncFromCsvService();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => (callback as (tx: typeof prisma) => Promise<unknown>)(prisma) as never);
  });

  it('CSVが新しい場合は完了を反映する', async () => {
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({
      updatedAt: new Date('2026-02-24T00:00:00.000Z'),
      isCompleted: false,
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

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.dueManagementOutcomeEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { csvDashboardRowId: 'row-1' },
        create: expect.objectContaining({ isCompleted: true }),
        update: expect.objectContaining({ isCompleted: true }),
      })
    );
  });

  it('CSVが新しい場合でも progress 空文字では手動完了済みを落とさない（同期スキップ）', async () => {
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({
      updatedAt: new Date('2026-02-24T00:00:00.000Z'),
      isCompleted: true,
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

    expect(prisma.productionScheduleProgress.upsert).not.toHaveBeenCalled();
    expect(prisma.dueManagementOutcomeEvent.create).not.toHaveBeenCalled();
  });

  it('CSVが新しい場合は空文字を未完了として反映する（未完了の行のみ）', async () => {
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({
      updatedAt: new Date('2026-02-24T00:00:00.000Z'),
      isCompleted: false,
    } as never);

    await service.sync({
      candidates: [
        {
          rowId: 'row-2b',
          rowData: { progress: '', updatedAt: '2026/02/25 10:00' },
          occurredAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
    });

    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.dueManagementOutcomeEvent.create).not.toHaveBeenCalled();
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { csvDashboardRowId: 'row-2b' },
        create: expect.objectContaining({ isCompleted: false }),
        update: expect.objectContaining({ isCompleted: false }),
      })
    );
  });

  it('同時刻の場合は本システム側を優先して更新しない', async () => {
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({
      updatedAt: new Date('2026-02-25T01:00:00.000Z'),
      isCompleted: false,
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
    expect(prisma.dueManagementOutcomeEvent.create).not.toHaveBeenCalled();
  });

  it('CSVが古い場合は更新しない', async () => {
    vi.mocked(prisma.productionScheduleProgress.findUnique).mockResolvedValue({
      updatedAt: new Date('2026-02-25T02:00:00.000Z'),
      isCompleted: false,
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
    expect(prisma.dueManagementOutcomeEvent.create).not.toHaveBeenCalled();
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
    expect(prisma.dueManagementOutcomeEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleProgress.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { csvDashboardRowId: 'row-5' },
      })
    );
  });

  it('progress列が無いCSVは同期しない', async () => {
    await service.sync({
      candidates: [
        {
          rowId: 'row-6',
          rowData: { updatedAt: '2026/02/25 10:00' },
          occurredAt: new Date('2026-02-25T00:00:00.000Z'),
        },
      ],
      hasProgressColumn: false,
    });

    expect(prisma.productionScheduleProgress.findUnique).not.toHaveBeenCalled();
    expect(prisma.productionScheduleProgress.upsert).not.toHaveBeenCalled();
    expect(prisma.dueManagementOutcomeEvent.create).not.toHaveBeenCalled();
    expect(prisma.productionScheduleSessakuPieceSet.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.csvDashboardRow.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('batches set detection and only starts a transaction for a live piece key without a progress column', async () => {
    vi.mocked(prisma.productionScheduleSessakuPieceSet.findMany).mockResolvedValueOnce([
      { fseiban: 'live', fhincd: 'p', fsigencd: '1', fkojun: '1', pieces: [{ id: 'p' }] },
      { fseiban: 'empty', fhincd: 'p', fsigencd: '1', fkojun: '1', pieces: [] }
    ] as never);
    const candidates = ['ordinary', 'live', 'empty'].map((FSEIBAN) => ({ rowId: FSEIBAN,
      rowData: { FSEIBAN, FHINCD: 'p', FSIGENCD: '1', FKOJUN: '1' }, occurredAt: new Date() }));
    await service.sync({ candidates, hasProgressColumn: false });
    expect(prisma.productionScheduleSessakuPieceSet.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.productionScheduleSessakuPieceSet.findMany).toHaveBeenNthCalledWith(2, {
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: [{ fseiban: 'live', fhincd: 'p' }] }
    });
    expect(prisma.csvDashboardRow.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: [{ AND: [
        { rowData: { path: ['FSEIBAN'], equals: 'live' } },
        { rowData: { path: ['FHINCD'], equals: 'p' } }
      ] }] }, select: { rowData: true }
    });
    expect(prisma.$transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { timeout: 30000, maxWait: 15000 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(synchronizeSessakuPieceSources).toHaveBeenCalledExactlyOnceWith(prisma, [{ fseiban: 'live', fhincd: 'p', fsigencd: '1', fkojun: '1' }]);
    expect(prisma.productionScheduleProgress.findUnique).not.toHaveBeenCalled();
  });

});
