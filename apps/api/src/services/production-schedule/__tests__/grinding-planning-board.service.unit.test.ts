import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sourceRow = {
    id: 'source-row-1',
    rowData: {
      FSEIBAN: 'ORDER-A',
      FHINCD: 'PART-A',
      FSIGENCD: '305',
      FKOJUN: '1',
      ProductNo: '1'
    },
    updatedAt: new Date('2026-09-09T00:00:00.000Z')
  };
  const state = { id: 'state-1', version: 0, seibanOrder: ['ORDER-A'] };
  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    csvDashboardRow: { findMany: vi.fn() },
    productionScheduleGrindingPlanningBoardState: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    productionScheduleGrindingPlanningBoardOverride: { findMany: vi.fn() },
    productionScheduleOrderAssignment: { findMany: vi.fn() },
    productionScheduleOrderSplitAssignment: { findMany: vi.fn() },
    productionScheduleResourceMaster: { findMany: vi.fn() }
  };
  return {
    prisma,
    sourceRow,
    state,
    getResourceCategoryPolicy: vi.fn(),
    isProductionScheduleGrindingResourceCd: vi.fn(),
    isProductionScheduleCuttingResourceCd: vi.fn(),
    normalizeProductionScheduleResourceCd: vi.fn(),
    isProductionScheduleOrderSplitEnabled: vi.fn(),
    acquireParentRowLock: vi.fn(),
    resolveSeibanMachineDisplayNamesBatched: vi.fn(),
    projectGrindingPlanningBoard: vi.fn(),
    buildGrindingPlanningBoardLogicalKey: vi.fn(),
    buildGrindingPlanningBoardRowItemId: vi.fn()
  };
});

vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../policies/resource-category-policy.service.js', () => ({
  getResourceCategoryPolicy: mocks.getResourceCategoryPolicy,
  isProductionScheduleGrindingResourceCd: mocks.isProductionScheduleGrindingResourceCd,
  isProductionScheduleCuttingResourceCd: mocks.isProductionScheduleCuttingResourceCd,
  normalizeProductionScheduleResourceCd: mocks.normalizeProductionScheduleResourceCd
}));
vi.mock('../order-split/production-schedule-order-split-feature.js', () => ({
  isProductionScheduleOrderSplitEnabled: mocks.isProductionScheduleOrderSplitEnabled
}));
vi.mock('../order-split/production-schedule-parent-row-lock.service.js', () => ({
  acquireProductionScheduleParentRowLockInTransaction: mocks.acquireParentRowLock
}));
vi.mock('../seiban-machine-display-names.service.js', () => ({
  resolveSeibanMachineDisplayNamesBatched: mocks.resolveSeibanMachineDisplayNamesBatched
}));
vi.mock('../grinding-planning-board-projection.js', () => ({
  projectGrindingPlanningBoard: mocks.projectGrindingPlanningBoard,
  buildGrindingPlanningBoardLogicalKey: mocks.buildGrindingPlanningBoardLogicalKey,
  buildGrindingPlanningBoardRowItemId: mocks.buildGrindingPlanningBoardRowItemId
}));

import { createInMemoryLeaderboardShellSnapshotStore } from '../leaderboard/leaderboard-shell-snapshot.store.js';
import {
  getGrindingPlanningBoard,
  updateGrindingPlanningBoardSeibanOrder
} from '../grinding-planning-board.service.js';

function configurePersistence(): void {
  const { prisma, sourceRow, state } = mocks;
  const details = {
    id: sourceRow.id,
    updatedAt: sourceRow.updatedAt,
    rowNotes: [{ dueDate: new Date('2026-09-20T00:00:00.000Z') }],
    orderSupplements: [{ plannedQuantity: 1, plannedEndDate: new Date('2026-09-20T00:00:00.000Z') }],
    productionScheduleProgress: { isCompleted: false, updatedAt: sourceRow.updatedAt },
    productionScheduleExternalCompletion: { isExternallyCompleted: false, updatedAt: sourceRow.updatedAt },
    orderSplits: []
  };
  mocks.getResourceCategoryPolicy.mockResolvedValue({ cuttingExcludedResourceCds: [] });
  mocks.isProductionScheduleGrindingResourceCd.mockReturnValue(true);
  mocks.isProductionScheduleCuttingResourceCd.mockReturnValue(false);
  mocks.normalizeProductionScheduleResourceCd.mockImplementation((value: string | null | undefined) => {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  });
  mocks.isProductionScheduleOrderSplitEnabled.mockReturnValue(false);
  mocks.resolveSeibanMachineDisplayNamesBatched.mockResolvedValue({ machineNames: { 'ORDER-A': 'Machine A' } });
  mocks.buildGrindingPlanningBoardLogicalKey.mockImplementation((data: Record<string, unknown>) => JSON.stringify([data.FSEIBAN, data.FHINCD, data.FSIGENCD, data.FKOJUN]));
  mocks.buildGrindingPlanningBoardRowItemId.mockImplementation((data: Record<string, unknown>) => `row:${Buffer.from(JSON.stringify([data.FSEIBAN, data.FHINCD, data.FSIGENCD, data.FKOJUN])).toString('base64url')}`);
  mocks.projectGrindingPlanningBoard.mockReturnValue({
    allItems: [{
      itemId: 'row:item-a',
      itemRevision: 'item-revision-a',
      version: 0,
      sourceRowId: sourceRow.id,
      fseiban: 'ORDER-A',
      originalResourceCd: '305',
      effectiveResourceCd: '305',
      originalDueDate: '2026-09-20',
      effectiveDueDate: '2026-09-20',
      isCompleted: false
    }],
    items: [{
      itemId: 'row:item-a',
      itemRevision: 'item-revision-a',
      version: 0,
      sourceRowId: sourceRow.id,
      fseiban: 'ORDER-A',
      originalResourceCd: '305',
      effectiveResourceCd: '305',
      originalDueDate: '2026-09-20',
      effectiveDueDate: '2026-09-20',
      isCompleted: false
    }],
    load: [{ resourceCd: '305', requiredMinutes: 30, unknownRequiredMinutes: 0 }],
    unknownRequiredMinutesCount: 0,
    progress: { bySeiban: new Map([['ORDER-A', { completed: 0, total: 1 }]]) }
  });
  prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue(state);
  prisma.csvDashboardRow.findMany.mockResolvedValue([details]);
  prisma.productionScheduleGrindingPlanningBoardOverride.findMany.mockResolvedValue([]);
  prisma.productionScheduleOrderAssignment.findMany.mockResolvedValue([]);
  prisma.productionScheduleOrderSplitAssignment.findMany.mockResolvedValue([]);
  prisma.productionScheduleResourceMaster.findMany.mockResolvedValue([{ resourceCd: '305' }, { resourceCd: '581' }]);
  prisma.$queryRaw.mockImplementation(async (strings: readonly string[]) => strings.join(' ').includes('ProductionScheduleGrindingPlanningBoardState') ? [state] : [sourceRow]);
  prisma.productionScheduleGrindingPlanningBoardState.update.mockResolvedValue({ ...state, version: 1, seibanOrder: ['ORDER-A', 'ORDER-B'] });
  mocks.acquireParentRowLock.mockResolvedValue(undefined);
}

describe('grinding planning board service orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configurePersistence();
  });

  it('projects a paged board with resources, progress, and a snapshot binding', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const response = await getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      pageSize: 1,
      snapshotStore
    });

    expect(response.items).toHaveLength(1);
    expect(response.registeredFseibans).toEqual(['ORDER-A']);
    expect(response.resources).toEqual(['305', '581']);
    expect(response.seibanProgress).toEqual({ 'ORDER-A': { completed: 0, total: 1 } });
    expect(response.snapshotId).toEqual(expect.any(String));
    expect(response.nextCursor).toBeNull();

    await expect(getGrindingPlanningBoard({
      siteKey: 'other-site',
      category: 'grinding',
      view: 'seiban',
      cursor: 1,
      snapshotId: response.snapshotId,
      snapshotStore
    })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
  });

  it('hydrates every row when the board has more than the PostgreSQL bind limit', async () => {
    const rowCount = 32_768;
    const largeRows = Array.from({ length: rowCount }, (_, index) => ({
      ...mocks.sourceRow,
      id: `source-row-${index + 1}`
    }));
    const detailIds: string[] = [];
    const rankIds: string[] = [];
    const detailBatchSizes: number[] = [];
    const rankBatchSizes: number[] = [];

    mocks.prisma.$queryRaw.mockImplementation(async (strings: readonly string[]) => (
      strings.join(' ').includes('ProductionScheduleGrindingPlanningBoardState') ? [mocks.state] : largeRows
    ));
    mocks.prisma.csvDashboardRow.findMany.mockImplementation(async (args: { where: { id: { in: string[] } } }) => {
      const ids = args.where.id.in;
      detailBatchSizes.push(ids.length);
      detailIds.push(...ids);
      return ids.map((id) => ({
        id,
        updatedAt: mocks.sourceRow.updatedAt,
        rowNotes: [{ dueDate: new Date('2026-09-20T00:00:00.000Z') }],
        orderSupplements: [{ plannedQuantity: 1, plannedEndDate: new Date('2026-09-20T00:00:00.000Z') }],
        productionScheduleProgress: { isCompleted: false, updatedAt: mocks.sourceRow.updatedAt },
        productionScheduleExternalCompletion: { isExternallyCompleted: false, updatedAt: mocks.sourceRow.updatedAt },
        orderSplits: []
      }));
    });
    mocks.prisma.productionScheduleOrderAssignment.findMany.mockImplementation(async (args: { where: { csvDashboardRowId: { in: string[] } } }) => {
      const ids = args.where.csvDashboardRowId.in;
      rankBatchSizes.push(ids.length);
      rankIds.push(...ids);
      return [];
    });

    const response = await getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      pageSize: 1,
      snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 })
    });

    expect(response.items).toHaveLength(1);
    expect(detailBatchSizes.every((size) => size <= 900)).toBe(true);
    expect(rankBatchSizes.every((size) => size <= 900)).toBe(true);
    expect(new Set(detailIds)).toHaveLength(rowCount);
    expect(new Set(rankIds)).toHaveLength(rowCount);
    expect(detailIds).toHaveLength(rowCount);
    expect(rankIds).toHaveLength(rowCount);
  });

  it('updates the shared seiban order only after validating its board revision', async () => {
    const secondSourceRow = {
      ...mocks.sourceRow,
      id: 'source-row-2',
      rowData: { ...mocks.sourceRow.rowData, FSEIBAN: 'ORDER-B' }
    };
    mocks.prisma.$queryRaw.mockImplementation(async (strings: readonly string[]) => strings.join(' ').includes('ProductionScheduleGrindingPlanningBoardState') ? [mocks.state] : [mocks.sourceRow, secondSourceRow]);
    const transactionClient = {
      $queryRaw: mocks.prisma.$queryRaw,
      productionScheduleGrindingPlanningBoardState: {
        update: mocks.prisma.productionScheduleGrindingPlanningBoardState.update
      }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));
    const sourceRevision = JSON.stringify({
      boardVersion: 0,
      orderHash: createHash('sha256').update(JSON.stringify(['ORDER-A'])).digest('hex')
    });

    const result = await updateGrindingPlanningBoardSeibanOrder({
      siteKey: 'site-a',
      sourceRevision,
      fseibans: ['ORDER-A', 'ORDER-B']
    });

    expect(result.seibanOrder).toEqual(['ORDER-A', 'ORDER-B']);
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardState.update).toHaveBeenCalledTimes(1);
  });

  it('rejects an outdated board revision before writing the seiban order', async () => {
    const transactionClient = {
      $queryRaw: mocks.prisma.$queryRaw,
      productionScheduleGrindingPlanningBoardState: {
        update: mocks.prisma.productionScheduleGrindingPlanningBoardState.update
      }
    };
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient));

    await expect(updateGrindingPlanningBoardSeibanOrder({
      siteKey: 'site-a',
      sourceRevision: JSON.stringify({ boardVersion: 99, orderHash: createHash('sha256').update(JSON.stringify(['ORDER-A'])).digest('hex') }),
      fseibans: ['ORDER-A']
    })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_ORDER' });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardState.update).not.toHaveBeenCalled();
  });
});
