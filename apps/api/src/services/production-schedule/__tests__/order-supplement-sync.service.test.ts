import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID } from '../constants.js';
import { ProductionScheduleOrderSupplementSyncService } from '../order-supplement-sync.service.js';

type PrismaMock = {
  csvDashboardRow: { findMany: ReturnType<typeof vi.fn> };
  productionScheduleOrderSupplement: {
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
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
      deleteMany: vi.fn(),
      createMany: vi.fn(),
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
    prismaMock.productionScheduleOrderSupplement.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.productionScheduleOrderSupplement.createMany.mockResolvedValue({ count: 0 } as never);
  });

  it('supplement行をwinner行へ照合し、ソース単位でdeleteManyの後にcreateManyする', async () => {
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
    expect(prisma.productionScheduleOrderSupplement.deleteMany).toHaveBeenCalledWith({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
      },
    });
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
          plannedEndDate: expect.any(Date),
        },
      ],
    });
  });

  it('照合不能な行はunmatchedとして集計し、createManyは行わず既存補助をすべて削除する', async () => {
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
    vi.mocked(prisma.productionScheduleOrderSupplement.deleteMany).mockResolvedValue({ count: 2 } as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    const result = await service.syncFromSupplementDashboard();

    expect(result.unmatched).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.pruned).toBe(2);
    expect(result.upserted).toBe(0);
    expect(prisma.productionScheduleOrderSupplement.createMany).not.toHaveBeenCalled();
  });

  it('winner行IDが付け替わっても複合ユニーク衝突なく再作成できる（全削除→createMany）', async () => {
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
    vi.mocked(prisma.productionScheduleOrderSupplement.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.createMany).mockResolvedValue({ count: 1 } as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    const result = await service.syncFromSupplementDashboard();

    expect(result.matched).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.pruned).toBe(1);
    const deleteOrder = vi.mocked(prisma.productionScheduleOrderSupplement.deleteMany).mock.invocationCallOrder[0] ?? 0;
    const createOrder = vi.mocked(prisma.productionScheduleOrderSupplement.createMany).mock.invocationCallOrder[0] ?? 0;
    expect(deleteOrder).toBeLessThan(createOrder);
    expect(vi.mocked(prisma.productionScheduleOrderSupplement.createMany).mock.calls[0]?.[0]?.data?.[0]).toMatchObject({
      csvDashboardRowId: 'winner-new',
      productNo: '0003712732',
    });
  });
});
