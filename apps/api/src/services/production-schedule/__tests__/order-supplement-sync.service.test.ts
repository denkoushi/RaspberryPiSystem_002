import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { ProductionScheduleOrderSupplementSyncService } from '../order-supplement-sync.service.js';

type PrismaMock = {
  csvDashboardRow: { findMany: ReturnType<typeof vi.fn> };
  productionScheduleOrderSupplement: { upsert: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

const { prismaMock } = vi.hoisted(() => {
  const mock: PrismaMock = {
    csvDashboardRow: {
      findMany: vi.fn(),
    },
    productionScheduleOrderSupplement: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
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
    prismaMock.$transaction.mockImplementation(async (fn: (tx: PrismaMock) => Promise<unknown>) => fn(prismaMock));
  });

  it('supplement行をwinner行へ照合してupsertする', async () => {
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
    vi.mocked(prisma.productionScheduleOrderSupplement.upsert).mockResolvedValue({} as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.deleteMany).mockResolvedValue({ count: 0 } as never);

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
    expect(prisma.productionScheduleOrderSupplement.upsert).toHaveBeenCalledTimes(1);
  });

  it('照合不能な行はunmatchedとして集計し、既存補助をpruneする', async () => {
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
    expect(prisma.productionScheduleOrderSupplement.upsert).not.toHaveBeenCalled();
  });
});
