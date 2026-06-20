import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID } from '../constants.js';
import { ProductionScheduleOrderSupplementSyncService } from '../order-supplement-sync.service.js';
import { toSupplementNormalizedRow } from '../order-supplement-sync.pipeline.js';

type PrismaMock = {
  csvDashboardRow: { findMany: ReturnType<typeof vi.fn> };
  productionScheduleOrderSupplement: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  productionScheduleOrderSplit: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  productionScheduleOrderSplitAssignment: {
    deleteMany: ReturnType<typeof vi.fn>;
  };
  $queryRaw: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
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
    productionScheduleOrderSplit: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
    },
    productionScheduleOrderSplitAssignment: {
      deleteMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
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
    prismaMock.productionScheduleOrderSplit.findMany.mockResolvedValue([] as never);
    prismaMock.productionScheduleOrderSplit.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.productionScheduleOrderSplit.update.mockResolvedValue({ id: 'split-updated' } as never);
    prismaMock.productionScheduleOrderSplitAssignment.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.$executeRaw.mockResolvedValue(0 as never);
  });

  it('生産システム列名の予定日も補助行として正規化する', () => {
    const normalized = toSupplementNormalizedRow('src-prod', {
      FSEZONO: '0003602728',
      FKOTEICD: '035',
      FKOJUN: '210',
      FKOJUNSIJISU: '2',
      FKOJUNSTTYOTEIYMD: '2027/03/04 0:00:00',
      FKOJUNENDYOTEIYMD: '2027/03/05 0:00:00',
    });

    expect(normalized).toEqual(
      expect.objectContaining({
        sourceRowId: 'src-prod',
        productNo: '0003602728',
        resourceCd: '035',
        processOrder: '210',
        plannedQuantity: 2,
      })
    );
    expect(normalized?.plannedStartDate?.toISOString()).toBe('2027-03-04T00:00:00.000Z');
    expect(normalized?.plannedEndDate?.toISOString()).toBe('2027-03-05T00:00:00.000Z');
  });

  it('AA1S2M02 / 0003602728 の生産システム列名予定日を winner 行へ 2027 年予定日として反映する', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-aa1s2m02',
        rowData: {
          FSEIBAN: 'AA1S2M02',
          FSEZONO: '0003602728',
          FKOTEICD: '035',
          FKOJUN: '210',
          FKOJUNSIJISU: '2',
          FKOJUNSTTYOTEIYMD: '2027/03/04 0:00:00',
          FKOJUNENDYOTEIYMD: '2027/03/05 0:00:00',
        },
      },
    ] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: 'winner-aa1s2m02',
        productNo: '0003602728',
        resourceCd: '035',
        processOrder: '210',
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
    expect(prisma.productionScheduleOrderSupplement.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          csvDashboardRowId: 'winner-aa1s2m02',
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
          productNo: '0003602728',
          resourceCd: '035',
          processOrder: '210',
          plannedQuantity: 2,
          plannedStartDate: new Date('2027-03-04T00:00:00.000Z'),
          plannedEndDate: new Date('2027-03-05T00:00:00.000Z'),
        }),
      ],
    });
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

  it('plannedEndDate が ISO datetime 形式でも補助納期として取り込める', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-iso',
        rowData: {
          ProductNo: '0003798331',
          FSIGENCD: '581',
          FKOJUN: '210',
          plannedEndDate: '2026-05-08T00:00:00'
        }
      }
    ] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: 'winner-iso',
        productNo: '0003798331',
        resourceCd: '581',
        processOrder: '210'
      }
    ] as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.createMany).mockResolvedValue({ count: 1 } as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    await service.syncFromSupplementDashboard();

    expect(prisma.productionScheduleOrderSupplement.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          csvDashboardRowId: 'winner-iso',
          plannedEndDate: new Date('2026-05-08T00:00:00.000Z')
        })
      ]
    });
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
        plannedEndDate: new Date('2026-04-20T00:00:00.000Z'),
        lastSeenAt: expect.any(Date),
      }),
    });
  });

  it('既存行ありで CSV に plannedEndDate があるとき上書きする', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-1',
        rowData: {
          ProductNo: '0003712732',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '10',
          plannedEndDate: '2026-05-08T00:00:00',
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
        plannedStartDate: null,
        plannedEndDate: new Date('2026-06-01T00:00:00.000Z'),
        plannedStartDateManuallySet: false,
      },
    ] as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    await service.syncFromSupplementDashboard();

    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledWith({
      where: { id: 'existing-1' },
      data: expect.objectContaining({
        plannedEndDate: new Date('2026-05-08T00:00:00.000Z'),
      }),
    });
  });

  it('既存行ありで CSV の plannedEndDate が空のとき既存計画納期を維持する', async () => {
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
    const keptEnd = new Date('2026-06-01T00:00:00.000Z');
    vi.mocked(prisma.productionScheduleOrderSupplement.findMany).mockResolvedValue([
      {
        id: 'existing-1',
        csvDashboardRowId: 'winner-old',
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
        plannedQuantity: 8,
        plannedStartDate: new Date('2026-04-20T00:00:00.000Z'),
        plannedEndDate: keptEnd,
        plannedStartDateManuallySet: false,
      },
    ] as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    await service.syncFromSupplementDashboard();

    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledWith({
      where: { id: 'existing-1' },
      data: expect.objectContaining({
        plannedEndDate: keptEnd,
        plannedQuantity: 10,
      }),
    });
  });

  it('plannedQuantity 変更時は既存 split 数量を新しい合計へ再配分する', async () => {
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
        id: 'winner-1',
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
      },
    ] as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.findMany).mockResolvedValue([
      {
        id: 'existing-1',
        csvDashboardRowId: 'winner-1',
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
        plannedQuantity: 5,
        plannedStartDate: null,
        plannedEndDate: null,
        plannedStartDateManuallySet: false,
      },
    ] as never);
    vi.mocked(prisma.productionScheduleOrderSplit.findMany).mockResolvedValue([
      { id: 'split-1', splitQuantity: 2 },
      { id: 'split-2', splitQuantity: 3 },
    ] as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    await service.syncFromSupplementDashboard();

    expect(prisma.productionScheduleOrderSplit.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'split-1' },
      data: { splitQuantity: 4 },
    });
    expect(prisma.productionScheduleOrderSplit.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'split-2' },
      data: { splitQuantity: 6 },
    });
  });

  it('補助3キーが既存行と一致しないが同一 winner 行を指すとき、createMany せず update でキーと値を揃える', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-1',
        rowData: {
          ProductNo: '0003712732',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '5',
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
    vi.mocked(prisma.productionScheduleOrderSupplement.findMany).mockResolvedValue([
      {
        id: 'stale-key-row',
        csvDashboardRowId: 'winner-1',
        productNo: 'OLD-PNO',
        resourceCd: '504',
        processOrder: '999',
        plannedQuantity: 1,
        plannedStartDate: null,
        plannedEndDate: null,
        plannedStartDateManuallySet: false,
      },
    ] as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.createMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.update).mockResolvedValue({ id: 'stale-key-row' } as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    await service.syncFromSupplementDashboard();

    expect(prisma.productionScheduleOrderSupplement.createMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledWith({
      where: { id: 'stale-key-row' },
      data: expect.objectContaining({
        csvDashboardRowId: 'winner-1',
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
        plannedQuantity: 5,
      }),
    });
  });

  it('CSV に無いキーの補助行は同期ループの対象外となり更新されない', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-only-a',
        rowData: {
          ProductNo: '0003712732',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '1',
          plannedEndDate: '2026-07-01T00:00:00',
        },
      },
    ] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      {
        id: 'winner-a',
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
      },
    ] as never);
    vi.mocked(prisma.productionScheduleOrderSupplement.findMany).mockResolvedValue([
      {
        id: 'existing-a',
        csvDashboardRowId: 'winner-a',
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
        plannedQuantity: 1,
        plannedStartDate: null,
        plannedEndDate: null,
        plannedStartDateManuallySet: false,
      },
      {
        id: 'existing-b',
        csvDashboardRowId: 'winner-b',
        productNo: '0000099999',
        resourceCd: '504',
        processOrder: '300',
        plannedQuantity: 2,
        plannedStartDate: null,
        plannedEndDate: new Date('2026-08-15T00:00:00.000Z'),
        plannedStartDateManuallySet: false,
      },
    ] as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    await service.syncFromSupplementDashboard();

    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledTimes(1);
    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledWith({
      where: { id: 'existing-a' },
      data: expect.any(Object),
    });
  });
});
