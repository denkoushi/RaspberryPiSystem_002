import { beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';

const leaderboardMocks = vi.hoisted(() => ({
  fetchLeaderboardScheduleRowsWithSeibanAwarePriority: vi.fn(),
  fetchLeaderboardShellMergedPrefixRows: vi.fn(),
  fetchLeaderboardShellRowsContinuationChunk: vi.fn()
}));

vi.mock('../leaderboard/leaderboard-row-selection.service.js', () => leaderboardMocks);

import {
  listProductionScheduleRows,
  listSelfInspectionEligibleProductionScheduleRows
} from '../production-schedule-query.service.js';

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    productionScheduleSeibanMachineNameSupplement: { findMany: vi.fn() },
    productionScheduleResourceCategoryConfig: { findUnique: vi.fn() },
    productionScheduleActualHoursFeature: { findMany: vi.fn() },
    productionScheduleResourceCodeMapping: { findMany: vi.fn() },
    productionScheduleResourceMaster: { findMany: vi.fn() },
    partMeasurementTemplate: { findMany: vi.fn() },
    selfInspectionSession: { findMany: vi.fn() }
  }
}));

const selfInspectionMocks = vi.hoisted(() => ({
  createSelfInspectionDecorationCache: vi.fn(async () => ({
    policy: {
      grindingResourceCds: ['581'],
      cuttingExcludedResourceCds: []
    },
    templateByKey: new Map(),
    sessionsByScheduleRowId: new Map()
  })),
  ensureSelfInspectionTemplatesForRows: vi.fn(async () => undefined),
  ensureSelfInspectionSessionsInCache: vi.fn(async () => undefined)
}));

vi.mock('../../part-measurement/self-inspection.service.js', () => ({
  ...selfInspectionMocks,
  SelfInspectionService: class {
    async buildLeaderboardDecorations(rows: Array<{ id: string }>) {
      return rows.map((row) => ({
        id: row.id,
        hasSelfInspectionDrawing: row.id === 'row-eligible',
        selfInspectionTemplateId: row.id === 'row-eligible' ? 'tpl-1' : null,
        selfInspectionStatus: null,
        selfInspectionEntryPath: row.id === 'row-eligible' ? '/kiosk/part-measurement/self-inspection/sessions/s1' : null,
        resolvedPlannedQuantity: 5
      }));
    }
  }
}));

function makeDashboardRow(id: string) {
  return {
    id,
    seibanJoinKey: 'FS',
    occurredAt: new Date(),
    rowData: {
      ProductNo: `PN-${id}`,
      FSEIBAN: 'FS',
      FHINCD: 'H',
      FHINMEI: '品名',
      FSIGENCD: '581',
      FKOJUN: '1'
    },
    processingOrder: null,
    globalRank: null,
    note: null,
    processingType: null,
    dueDate: null,
    plannedQuantity: 5,
    plannedStartDate: null,
    plannedEndDate: null
  };
}

const baseListParams = {
  page: 1,
  pageSize: 50,
  queryText: '',
  productNos: [] as string[],
  resourceCds: ['581'],
  assignedOnlyCds: [] as string[],
  hasNoteOnly: false,
  hasDueDateOnly: false,
  allowResourceOnly: true,
  locationKey: 'kiosk-1'
} as const;

describe('listSelfInspectionEligibleProductionScheduleRows scan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leaderboardMocks.fetchLeaderboardScheduleRowsWithSeibanAwarePriority.mockReset();
    vi.mocked(prisma.productionScheduleSeibanMachineNameSupplement.findMany).mockResolvedValue([]);
    vi.mocked(prisma.productionScheduleResourceCategoryConfig.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.productionScheduleActualHoursFeature.findMany).mockResolvedValue([]);
    vi.mocked(prisma.productionScheduleResourceCodeMapping.findMany).mockResolvedValue([]);
    vi.mocked(prisma.productionScheduleResourceMaster.findMany).mockResolvedValue([]);
    vi.mocked(prisma.partMeasurementTemplate.findMany).mockResolvedValue([]);
    vi.mocked(prisma.selfInspectionSession.findMany).mockResolvedValue([]);
  });

  it('does not scan the dashboard when search filters are empty', async () => {
    let dashboardPageQueries = 0;
    vi.mocked(prisma.$queryRaw).mockImplementation(async () => {
      dashboardPageQueries += 1;
      return [];
    });

    const result = await listSelfInspectionEligibleProductionScheduleRows({
      ...baseListParams,
      queryText: '',
      resourceCds: []
    });

    expect(dashboardPageQueries).toBe(0);
    expect(result.rows).toHaveLength(0);
    expect(result.hasMore).toBe(false);
  });

  it('fetches a second dashboard chunk when the first 200 rows have no eligible candidate', async () => {
    let dashboardPageQueries = 0;

    vi.mocked(prisma.$queryRaw).mockImplementation(async () => {
      dashboardPageQueries += 1;
      if (dashboardPageQueries === 1) {
        return Array.from({ length: 200 }, (_, index) => makeDashboardRow(`row-${index}`));
      }
      if (dashboardPageQueries === 2) {
        return [makeDashboardRow('row-eligible')];
      }
      return [];
    });

    const result = await listSelfInspectionEligibleProductionScheduleRows({
      ...baseListParams
    });

    expect(dashboardPageQueries).toBe(2);
    expect(leaderboardMocks.fetchLeaderboardScheduleRowsWithSeibanAwarePriority).not.toHaveBeenCalled();
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toBe('row-eligible');
  });

  it('routes selfInspectionEligibleOnly through the dashboard OFFSET scanner (ignores leaderboard profile)', async () => {
    let dashboardPageQueries = 0;

    vi.mocked(prisma.$queryRaw).mockImplementation(async () => {
      dashboardPageQueries += 1;
      if (dashboardPageQueries === 1) {
        return Array.from({ length: 200 }, (_, index) => makeDashboardRow(`row-${index}`));
      }
      return [makeDashboardRow('row-eligible')];
    });

    const result = await listProductionScheduleRows({
      ...baseListParams,
      selfInspectionEligibleOnly: true,
      responseProfile: 'leaderboard'
    });

    expect(dashboardPageQueries).toBeGreaterThanOrEqual(2);
    expect(leaderboardMocks.fetchLeaderboardScheduleRowsWithSeibanAwarePriority).not.toHaveBeenCalled();
    expect(result.rows[0]?.id).toBe('row-eligible');
  });

  it('deduplicates the same eligible row when a later chunk would repeat it', async () => {
    let dashboardPageQueries = 0;

    vi.mocked(prisma.$queryRaw).mockImplementation(async () => {
      dashboardPageQueries += 1;
      if (dashboardPageQueries === 1) {
        return [
          makeDashboardRow('row-eligible'),
          ...Array.from({ length: 199 }, (_, index) => makeDashboardRow(`row-${index}`))
        ];
      }
      return [makeDashboardRow('row-eligible')];
    });

    const result = await listSelfInspectionEligibleProductionScheduleRows({
      ...baseListParams
    });

    expect(dashboardPageQueries).toBeGreaterThanOrEqual(2);
    expect(result.rows.filter((row) => row.id === 'row-eligible')).toHaveLength(1);
    expect(result.total).toBeUndefined();
  });
});
