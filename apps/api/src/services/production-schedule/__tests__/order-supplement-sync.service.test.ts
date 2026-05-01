import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID } from '../constants.js';
import { ProductionScheduleOrderSupplementSyncService } from '../order-supplement-sync.service.js';

type PrismaMock = {
  csvDashboardRow: { findMany: ReturnType<typeof vi.fn> };
  productionScheduleOrderSupplement: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

const { prismaMock } = vi.hoisted(() => {
  const mock: PrismaMock = {
    csvDashboardRow: {
      findMany: vi.fn(),
    },
    productionScheduleOrderSupplement: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  mock.$transaction.mockImplementation(async (fn: (tx: PrismaMock) => Promise<unknown>) => fn(mock));
  return { prismaMock: mock };
});

vi.mock('../../../lib/prisma.js', () => ({
  prisma: prismaMock,
}));

describe('order-supplement-sync.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: PrismaMock) => Promise<unknown>, _opts?: unknown) =>
      fn(prismaMock)
    );
    prismaMock.productionScheduleOrderSupplement.findMany.mockResolvedValue([] as never);
    prismaMock.productionScheduleOrderSupplement.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.productionScheduleOrderSupplement.createMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.productionScheduleOrderSupplement.update.mockResolvedValue({ id: 'updated-1' } as never);
  });

  it('supplement行をwinner行へ照合し、既存が無ければcreateManyで追加する', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-1',
        rowData: {
          ProductNo: '0003712732',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '15',
          plannedStartDate: '04/16/2026 00:00:00',
          plannedEndDate: '04/16/2026 00:00:00',
        },
      },
    ] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: 'winner-1',
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
      },
    ] as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.createMany).mockResolvedValue({ count: 1 } as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    const result = await service.syncFromSupplementDashboard();

    expect(result).toEqual({
      scanned: 1,
      normalized: 1,
      matched: 1,
      unmatched: 0,
      upserted: 1,
      pruned: 0,
    });
    expect(prisma.productionScheduleOrderSupplement.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleOrderSupplement.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleOrderSupplement.createMany).toHaveBeenCalledWith({
      data: [
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          csvDashboardRowId: 'winner-1',
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
          productNo: '0003712732',
          resourceCd: '503',
          processOrder: '200',
          plannedQuantity: 15,
          plannedStartDate: expect.any(Date),
          plannedStartDateManuallySet: false,
          plannedEndDate: expect.any(Date),
          lastSeenAt: expect.any(Date),
        },
      ],
    });
    expect(prisma.productionScheduleOrderSupplement.update).not.toHaveBeenCalled();
  });

  it('照合不能な行はunmatchedとして集計し、既存補助を削除しない', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-1',
        rowData: {
          ProductNo: '0000000001',
          FSIGENCD: 'R99',
          FKOJUN: '999',
          plannedQuantity: '4',
        },
      },
    ] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.deleteMany).mockResolvedValue({ count: 0 } as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    const result = await service.syncFromSupplementDashboard();

    expect(result.unmatched).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.pruned).toBe(0);
    expect(result.upserted).toBe(0);
    expect(prisma.productionScheduleOrderSupplement.createMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSupplement.update).not.toHaveBeenCalled();
  });

  it('既存manual着手日はCSV同期で上書きしない', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-1',
        rowData: {
          ProductNo: '0003712732',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '10',
        },
      },
    ] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: 'winner-new',
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
      },
    ] as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.findMany).mockResolvedValue([
      {
        id: 'existing-1',
        csvDashboardRowId: 'winner-old',
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
        plannedQuantity: 8,
        plannedStartDate: new Date('2026-04-20T00:00:00.000Z'),
        plannedEndDate: new Date('2026-04-20T00:00:00.000Z'),
        plannedStartDateManuallySet: true,
      },
    ] as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.deleteMany).mockResolvedValue({ count: 0 } as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    const result = await service.syncFromSupplementDashboard();

    expect(result.matched).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.pruned).toBe(0);
    expect(prisma.productionScheduleOrderSupplement.createMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledWith({
      where: { id: 'existing-1' },
      data: expect.objectContaining({
        csvDashboardRowId: 'winner-new',
        plannedQuantity: 10,
        plannedStartDate: new Date('2026-04-20T00:00:00.000Z'),
        lastSeenAt: expect.any(Date),
      }),
    });
  });
});
