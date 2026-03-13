import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProductionScheduleOrderUsage,
  listProductionScheduleResources,
  listProductionScheduleRows,
} from '../production-schedule-query.service.js';
import { resolveActualHoursLocationCandidates } from '../actual-hours-location-scope.service.js';
import { prisma } from '../../../lib/prisma.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
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

describe('production-schedule-query.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveActualHoursLocationCandidates).mockImplementation((locationKey: string) => [locationKey]);
    vi.mocked(prisma.productionScheduleResourceCategoryConfig.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([]);
    vi.mocked(prisma.productionScheduleResourceCodeMapping.findMany).mockResolvedValue([]);
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue([]);
  });

  it('資源CD単独指定時（assignedOnlyなし）は空結果を返しDBクエリしない', async () => {
    const result = await listProductionScheduleRows({
      page: 1,
      pageSize: 20,
      queryText: '',
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

    const result = await listProductionScheduleResources();

    expect(result).toEqual({
      resources: ['R01', 'R02'],
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
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect(result.rows[0]?.actualPerPieceMinutes).toBe(5.1);
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
      resourceCds: [],
      assignedOnlyCds: [],
      hasNoteOnly: false,
      hasDueDateOnly: false,
      locationKey: 'kiosk-1',
    });

    expect(result.rows[0]?.actualPerPieceMinutes).toBe(4.4);
  });
});

