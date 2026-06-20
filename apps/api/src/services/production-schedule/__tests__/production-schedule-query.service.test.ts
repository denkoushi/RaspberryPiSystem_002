import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProductionScheduleOrderUsage,
  listProductionScheduleRowsForSignageMachineBoard,
  listProductionScheduleResources,
  listProductionScheduleRows,
} from '../production-schedule-query.service.js';
import { resetMachineNameFseibanMatchCaches } from '../machine-name-fseiban-match.service.js';
import { resolveActualHoursLocationCandidates } from '../actual-hours-location-scope.service.js';
import { prisma } from '../../../lib/prisma.js';
import { enrichProductionScheduleRowsWithResolvedMachineName } from '../production-schedule-machine-name-enrichment.service.js';
import { enrichProductionScheduleRowsWithCustomerName } from '../production-schedule-customer-name-enrichment.service.js';
import * as leaderboardSplitExpansion from '../leaderboard/leaderboard-split-expansion.service.js';
import * as listCountService from '../production-schedule-list-count.service.js';
import { isProductionScheduleOrderSplitEnabled } from '../order-split/production-schedule-order-split-feature.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    productionScheduleSeibanMachineNameSupplement: {
      findMany: vi.fn(),
    },
    productionScheduleResourceCategoryConfig: {
      findUnique: vi.fn(),
    },
    productionScheduleActualHoursFeature: {
      findMany: vi.fn(),
    },
    productionScheduleResourceCodeMapping: {
      findMany: vi.fn(),
    },
    productionScheduleResourceMaster: {
      findMany: vi.fn(),
    },
    partMeasurementTemplate: {
      findMany: vi.fn(),
    },
    selfInspectionSession: {
      findMany: vi.fn(),
    },
    productionScheduleOrderSplit: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock('../actual-hours-location-scope.service.js', async () => {
  const actual =
    await vi.importActual<typeof import('../actual-hours-location-scope.service.js')>(
      '../actual-hours-location-scope.service.js'
    );
  return {
    ...actual,
    resolveActualHoursLocationCandidates: vi.fn((locationKey: string) => [locationKey]),
  };
});

vi.mock('../production-schedule-machine-name-enrichment.service.js', () => ({
  enrichProductionScheduleRowsWithResolvedMachineName: vi.fn(async (rows: Array<{ rowData: unknown }>) =>
    rows.map((row) => {
      const rowData = (row.rowData ?? {}) as Record<string, unknown>;
      const fseiban = typeof rowData.FSEIBAN === 'string' ? rowData.FSEIBAN.trim() : '';
      return {
        ...row,
        resolvedMachineName: fseiban.length > 0 ? `機種-${fseiban}` : null,
      };
    })
  ),
}));

vi.mock('../production-schedule-customer-name-enrichment.service.js', () => ({
  enrichProductionScheduleRowsWithCustomerName: vi.fn(async (rows: Array<Record<string, unknown>>) =>
    rows.map((row) => ({
      ...row,
      customerName: null as string | null,
    }))
  ),
}));

describe('production-schedule-query.service', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(prisma.$queryRaw).mockReset();
    vi.mocked(prisma.productionScheduleOrderSplit.findMany).mockReset();
    vi.mocked(prisma.productionScheduleOrderSplit.findMany).mockResolvedValue([]);
    vi.clearAllMocks();
    resetMachineNameFseibanMatchCaches();
    vi.mocked(resolveActualHoursLocationCandidates).mockImplementation((locationKey: string) => [locationKey]);
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockResolvedValue([]);
    vi.mocked(prisma.productionScheduleResourceCategoryConfig.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([]);
    vi.mocked(prisma.productionScheduleResourceCodeMapping.findMany).mockResolvedValue([]);
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue([]);
    vi.mocked(prisma.partMeasurementTemplate.findMany).mockResolvedValue([]);
    vi.mocked(prisma.selfInspectionSession.findMany).mockResolvedValue([]);
    vi.mocked(enrichProductionScheduleRowsWithResolvedMachineName).mockClear();
    vi.mocked(enrichProductionScheduleRowsWithCustomerName).mockClear();
  });

  it('資源CD単独指定時（assignedOnlyなし）は空結果を返しDBクエリしない', async () => {
    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: '',
      productNos: [],
      resourceCds: ['R01'],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect(result).toEqual({
      page: 1,
      pageSize: 20,
      total: 0,
      rows: [],
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('allowResourceOnly=true のときは資源CD単独指定でも一覧取得へ進む', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          occurredAt: new Date('2026-03-23T00:00:00.000Z'),
          rowData: {
            ProductNo: '0001',
            FSEIBAN: 'A',
            FHINCD: 'X',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            progress: '',
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null,
        },
      ] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: '',
      productNos: [],
      resourceCds: ['R01'],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      allowResourceOnly: true,
      locationKey: 'kiosk-1',
    });

    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.resolvedMachineName).toBe('機種-A');
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('機種名フィルタは補完テーブル由来の表示用機種名も対象に含める', async () => {
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockResolvedValue([
      {
        fseiban: 'A',
        machineName: '補完機種A',
      },
    ]);
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          occurredAt: new Date('2026-03-23T00:00:00.000Z'),
          rowData: {
            ProductNo: '0001',
            FSEIBAN: 'A',
            FHINCD: 'X',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            progress: '',
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null,
        },
      ] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: '',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      machineName: '補完機種A',
      hasNoteOnly: false,
      hasDueDateOnly: false,
      allowResourceOnly: true,
      locationKey: 'kiosk-1',
    });

    expect(prisma.productionScheduleSeibanMachineNameSupplement.findMany).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(1);
    expect(result.rows[0]?.resolvedMachineName).toBe('機種-A');
  });

  it('自主検査ボード向け一覧は機種の生産日程行を走査し、打ち切りは表示上限とは別', async () => {
    const firstChunk = Array.from({ length: 500 }, (_, index) => ({
      id: `row-${index + 1}`,
      occurredAt: new Date('2026-03-23T00:00:00.000Z'),
      rowData: {
        ProductNo: String(index + 1).padStart(4, '0'),
        FSEIBAN: 'A',
        FHINCD: `X-${index + 1}`,
        FHINMEI: '機種A',
        FSIGENCD: 'R01',
        FKOJUN: '10',
        progress: '',
      },
      processingOrder: 2,
      globalRank: 5,
      note: null,
      processingType: null,
      dueDate: null,
      plannedQuantity: 1,
      plannedStartDate: null,
      plannedEndDate: null,
    }));
    const makeChunk = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `row-${start + index}`,
        occurredAt: new Date('2026-03-23T00:00:00.000Z'),
        rowData: {
          ProductNo: String(start + index).padStart(4, '0'),
          FSEIBAN: 'A',
          FHINCD: `X-${start + index}`,
          FHINMEI: '機種A',
          FSIGENCD: 'R01',
          FKOJUN: '10',
          progress: '',
        },
        processingOrder: 2,
        globalRank: 5,
        note: null,
        processingType: null,
        dueDate: null,
        plannedQuantity: 1,
        plannedStartDate: null,
        plannedEndDate: null,
      }));
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ fseiban: 'A', fhinmei: '機種A' }] as never)
      .mockResolvedValueOnce(firstChunk as never)
      .mockResolvedValueOnce(makeChunk(501, 500) as never)
      .mockResolvedValueOnce(makeChunk(1001, 500) as never)
      .mockResolvedValueOnce(makeChunk(1501, 500) as never)
      .mockResolvedValueOnce([
        {
          id: 'row-2001',
          occurredAt: new Date('2026-03-23T00:00:00.000Z'),
          rowData: {
            ProductNo: '2001',
            FSEIBAN: 'A',
            FHINCD: 'X-2001',
            FHINMEI: '機種A',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            progress: '',
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: 1,
          plannedStartDate: null,
          plannedEndDate: null,
        },
      ] as never);

    const result = await listProductionScheduleRowsForSignageMachineBoard({
      machineName: '機種A',
      locationKey: 'kiosk-1',
      maxRows: 2000,
      pageSize: 500,
    });

    expect(result.rows).toHaveLength(2001);
    expect(result.maxRows).toBe(2000);
    expect(result.scheduleExhausted).toBe(true);
    expect(result.hitScanCap).toBe(false);
    expect(result.rows.at(-1)?.id).toBe('row-2001');
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(6);
  });

  it('自主検査ボード向け一覧は maxScanPages で走査上限を打ち切る', async () => {
    const makeChunk = (start: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        id: `row-${start + index}`,
        occurredAt: new Date('2026-03-23T00:00:00.000Z'),
        rowData: {
          ProductNo: String(start + index).padStart(4, '0'),
          FSEIBAN: 'A',
          FHINCD: `X-${start + index}`,
          FHINMEI: '機種A',
          FSIGENCD: 'R01',
          FKOJUN: '10',
          progress: '',
        },
        processingOrder: 2,
        globalRank: 5,
        note: null,
        processingType: null,
        dueDate: null,
        plannedQuantity: 1,
        plannedStartDate: null,
        plannedEndDate: null,
      }));

    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ fseiban: 'A', fhinmei: '機種A' }] as never)
      .mockResolvedValueOnce(makeChunk(1, 500) as never)
      .mockResolvedValueOnce(makeChunk(501, 500) as never);

    const result = await listProductionScheduleRowsForSignageMachineBoard({
      machineName: '機種A',
      locationKey: 'kiosk-1',
      maxRows: 2000,
      pageSize: 500,
      maxScanPages: 2,
    });

    expect(result.rows).toHaveLength(1000);
    expect(result.scheduleExhausted).toBe(false);
    expect(result.hitScanCap).toBe(true);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
  });

  it('資源CD一覧をresourceCd配列へ整形して返す', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { resourceCd: 'R01' },
      { resourceCd: 'R02' },
    ] as never);
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue([
      { resourceCd: 'R01', resourceName: '設備A' },
      { resourceCd: 'R01', resourceName: '設備A-予備' },
      { resourceCd: 'R02', resourceName: '設備B' },
    ] as never);

    const result = await listProductionScheduleResources({ deviceScopeKey: 'Test - kiosk1' });

    expect(result).toEqual({
      resources: ['R01', 'R02'],
      resourceItems: [
        { resourceCd: 'R01', excluded: false },
        { resourceCd: 'R02', excluded: false },
      ],
      resourceNameMap: {
        R01: ['設備A', '設備A-予備'],
        R02: ['設備B'],
      },
    });
  });

  it('工程順利用状況をresourceCdごとのMap形式へ整形する', async () => {
    vi.mocked(prisma.$queryRaw).mockResolvedValue([
      { resourceCd: 'R01', orderNumbers: [1, 3] },
      { resourceCd: 'R02', orderNumbers: [2] },
    ] as never);

    const result = await getProductionScheduleOrderUsage({
      locationKey: 'kiosk-1',
      resourceCds: ['R01', 'R02'],
    });

    expect(result).toEqual({
      R01: [1, 3],
      R02: [2],
    });
  });

  it('一覧取得でglobalRankを含む行を返す', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          rowData: {
            ProductNo: '0001',
            FSEIBAN: 'A',
            FHINCD: 'X',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            progress: '',
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null,
        },
      ] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: 'A',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.globalRank).toBe(5);
  });

  it('一覧取得で rowData.FKOJUNST を返す', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          rowData: {
            ProductNo: '0001',
            FSEIBAN: 'A',
            FHINCD: 'X',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            FKOJUNST: 'X',
            progress: '',
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null,
        },
      ] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: 'A',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect((result.rows[0]?.rowData as Record<string, unknown>).FKOJUNST).toBe('X');
  });

  it('一覧取得で実績基準時間を資源CDマッピング経由で解決できる', async () => {
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([
      {
        location: 'kiosk-1',
        fhincd: 'X',
        resourceCd: 'R02',
        medianPerPieceMinutes: 4.2,
        p75PerPieceMinutes: null,
      },
    ] as never);
    vi.mocked(prisma.productionScheduleResourceCodeMapping.findMany).mockResolvedValue([
      {
        fromResourceCd: 'R01',
        toResourceCd: 'R02',
        priority: 1,
        enabled: true,
      },
    ] as never);
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          rowData: {
            ProductNo: '0001',
            FSEIBAN: 'A',
            FHINCD: 'X',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            progress: '',
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null,
        },
      ] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: 'A',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect(result.rows[0]?.actualPerPieceMinutes).toBe(4.2);
    expect(result.rows[0]).not.toHaveProperty('actualEstimatedMinutes');
  });

  it('一覧取得で実績基準時間をGroupCD経由で解決できる', async () => {
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([
      {
        location: 'kiosk-1',
        fhincd: 'X',
        resourceCd: 'R03',
        medianPerPieceMinutes: 5.1,
        p75PerPieceMinutes: null,
      },
    ] as never);
    vi.mocked(prisma.productionScheduleResourceCodeMapping.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.productionScheduleResourceMaster.findMany)
      .mockResolvedValueOnce([{ resourceCd: 'R01', groupCd: 'CUT-A' }] as never)
      .mockResolvedValueOnce([
        { resourceCd: 'R01', groupCd: 'CUT-A' },
        { resourceCd: 'R03', groupCd: 'CUT-A' },
      ] as never);
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          rowData: {
            ProductNo: '0001',
            FSEIBAN: 'A',
            FHINCD: 'X',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            progress: '',
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null,
        },
      ] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: 'A',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect(result.rows[0]?.actualPerPieceMinutes).toBe(5.1);
  });

  it('一覧取得で少数サンプルキーは資源中央値へ縮小される', async () => {
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([
      {
        location: 'kiosk-1',
        fhincd: 'X',
        resourceCd: 'R01',
        sampleCount: 1,
        medianPerPieceMinutes: 10,
        p75PerPieceMinutes: 20,
      },
      {
        location: 'kiosk-1',
        fhincd: 'Y',
        resourceCd: 'R01',
        sampleCount: 20,
        medianPerPieceMinutes: 4,
        p75PerPieceMinutes: 7,
      },
    ] as never);
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          rowData: {
            ProductNo: '0001',
            FSEIBAN: 'A',
            FHINCD: 'X',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            progress: '',
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null,
        },
      ] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: 'A',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect(result.rows[0]?.actualPerPieceMinutes).toBe(5.5);
  });

  it('一覧取得でactor locationに特徴量が無い場合はshared fallbackを使う', async () => {
    vi.mocked(resolveActualHoursLocationCandidates).mockReturnValue(['kiosk-1', 'shared-global-rank']);
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([
      {
        location: 'shared-global-rank',
        fhincd: 'X',
        resourceCd: 'R01',
        medianPerPieceMinutes: 6.6,
        p75PerPieceMinutes: null,
      },
    ] as never);
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          rowData: {
            ProductNo: '0001',
            FSEIBAN: 'A',
            FHINCD: 'X',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            progress: '',
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null,
        },
      ] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: 'A',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect(result.rows[0]?.actualPerPieceMinutes).toBe(6.6);
    expect(prisma.productionScheduleActualHoursFeature.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          location: { in: ['kiosk-1', 'shared-global-rank'] },
        }),
      })
    );
  });

  it('一覧取得でactor/shared双方に特徴量がある場合はactorを優先する', async () => {
    vi.mocked(resolveActualHoursLocationCandidates).mockReturnValue(['kiosk-1', 'shared-global-rank']);
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([
      {
        location: 'shared-global-rank',
        fhincd: 'X',
        resourceCd: 'R01',
        medianPerPieceMinutes: 9.9,
        p75PerPieceMinutes: null,
      },
      {
        location: 'kiosk-1',
        fhincd: 'X',
        resourceCd: 'R01',
        medianPerPieceMinutes: 4.4,
        p75PerPieceMinutes: null,
      },
    ] as never);
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          rowData: {
            ProductNo: '0001',
            FSEIBAN: 'A',
            FHINCD: 'X',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            progress: '',
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null,
        },
      ] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: 'A',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect(result.rows[0]?.actualPerPieceMinutes).toBe(4.4);
  });

  it('responseProfile=leaderboard では actual-hours のみ省略し機種名 enrich は行う', async () => {
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([
      {
        location: 'kiosk-1',
        fhincd: 'X',
        resourceCd: 'R01',
        medianPerPieceMinutes: 4.4,
        p75PerPieceMinutes: null
      }
    ] as never);
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 'winner-stub' }] as never)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'row-1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          rowData: {
            ProductNo: '0001',
            FSEIBAN: 'A',
            FHINCD: 'X',
            FSIGENCD: 'R01',
            FKOJUN: '10',
            progress: ''
          },
          processingOrder: 2,
          globalRank: 5,
          note: null,
          processingType: null,
          dueDate: null
        }
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: 'A',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
      responseProfile: 'leaderboard'
    });

    expect(result.total).toBe(1);
    expect(result.rows[0]?.actualPerPieceMinutes).toBeNull();
    expect(result.rows[0]?.resolvedMachineName).toBe('機種-A');
    expect(result.rows[0]?.customerName).toBeNull();
    expect(prisma.productionScheduleActualHoursFeature.findMany).not.toHaveBeenCalled();
    expect(enrichProductionScheduleRowsWithResolvedMachineName).toHaveBeenCalledTimes(1);
    expect(enrichProductionScheduleRowsWithCustomerName).toHaveBeenCalledTimes(1);

    const partKey = ['A', '0001', 'X'].join('\0');
    expect(result.leaderboardFooterChipsByPartKey?.[partKey]).toEqual([]);
  });

  it('responseProfile=leaderboard では手動割当が pageSize を超えても切り捨てない', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 'winner-stub' }] as never)
      .mockResolvedValueOnce([{ total: 10n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'm1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'S1',
          rowData: { ProductNo: '0001', FSEIBAN: 'S1', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '1', progress: '' },
          processingOrder: 1,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        },
        {
          id: 'm2',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'S2',
          rowData: { ProductNo: '0002', FSEIBAN: 'S2', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '1', progress: '' },
          processingOrder: 2,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        },
        {
          id: 'm3',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'S3',
          rowData: { ProductNo: '0003', FSEIBAN: 'S3', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '1', progress: '' },
          processingOrder: 3,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 2,
      queryText: '',
      productNos: [],
      resourceCds: ['R01'],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      allowResourceOnly: true,
      locationKey: 'kiosk-1',
      responseProfile: 'leaderboard'
    });

    expect(result.rows).toHaveLength(3);
    expect(new Set(result.rows.map((r) => r.id))).toEqual(new Set(['m1', 'm2', 'm3']));
  });

  it('responseProfile=leaderboard では同一製番展開で関連行をまとめて含める', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 'winner-stub' }] as never)
      .mockResolvedValueOnce([{ total: 5n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'm1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'SX',
          rowData: { ProductNo: '0001', FSEIBAN: 'SX', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '10', progress: '' },
          processingOrder: 1,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'm1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'SX',
          rowData: { ProductNo: '0001', FSEIBAN: 'SX', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '10', progress: '' },
          processingOrder: 1,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        },
        {
          id: 'm2',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'SX',
          rowData: { ProductNo: '0001', FSEIBAN: 'SX', FHINCD: 'X', FSIGENCD: 'R02', FKOJUN: '20', progress: '' },
          processingOrder: null,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 5,
      queryText: '',
      productNos: [],
      resourceCds: ['R01', 'R02'],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      allowResourceOnly: true,
      locationKey: 'kiosk-1',
      responseProfile: 'leaderboard'
    });

    const ids = new Set(result.rows.map((r) => r.id));
    expect(ids.has('m1')).toBe(true);
    expect(ids.has('m2')).toBe(true);
  });

  it('responseProfile=leaderboard で resourceCds が1件のとき他資源の同一製番行を展開しない', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 'winner-stub' }] as never)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'm1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'SX',
          rowData: { ProductNo: '0001', FSEIBAN: 'SX', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '10', progress: '' },
          processingOrder: 1,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 5,
      queryText: '',
      productNos: [],
      resourceCds: ['R01'],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      allowResourceOnly: true,
      locationKey: 'kiosk-1',
      responseProfile: 'leaderboard'
    });

    expect(result.rows.map((r) => r.id)).toEqual(['m1']);
  });

  it('responseProfile=leaderboard では製番展開時に元の検索語で関連行を落とさない', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 'winner-stub' }] as never)
      .mockResolvedValueOnce([{ total: 2n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'm1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'SX',
          rowData: { ProductNo: '0001', FSEIBAN: 'SX', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '10', progress: '' },
          processingOrder: 1,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'm1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'SX',
          rowData: { ProductNo: '0001', FSEIBAN: 'SX', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '10', progress: '' },
          processingOrder: 1,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        },
        {
          id: 'm2',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'SX',
          rowData: { ProductNo: '9999', FSEIBAN: 'SX', FHINCD: 'X', FSIGENCD: 'R02', FKOJUN: '20', progress: '' },
          processingOrder: null,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 5,
      queryText: '0001',
      productNos: [],
      resourceCds: ['R01', 'R02'],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      allowResourceOnly: true,
      locationKey: 'kiosk-1',
      responseProfile: 'leaderboard'
    });

    expect(new Set(result.rows.map((r) => r.id))).toEqual(new Set(['m1', 'm2']));
  });

  it('responseProfile=leaderboard で手動行が無いとき納期順フィラーで pageSize まで埋める', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 'winner-stub' }] as never)
      .mockResolvedValueOnce([{ total: 100n }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: 'f2',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'Z2',
          rowData: { ProductNo: '1001', FSEIBAN: 'Z2', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '1', progress: '' },
          processingOrder: null,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: new Date('2026-03-15T00:00:00.000Z'),
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        },
        {
          id: 'f1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'Z1',
          rowData: { ProductNo: '1000', FSEIBAN: 'Z1', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '1', progress: '' },
          processingOrder: null,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: new Date('2026-04-01T00:00:00.000Z'),
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 2,
      queryText: '',
      productNos: [],
      resourceCds: ['R01'],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      allowResourceOnly: true,
      locationKey: 'kiosk-1',
      responseProfile: 'leaderboard'
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.id)).toEqual(['f2', 'f1']);
  });

  it('responseProfile=leaderboard で同一製番の 5/1 行が複数資源へ展開されうる', async () => {
    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 'winner-stub' }] as never)
      .mockResolvedValueOnce([{ total: 2n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'seed-r1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'SEI-001',
          rowData: { ProductNo: '1000', FSEIBAN: 'SEI-001', FHINCD: 'A', FSIGENCD: 'R01', FKOJUN: '10', progress: '' },
          processingOrder: 1,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: new Date('2026-05-01T00:00:00.000Z'),
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'seed-r2',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'SEI-001',
          rowData: { ProductNo: '1001', FSEIBAN: 'SEI-001', FHINCD: 'B', FSIGENCD: 'R02', FKOJUN: '20', progress: '' },
          processingOrder: null,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: new Date('2026-05-01T00:00:00.000Z'),
          plannedQuantity: null,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 5,
      queryText: '',
      productNos: [],
      resourceCds: ['R01', 'R02'],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      allowResourceOnly: true,
      locationKey: 'kiosk-1',
      responseProfile: 'leaderboard'
    });

    expect(result.rows.map((r) => [r.id, (r.rowData as Record<string, unknown>).FSIGENCD, r.dueDate?.toISOString?.() ?? null])).toEqual([
      ['seed-r1', 'R01', '2026-05-01T00:00:00.000Z'],
      ['seed-r2', 'R02', '2026-05-01T00:00:00.000Z']
    ]);
  });

  it('responseProfile=leaderboard は display item 件数と split 展開を使う', async () => {
    const countSpy = vi
      .spyOn(listCountService, 'countProductionScheduleDashboardVisibleLeaderboardUnits')
      .mockResolvedValue(3n);
    const expandSpy = vi
      .spyOn(leaderboardSplitExpansion, 'expandLeaderboardParentRowsForResponse')
      .mockImplementation(async ({ rows, locationKey }) => {
        expect(locationKey).toBe('kiosk-1');
        return rows.flatMap((row) => [
          {
            ...row,
            id: `split:a-${row.id}`,
            sourceRowId: row.id,
            isSplit: true,
            splitId: 'split-a',
            splitNo: 1,
            splitQuantity: 2,
            plannedQuantity: 2,
            processingOrder: 1
          },
          {
            ...row,
            id: `split:b-${row.id}`,
            sourceRowId: row.id,
            isSplit: true,
            splitId: 'split-b',
            splitNo: 2,
            splitQuantity: 3,
            plannedQuantity: 3,
            processingOrder: 2
          }
        ]);
      });

    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 'winner-stub' }] as never)
      .mockResolvedValueOnce([
        {
          id: 'parent-1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'S1',
          rowData: { ProductNo: '0001', FSEIBAN: 'S1', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '1', progress: '' },
          processingOrder: 1,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: 5,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: 'A',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
      responseProfile: 'leaderboard'
    });

    expect(countSpy).toHaveBeenCalledTimes(1);
    expect(expandSpy).toHaveBeenCalledTimes(1);
    expect(result.total).toBe(3);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.id).toBe('split:a-parent-1');
    expect(result.rows[1]?.processingOrder).toBe(2);

    countSpy.mockRestore();
    expandSpy.mockRestore();
  });

  it('responseProfile=leaderboard は split flag ON でも query unit test が通る', async () => {
    process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = 'true';
    expect(isProductionScheduleOrderSplitEnabled()).toBe(true);

    vi.mocked(prisma.$queryRaw)
      .mockResolvedValueOnce([{ id: 'winner-stub' }] as never)
      .mockResolvedValueOnce([{ total: 1n }] as never)
      .mockResolvedValueOnce([
        {
          id: 'parent-1',
          occurredAt: new Date('2026-03-09T00:00:00.000Z'),
          seibanJoinKey: 'S1',
          rowData: { ProductNo: '0001', FSEIBAN: 'S1', FHINCD: 'X', FSIGENCD: 'R01', FKOJUN: '1', progress: '' },
          processingOrder: 1,
          globalRank: null,
          note: null,
          processingType: null,
          dueDate: null,
          plannedQuantity: 5,
          plannedStartDate: null,
          plannedEndDate: null
        }
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: 'A',
      productNos: [],
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
      responseProfile: 'leaderboard'
    });

    expect(prisma.productionScheduleOrderSplit.findMany).toHaveBeenCalled();
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});
