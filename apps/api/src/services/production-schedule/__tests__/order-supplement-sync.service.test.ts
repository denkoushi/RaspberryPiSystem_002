import { lockSessakuPieceSourceRows } from '../sessaku-pieces/piece-sync.js';
vi.mock('../sessaku-pieces/piece-sync.js', () => ({ lockSessakuPieceSourceRows: vi.fn().mockResolvedValue([]), assertSessakuPieceWinnerTargets: vi.fn().mockResolvedValue(undefined), synchronizeSessakuPieceSources: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../sessaku-pieces/piece-key.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../sessaku-pieces/piece-key.js')>(), readSessakuPieceSet: vi.fn().mockResolvedValue(null) }));
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID } from '../constants.js';
import { ProductionScheduleOrderSupplementSyncService } from '../order-supplement-sync.service.js';
import {
  buildOrderSupplementKey,
  buildReplacementCreateInputs,
  collectExpiredUnmatchedSupplementSourceRowIds,
  resolveSupplementWinners,
  toSupplementNormalizedRow,
} from '../order-supplement-sync.pipeline.js';

type PrismaMock = {
  productionScheduleSessakuPieceSet: { findMany: ReturnType<typeof vi.fn> };
  csvDashboardRow: {
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  productionScheduleOrderSupplement: {
    findMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  productionScheduleOrderSplit: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
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
    productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([]) },
    csvDashboardRow: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ rowData: {} }),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    productionScheduleOrderSupplement: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
    },
    productionScheduleOrderSplit: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
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
    vi.mocked(lockSessakuPieceSourceRows).mockResolvedValue([]);
    prismaMock.productionScheduleSessakuPieceSet.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (fn: (tx: PrismaMock) => Promise<unknown>, _opts?: unknown) =>
      fn(prismaMock)
    );
    prismaMock.productionScheduleOrderSupplement.findMany.mockResolvedValue([] as never);
    prismaMock.csvDashboardRow.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.productionScheduleOrderSupplement.deleteMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.productionScheduleOrderSupplement.createMany.mockResolvedValue({ count: 0 } as never);
    prismaMock.productionScheduleOrderSupplement.update.mockResolvedValue({ id: 'updated-1' } as never);
    prismaMock.productionScheduleOrderSplit.findMany.mockResolvedValue([] as never);
    prismaMock.productionScheduleOrderSplit.findFirst.mockResolvedValue(null as never);
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

  it('1年超かつ照合先がないsource行だけを保持期間削除の候補にする', () => {
    const currentWinnerKey = buildOrderSupplementKey({
      productNo: 'CURRENT',
      resourceCd: 'R1',
      processOrder: '10',
    });
    const baseRow = {
      plannedQuantity: 1,
      plannedStartDate: null,
    };

    const candidates = collectExpiredUnmatchedSupplementSourceRowIds({
      normalizedRows: [
        {
          ...baseRow,
          sourceRowId: 'expired-unmatched',
          productNo: 'OLD',
          resourceCd: 'R1',
          processOrder: '10',
          plannedEndDate: new Date('2025-06-30T00:00:00.000Z'),
        },
        {
          ...baseRow,
          sourceRowId: 'expired-current-long-running',
          productNo: 'CURRENT',
          resourceCd: 'R1',
          processOrder: '10',
          plannedEndDate: new Date('2025-06-30T00:00:00.000Z'),
        },
        {
          ...baseRow,
          sourceRowId: 'future-unmatched',
          productNo: 'FUTURE',
          resourceCd: 'R1',
          processOrder: '10',
          plannedEndDate: new Date('2027-06-30T00:00:00.000Z'),
        },
        {
          ...baseRow,
          sourceRowId: 'unknown-date-unmatched',
          productNo: 'UNKNOWN',
          resourceCd: 'R1',
          processOrder: '10',
          plannedEndDate: null,
        },
      ],
      winnerIdByKey: new Map([[currentWinnerKey, 'winner-current']]),
      now: new Date('2026-07-25T00:00:00.000Z'),
    });

    expect(candidates).toEqual(['expired-unmatched']);
  });

  it('winner lookup は大量キーでも bind 変数数を増やさず JSON 1 引数で渡す', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    const rows = Array.from({ length: 40_000 }, (_, index) => ({
      sourceRowId: `src-${index}`,
      productNo: `P${String(index).padStart(6, '0')}`,
      resourceCd: `R${index % 1000}`,
      processOrder: String(index),
      plannedQuantity: 1,
      plannedStartDate: null,
      plannedEndDate: null,
    }));

    await resolveSupplementWinners(prisma as never, rows);

    const queryArgs = vi.mocked(prisma.$queryRaw).mock.calls[0] ?? [];
    const query = queryArgs[0] as { values?: unknown[] } | undefined;
    const lookupKeysJson = query?.values?.find(
      (arg): arg is string => typeof arg === 'string' && arg.startsWith('[{')
    );
    expect(lookupKeysJson).toBeDefined();
    expect(JSON.parse(lookupKeysJson ?? '[]')).toHaveLength(40_000);
    expect(query?.values?.length).toBeLessThan(10);
  });

  it('winner lookup は全行を1回だけ順位付けして既存winner規則を保つ', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);

    await resolveSupplementWinners(prisma as never, [
      {
        sourceRowId: 'src-index-contract',
        productNo: '0003602728',
        resourceCd: '035',
        processOrder: '210',
        plannedQuantity: 1,
        plannedStartDate: null,
        plannedEndDate: null,
      },
    ]);

    const queryArgs = vi.mocked(prisma.$queryRaw).mock.calls[0] ?? [];
    const query = queryArgs[0] as { strings?: readonly string[] } | undefined;
    const sql = query?.strings?.join(' ? ') ?? '';

    expect(sql).toContain('ranked_schedule AS MATERIALIZED');
    expect(sql).toContain('ROW_NUMBER() OVER');
    expect(sql).toContain(
      `PARTITION BY COALESCE("schedule_row"."rowData"->>'FSEIBAN', ''), COALESCE("schedule_row"."rowData"->>'FHINCD', ''), COALESCE("schedule_row"."rowData"->>'FSIGENCD', ''), COALESCE("schedule_row"."rowData"->>'FKOJUN', '')`
    );
    expect(sql).toContain(`WHEN ("schedule_row"."rowData"->>'ProductNo') ~ '^[0-9]+$'`);
    expect(sql).toContain('"schedule_row"."createdAt" DESC');
    expect(sql).toContain('"schedule_row"."id" DESC');
    expect(sql).toContain('WHERE ranked_schedule."winnerRank" = 1');
  });

  describe('資源違いの指示数の代替一致', () => {
    const order = { productNo: '0004174165', processOrder: '200' };
    const source = (resourceCd: string, quantity: string, id = `src-${resourceCd}`) => ({
      id,
      rowData: {
        ProductNo: order.productNo,
        FSIGENCD: resourceCd,
        FKOJUN: order.processOrder,
        FKOJUNSIJISU: quantity,
        plannedStartDate: '2027-03-04',
        plannedEndDate: '2027-03-05',
      },
    });

    beforeEach(() => {
      prismaMock.$queryRaw.mockResolvedValue([
        { ...order, resourceCd: '27M', id: 'winner-27M' },
        { ...order, resourceCd: '021', id: 'winner-021' },
      ]);
    });

    it('同じ指示数を採用し、指示数が空の元行を無視する', async () => {
      prismaMock.csvDashboardRow.findMany.mockResolvedValue([
        source('27M', '5'), source('503', '5'), source('051', ''),
      ]);
      prismaMock.productionScheduleOrderSupplement.createMany.mockResolvedValue({ count: 2 });

      const result = await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();

      expect(result).toMatchObject({ matched: 1, unmatched: 2, upserted: 2 });
      expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
      expect(prismaMock.productionScheduleOrderSupplement.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ csvDashboardRowId: 'winner-27M', plannedQuantity: 5 }),
          {
            ...order,
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            csvDashboardRowId: 'winner-021',
            sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
            resourceCd: '021',
            plannedQuantity: 5,
            plannedStartDate: null,
            plannedEndDate: null,
            plannedStartDateManuallySet: false,
            lastSeenAt: expect.any(Date),
          },
        ],
      });
    });

    it('資源 10・MSZ の行には代替一致しない', async () => {
      prismaMock.$queryRaw.mockResolvedValue([
        { ...order, resourceCd: '27M', id: 'winner-27M' },
        { ...order, resourceCd: '10', id: 'winner-10' },
        { ...order, resourceCd: 'MSZ', id: 'winner-MSZ' },
      ]);
      const row = toSupplementNormalizedRow('src-27M', source('27M', '5').rowData)!;
      const { fallbackMatches } = await resolveSupplementWinners(prisma, [row]);

      expect(fallbackMatches).toEqual([]);
    });

    it('切削の分割同期へ代替一致の winner 行と指示数を渡す', async () => {
      const row = toSupplementNormalizedRow('src-27M', source('27M', '5').rowData)!;
      const { winnerIdByKey, fallbackMatches } = await resolveSupplementWinners(prisma, [row]);
      const { pieceQuantityByRowId } = buildReplacementCreateInputs(
        [row], winnerIdByKey, new Map(), new Date(), fallbackMatches
      );

      expect(pieceQuantityByRowId).toEqual(new Map([['winner-27M', 5], ['winner-021', 5]]));
    });

    it.each(['7', ''])('完全一致の元行を優先する（指示数 %j）', async (quantity) => {
      prismaMock.csvDashboardRow.findMany.mockResolvedValue([source('27M', '5'), source('021', quantity)]);

      const result = await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();

      expect(result).toMatchObject({ matched: 2, unmatched: 0 });
      expect(prismaMock.productionScheduleOrderSupplement.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ csvDashboardRowId: 'winner-27M', plannedQuantity: 5 }),
          expect.objectContaining({
            csvDashboardRowId: 'winner-021',
            plannedQuantity: quantity ? Number(quantity) : null,
            plannedStartDate: new Date('2027-03-04'),
            plannedEndDate: new Date('2027-03-05'),
          }),
        ],
      });
    });

    it.each(['503', '27M'])('元行の指示数が食い違えば代替一致しない（別の元行の資源 %s）', async (resourceCd) => {
      prismaMock.csvDashboardRow.findMany.mockResolvedValue([
        source('27M', '5'), source(resourceCd, '7', 'src-conflict'),
      ]);

      await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();

      expect(prismaMock.productionScheduleOrderSupplement.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ csvDashboardRowId: 'winner-27M' })],
      });
    });

    it.each([true, false])('既存の着手日・納期・手動フラグを維持する（手動 %s）', async (manual) => {
      prismaMock.csvDashboardRow.findMany.mockResolvedValue([source('27M', '5')]);
      prismaMock.productionScheduleOrderSupplement.findMany.mockResolvedValue([
        {
          ...order,
          id: 'existing-021',
          csvDashboardRowId: 'winner-021',
          resourceCd: '021',
          plannedQuantity: 2,
          plannedStartDate: new Date('2024-01-01'),
          plannedEndDate: new Date('2024-01-02'),
          plannedStartDateManuallySet: manual,
        },
      ]);

      await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();

      expect(prismaMock.productionScheduleOrderSupplement.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'existing-021' },
        data: { plannedQuantity: 5, lastSeenAt: expect.any(Date) },
      });
      expect(prismaMock.productionScheduleOrderSupplement.deleteMany).toHaveBeenCalledWith({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
          plannedStartDate: { lt: expect.any(Date) },
          plannedStartDateManuallySet: false,
          ...(!manual ? { id: { notIn: ['existing-021'] } } : {}),
        },
      });
    });

    it('winner が変わった場合は同じ補助キーの行を新しい winner に付け替える', async () => {
      prismaMock.csvDashboardRow.findMany.mockResolvedValue([source('27M', '5')]);
      prismaMock.productionScheduleOrderSupplement.findMany.mockResolvedValue([
        {
          ...order,
          id: 'existing-021',
          csvDashboardRowId: 'previous-021',
          resourceCd: '021',
          plannedQuantity: 2,
          plannedStartDate: null,
          plannedEndDate: null,
          plannedStartDateManuallySet: false,
        },
      ]);

      await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();

      expect(prismaMock.productionScheduleOrderSupplement.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: 'existing-021' },
        data: { csvDashboardRowId: 'winner-021', plannedQuantity: 5, lastSeenAt: expect.any(Date) },
      });
    });
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

  it('1年超で照合不能なsource行は補助同期成功後に削除する', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-expired',
        rowData: {
          ProductNo: '0000000001',
          FSIGENCD: 'R99',
          FKOJUN: '999',
          plannedEndDate: '2024-01-31',
        },
      },
    ] as never);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([] as never);
    vi.mocked(prisma.csvDashboardRow.deleteMany).mockResolvedValue({ count: 1 } as never);

    await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();

    expect(prisma.csvDashboardRow.deleteMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['src-expired'] },
        csvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
      },
    });
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

  it('既存行ありで CSV の plannedQuantity が空のとき既存数量を維持し split を削除しない', async () => {
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([
      {
        id: 'src-blank-quantity',
        rowData: {
          ProductNo: '0003712732',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '',
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

    const service = new ProductionScheduleOrderSupplementSyncService();
    await service.syncFromSupplementDashboard();

    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledWith({
      where: { id: 'existing-1' },
      data: expect.objectContaining({
        plannedQuantity: 5,
      }),
    });
    expect(prisma.productionScheduleOrderSplitAssignment.deleteMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSplit.deleteMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSplit.update).not.toHaveBeenCalled();
  });

  it.each(['none', 'empty-cutting', 'cutting', 'empty-later'] as const)('CSV 0 は片がある部品か後工程setだけに保存する (set=%s)', async (kind) => {
    const key = { fseiban: 'S', fhincd: 'P', fsigencd: '503', fkojun: '200' };
    vi.mocked(lockSessakuPieceSourceRows).mockResolvedValue([key]);
    const active = kind === 'cutting' || kind === 'empty-later';
    prismaMock.productionScheduleSessakuPieceSet.findMany.mockResolvedValue(kind === 'none' ? [] : [{ ...key, id: 'cutting-set', fsigencd: '1', fkojun: '1', sourcePieceSetId: kind === 'empty-later' ? 'source-set' : null, pieces: kind === 'cutting' ? [{ id: 'cutting-piece' }] : [] }]);
    vi.mocked(prisma.csvDashboardRow.findMany).mockResolvedValue([{ id: 'winner-1', rowData: { FSEIBAN: 'S', FHINCD: 'P', FSIGENCD: '503', FKOJUN: '200' } }] as never).mockResolvedValueOnce([
      {
        id: 'src-invalid-quantity',
        rowData: {
          ProductNo: '0003712732',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '0',
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

    const service = new ProductionScheduleOrderSupplementSyncService();
    await service.syncFromSupplementDashboard();

    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledWith({
      where: { id: 'existing-1' },
      data: expect.objectContaining({
        plannedQuantity: active ? 0 : 5,
      }),
    });
    expect(lockSessakuPieceSourceRows).toHaveBeenCalled();
    expect(prisma.productionScheduleSessakuPieceSet.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: [{ fseiban: 'S', fhincd: 'P' }] } }));
    expect(prisma.productionScheduleOrderSplitAssignment.deleteMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSplit.deleteMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSplit.update).not.toHaveBeenCalled();
  });

  it('plannedQuantity 変更時は親数量を更新し旧片を読み書きしない', async () => {
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
    vi.mocked(prisma.productionScheduleOrderSplit.findMany)
      .mockResolvedValueOnce([{ parentCsvDashboardRowId: 'winner-1' }] as never)
      .mockResolvedValueOnce([
        { id: 'split-1', splitQuantity: 2 },
        { id: 'split-2', splitQuantity: 3 },
      ] as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    await service.syncFromSupplementDashboard();

    expect(prisma.productionScheduleOrderSplit.findMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSplit.update).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSplit.deleteMany).not.toHaveBeenCalled();
  });

  it('旧片が残っていても補助行は新しい winner に追従する', async () => {
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
        plannedQuantity: 5,
        plannedStartDate: null,
        plannedEndDate: null,
        plannedStartDateManuallySet: false,
      },
    ] as never);
    vi.mocked(prisma.productionScheduleOrderSplit.findMany)
      .mockResolvedValueOnce([{ parentCsvDashboardRowId: 'winner-old' }] as never)
      .mockResolvedValueOnce([
        { id: 'split-1', splitQuantity: 2 },
        { id: 'split-2', splitQuantity: 3 },
      ] as never);

    const service = new ProductionScheduleOrderSupplementSyncService();
    await service.syncFromSupplementDashboard();

    expect(prisma.productionScheduleOrderSupplement.update).toHaveBeenCalledWith({
      where: { id: 'existing-1' },
      data: expect.objectContaining({
        csvDashboardRowId: 'winner-new',
        plannedQuantity: 10,
      }),
    });
    expect(prisma.productionScheduleOrderSplit.findMany).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSplit.update).not.toHaveBeenCalled();
    expect(prisma.productionScheduleOrderSplit.deleteMany).not.toHaveBeenCalled();
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
