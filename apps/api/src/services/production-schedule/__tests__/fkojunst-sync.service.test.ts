import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
} from '../constants.js';
import { ProductionScheduleFkojunstSyncService } from '../fkojunst-sync.service.js';

type PrismaMock = {
  csvDashboardRow: { findMany: ReturnType<typeof vi.fn> };
  productionScheduleFkojunstStatus: {
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
    productionScheduleFkojunstStatus: {
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

describe('fkojunst-sync.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (fn: (tx: PrismaMock) => Promise<unknown>, _opts?: unknown) =>
      fn(prismaMock)
    );
    prismaMock.productionScheduleFkojunstStatus.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.productionScheduleFkojunstStatus.createMany.mockResolvedValue({ count: 0 } as never);
  });

  it('FKOJUNST行をwinner行へ照合し、ソース単位でdeleteManyの後にcreateManyする', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-1',
        rowData: {
          ProductNo: '0003712732',
          FSIGENCD: '503',
          FKOJUN: '200',
          FKOJUNST: 'C',
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
    vi.mocked(prisma.productionScheduleFkojunstStatus.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.productionScheduleFkojunstStatus.createMany).mockResolvedValue({ count: 1 } as never);

    const service = new ProductionScheduleFkojunstSyncService();
    const result = await service.syncFromFkojunstDashboard();

    expect(result).toEqual({
      scanned: 1,
      normalized: 1,
      matched: 1,
      unmatched: 0,
      skippedInvalidStatus: 0,
      upserted: 1,
      pruned: 0,
    });
    expect(prisma.productionScheduleFkojunstStatus.deleteMany).toHaveBeenCalledWith({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
      },
    });
    expect(prisma.productionScheduleFkojunstStatus.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleFkojunstStatus.createMany).toHaveBeenCalledWith({
      data: [
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          csvDashboardRowId: 'winner-1',
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_DASHBOARD_ID,
          productNo: '0003712732',
          resourceCd: '503',
          processOrder: '200',
          statusCode: 'C',
        },
      ],
    });
  });

  it('照合不能な行はunmatchedとして集計し、createManyは0件だが既存はdeleteManyで消去する', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-1',
        rowData: {
          ProductNo: '0000000001',
          FSIGENCD: 'R99',
          FKOJUN: '999',
          FKOJUNST: 'P',
        },
      },
    ] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.productionScheduleFkojunstStatus.deleteMany).mockResolvedValue({ count: 2 } as never);

    const service = new ProductionScheduleFkojunstSyncService();
    const result = await service.syncFromFkojunstDashboard();

    expect(result.unmatched).toBe(1);
    expect(result.matched).toBe(0);
    expect(result.pruned).toBe(2);
    expect(result.upserted).toBe(0);
    expect(prisma.productionScheduleFkojunstStatus.createMany).not.toHaveBeenCalled();
  });

  it('正規化行が無いときは既存FKOJUNSTをクリアする', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.productionScheduleFkojunstStatus.deleteMany).mockResolvedValue({ count: 3 } as never);

    const service = new ProductionScheduleFkojunstSyncService();
    const result = await service.syncFromFkojunstDashboard();

    expect(result.upserted).toBe(0);
    expect(result.pruned).toBe(3);
    expect(result.normalized).toBe(0);
    expect(prisma.productionScheduleFkojunstStatus.createMany).not.toHaveBeenCalled();
  });
});
