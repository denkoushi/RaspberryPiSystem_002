import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportStatus } from '@prisma/client';
import { ImportHistoryService } from '../import-history.service.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    csvImportHistory: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

describe('ImportHistoryService', () => {
  let service: ImportHistoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ImportHistoryService();
  });

  it('createHistory creates PROCESSING history and returns id', async () => {
    vi.mocked(prisma.csvImportHistory.create).mockResolvedValue({ id: 'history-1' } as any);

    const id = await service.createHistory({
      scheduleId: 'sched-1',
      scheduleName: 'daily',
      employeesPath: 'employees.csv',
    });

    expect(id).toBe('history-1');
    expect(prisma.csvImportHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scheduleId: 'sched-1',
        scheduleName: 'daily',
        employeesPath: 'employees.csv',
        status: ImportStatus.PROCESSING,
        startedAt: expect.any(Date),
      }),
    });
  });

  it('getHistoryWithFilter builds where/sort/pagination correctly', async () => {
    vi.mocked(prisma.csvImportHistory.findMany).mockResolvedValue([{ id: 'h1' }] as any);
    vi.mocked(prisma.csvImportHistory.count).mockResolvedValue(1);
    const startDate = new Date('2026-01-01T00:00:00Z');
    const endDate = new Date('2026-01-31T23:59:59Z');

    const result = await service.getHistoryWithFilter({
      status: ImportStatus.FAILED,
      scheduleId: 'sched-1',
      startDate,
      endDate,
      offset: 10,
      limit: 20,
    });

    expect(prisma.csvImportHistory.findMany).toHaveBeenCalledWith({
      where: {
        status: ImportStatus.FAILED,
        scheduleId: 'sched-1',
        startedAt: { gte: startDate, lte: endDate },
      },
      orderBy: { startedAt: 'desc' },
      skip: 10,
      take: 20,
    });
    expect(prisma.csvImportHistory.count).toHaveBeenCalledWith({
      where: {
        status: ImportStatus.FAILED,
        scheduleId: 'sched-1',
        startedAt: { gte: startDate, lte: endDate },
      },
    });
    expect(result).toEqual({
      histories: [{ id: 'h1' }],
      total: 1,
      offset: 10,
      limit: 20,
    });
  });

  it('cleanupOldHistory deletes by completedAt retention and returns count', async () => {
    vi.mocked(prisma.csvImportHistory.deleteMany).mockResolvedValue({ count: 3 } as any);

    const deleted = await service.cleanupOldHistory(30);

    expect(deleted).toBe(3);
    expect(prisma.csvImportHistory.deleteMany).toHaveBeenCalledWith({
      where: {
        completedAt: {
          lt: expect.any(Date),
        },
      },
    });
  });
});
