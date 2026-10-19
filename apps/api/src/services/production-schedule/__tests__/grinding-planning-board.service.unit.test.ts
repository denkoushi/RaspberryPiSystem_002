import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    productionScheduleGrindingPlanningBoardOverride: { findMany: vi.fn(), aggregate: vi.fn(), upsert: vi.fn() },
    productionScheduleOrderAssignment: { findMany: vi.fn() },
    productionScheduleOrderSplitAssignment: { findMany: vi.fn() },
    productionScheduleResourceMaster: { findMany: vi.fn(), aggregate: vi.fn() },
    productionScheduleSeibanMachineNameSupplement: { aggregate: vi.fn() }
  };
  return {
    prisma,
    findMaterialArrivalStatusByPart: vi.fn(),
    sourceRow,
    state,
    getResourceCategoryPolicy: vi.fn(),
    filterProductionScheduleResourceCdsByCategoryWithPolicy: vi.fn(),
    isProductionScheduleGrindingResourceCd: vi.fn(),
    isProductionScheduleCuttingResourceCd: vi.fn(),
    normalizeProductionScheduleResourceCd: vi.fn(),
    isProductionScheduleOrderSplitEnabled: vi.fn(),
    acquireParentRowLock: vi.fn(),
    resolveSeibanMachineDisplayNamesBatched: vi.fn(),
    projectGrindingPlanningBoard: vi.fn(),
    buildGrindingPlanningBoardLogicalKey: vi.fn(),
    buildGrindingPlanningBoardRowItemId: vi.fn(),
    readGrindingPlanningBoardSnapshotGenerationToken: vi.fn()
  };
});

vi.mock('../../purchase-order-lookup/material-arrival-status.service.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../purchase-order-lookup/material-arrival-status.service.js')>(),
  findMaterialArrivalStatusByPart: mocks.findMaterialArrivalStatusByPart
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('../policies/resource-category-policy.service.js', () => ({
  getResourceCategoryPolicy: mocks.getResourceCategoryPolicy,
  filterProductionScheduleResourceCdsByCategoryWithPolicy: mocks.filterProductionScheduleResourceCdsByCategoryWithPolicy,
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
vi.mock('../grinding-planning-board-projection.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../grinding-planning-board-projection.js')>(),
  projectGrindingPlanningBoard: mocks.projectGrindingPlanningBoard,
  buildGrindingPlanningBoardLogicalKey: mocks.buildGrindingPlanningBoardLogicalKey,
  buildGrindingPlanningBoardRowItemId: mocks.buildGrindingPlanningBoardRowItemId
}));
vi.mock('../leaderboard/leaderboard-shell-snapshot-generation.js', () => ({
  readGrindingPlanningBoardSnapshotGenerationToken: mocks.readGrindingPlanningBoardSnapshotGenerationToken
}));

import { clearLeaderboardMaterializedWinnerCacheForTests } from '../leaderboard/leaderboard-materialized-winner-cache.js';
import { createInMemoryLeaderboardShellSnapshotStore } from '../leaderboard/leaderboard-shell-snapshot.store.js';
import {
  getGrindingPlanningBoard,
  getGrindingPlanningBoardLoad,
  scheduleGrindingPlanningBoardRewarm,
  updateGrindingPlanningBoardSeibanOrder,
  updateGrindingPlanningBoardPins,
  updateGrindingPlanningBoardResourceOrderBulk
} from '../grinding-planning-board.service.js';

import * as planningSource from '../grinding-planning-board/source.js';
import { clearLeaderboardCanonicalRowCacheForTests } from '../leaderboard/leaderboard-canonical-row-cache.js';
import { readPlanningSnapshotGenerationToken, reusablePlanningPayloads } from '../grinding-planning-board/state.js';

let databaseGeneration = 0;

function configurePersistence(): void {
  // Each test models an independent database generation for the in-process cache.
  databaseGeneration += 1;
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
  mocks.getResourceCategoryPolicy.mockResolvedValue({ grindingResourceCds: ['305'], cuttingExcludedResourceCds: [], cuttingResourceCds: [] });
  mocks.filterProductionScheduleResourceCdsByCategoryWithPolicy.mockImplementation((values: string[]) => values);
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
  prisma.productionScheduleGrindingPlanningBoardOverride.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { updatedAt: null } });
  prisma.productionScheduleOrderAssignment.findMany.mockResolvedValue([]);
  prisma.productionScheduleOrderSplitAssignment.findMany.mockResolvedValue([]);
  prisma.productionScheduleResourceMaster.findMany.mockResolvedValue([{ resourceCd: '305' }, { resourceCd: '581' }]);
  prisma.productionScheduleResourceMaster.aggregate.mockResolvedValue({ _count: { _all: 2 }, _max: { updatedAt: new Date(databaseGeneration) } });
  prisma.productionScheduleSeibanMachineNameSupplement.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { updatedAt: null } });
  mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('leaderboard-generation-1');
  prisma.$queryRaw.mockImplementation(async (strings: unknown) => {
    const query = Array.isArray(strings) ? strings.join(' ') : JSON.stringify(strings);
    if (query.includes('ProductionScheduleGrindingPlanningBoardState')) return [state];
    if (query.includes('ProductionScheduleGrindingPlanningBoardOverride')) return [];
    if (query.includes('effectiveItems')) return [{
      originalResourceCd: '305',
      effectiveResourceCd: '305',
      itemCount: 1n,
      unknownItemCount: 0n,
      requiredMinutesSum: 30
    }];
    return [sourceRow];
  });
  prisma.productionScheduleGrindingPlanningBoardState.update.mockResolvedValue({ ...state, version: 1, seibanOrder: ['ORDER-A', 'ORDER-B'] });
  mocks.acquireParentRowLock.mockResolvedValue(undefined);
}

describe('grinding planning board service orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLeaderboardMaterializedWinnerCacheForTests();
    configurePersistence();
    mocks.findMaterialArrivalStatusByPart.mockResolvedValue(new Map());
  });


  it('projects both categories, excludes invalid resources, and retains policy maps in snapshots', async () => {
    const actual = await vi.importActual<typeof import('../grinding-planning-board-projection.js')>('../grinding-planning-board-projection.js');
    mocks.projectGrindingPlanningBoard.mockImplementation(actual.projectGrindingPlanningBoard);
    mocks.isProductionScheduleGrindingResourceCd.mockImplementation((cd: string) => cd === '305' || cd === '581');
    mocks.isProductionScheduleCuttingResourceCd.mockImplementation((cd: string) => cd === '100');
    const rows = ['305', '100', '10', null].map((cd, index) => ({ ...mocks.sourceRow, id: `source-${index}`,
      rowData: { ...mocks.sourceRow.rowData, FSIGENCD: cd } }));
    const details = await mocks.prisma.csvDashboardRow.findMany();
    mocks.prisma.csvDashboardRow.findMany.mockResolvedValue(rows.map((row) => ({ ...details[0], id: row.id })));
    mocks.prisma.$queryRaw.mockImplementation(async (sql: unknown) => {
      if (JSON.stringify(sql).includes('effectiveItems')) return rows.map((row) => ({
        originalResourceCd: row.rowData.FSIGENCD, effectiveResourceCd: row.rowData.FSIGENCD,
        itemCount: 1n, unknownItemCount: 0n, requiredMinutesSum: 30
      }));
      if (JSON.stringify(sql).includes('ProductionScheduleGrindingPlanningBoardOverride')) return [];
      return rows;
    });
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'all' as const, view: 'resource' as const, snapshotStore };
    const result = await getGrindingPlanningBoard(params);
    expect(result.items.map((item) => item.originalResourceCd).sort()).toEqual(['100', '305']);
    expect(result.resources).toEqual(['305', '581']);
    expect(result.resourceCategories).toEqual({ '305': 'grinding', '581': 'grinding', '100': 'cutting' });
    expect(result.load.map((entry) => entry.resourceCd).sort()).toEqual(['100', '305']);
    const cached = snapshotStore.get(result.snapshotId)!;
    delete (cached.payload as { resourceCategories?: unknown }).resourceCategories;
    const restored = await getGrindingPlanningBoard({ ...params, snapshotId: result.snapshotId });
    expect(restored.resourceCategories).toEqual(result.resourceCategories);
    const load = await getGrindingPlanningBoardLoad({ siteKey: 'site-a', category: 'all' });
    expect(load.load.map((entry) => entry.resourceCd).sort()).toEqual(['100', '305']);
  });

  it.each(['material', 'part'] as const)('keeps the status value and supplies only a substitute basis (%s)', async (basis) => {
    const projection = mocks.projectGrindingPlanningBoard.getMockImplementation()!();
    mocks.projectGrindingPlanningBoard.mockReturnValue({
      ...projection,
      items: projection.items.map((item: object) => ({ ...item, fhincd: 'PART-A' }))
    });
    mocks.findMaterialArrivalStatusByPart.mockResolvedValue(new Map([
      ['ORDER-A\tPART-A', { status: 'ordered', basis }]
    ]));
    const response = await getGrindingPlanningBoard({
      siteKey: 'site-a', category: 'grinding', view: 'seiban',
      snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 })
    });
    expect(response.items[0]?.materialArrivalStatus).toBe('ordered');
    expect(response.items[0]?.materialArrivalBasis).toBe(basis === 'part' ? 'part' : undefined);
    expect(response.items[0]?.itemRevision).toBe('item-revision-a');
  });

  it('omits load SQL and keeps deferred and legacy snapshots separate', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
    const deferred = await getGrindingPlanningBoard({ ...params, includeLoad: false });
    const loadQueries = () => mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => JSON.stringify(sql).includes('effectiveItems'));
    expect(loadQueries()).toHaveLength(0);
    expect(deferred).toMatchObject({ load: [], unknownRequiredMinutesCount: 0, loadDeferred: true });
    const legacy = await getGrindingPlanningBoard(params);
    expect(legacy.load[0]).toMatchObject({ resourceCd: '305', requiredMinutes: 30 });
    expect(legacy.unknownRequiredMinutesCount).toBe(0);
    expect(legacy).not.toHaveProperty('loadDeferred');
    const again = await getGrindingPlanningBoard({ ...params, includeLoad: false });
    expect(again).toMatchObject({ load: [], unknownRequiredMinutesCount: 0, loadDeferred: true });
    const legacyAgain = await getGrindingPlanningBoard(params);
    expect(legacyAgain.load).toEqual(legacy.load);
    expect(legacyAgain.unknownRequiredMinutesCount).toBe(legacy.unknownRequiredMinutesCount);
    expect(loadQueries()).toHaveLength(1);
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
  });

  it('returns legacy load through the separate endpoint without reading source details', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const legacy = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'seiban', snapshotStore });
    mocks.prisma.$queryRaw.mockClear();
    mocks.prisma.csvDashboardRow.findMany.mockClear();
    mocks.projectGrindingPlanningBoard.mockClear();
    const load = await getGrindingPlanningBoardLoad({ siteKey: 'site-a', category: 'grinding' });
    expect(load).toEqual({ load: legacy.load, unknownRequiredMinutesCount: legacy.unknownRequiredMinutesCount });
    expect(mocks.prisma.csvDashboardRow.findMany).not.toHaveBeenCalled();
    expect(mocks.projectGrindingPlanningBoard).not.toHaveBeenCalled();
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('reuses winner materialization across load requests until the leaderboard generation changes', async () => {
    const params = { siteKey: 'site-a', category: 'grinding' as const };
    const winnerQueries = () => mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => JSON.stringify(sql).includes('ROW_NUMBER()') && !JSON.stringify(sql).includes('effectiveItems'));

    await getGrindingPlanningBoardLoad(params);
    await getGrindingPlanningBoardLoad(params);
    expect(winnerQueries()).toHaveLength(1);
    expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(5);

    mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('leaderboard-generation-2');
    await getGrindingPlanningBoardLoad(params);
    expect(winnerQueries()).toHaveLength(2);
    expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(8);
  });

  it('shares load SQL across category, view, completion and seiban filters and refreshes after override changes', async () => {
    const query = mocks.prisma.$queryRaw.getMockImplementation()!;
    mocks.prisma.$queryRaw.mockImplementation(async (sql: unknown) => {
      if (JSON.stringify(sql).includes('effectiveItems')) return [
        { originalResourceCd: '305', effectiveResourceCd: '305', itemCount: 1n, unknownItemCount: 1n, requiredMinutesSum: null },
        { originalResourceCd: '581', effectiveResourceCd: '581', itemCount: 2n, unknownItemCount: 0n, requiredMinutesSum: 60 }
      ];
      return query(sql);
    });
    mocks.isProductionScheduleGrindingResourceCd.mockImplementation((cd: string) => cd === '305');
    mocks.isProductionScheduleCuttingResourceCd.mockImplementation((cd: string) => cd === '581');
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const,
      snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 }) };
    const grinding = await getGrindingPlanningBoard(params);
    const cutting = await getGrindingPlanningBoardLoad({ siteKey: 'site-a', category: 'cutting' });
    expect(grinding.unknownRequiredMinutesCount).toBe(1);
    expect(cutting.load[0]).toMatchObject({ resourceCd: '581', requiredMinutes: 60 });
    await getGrindingPlanningBoard({ ...params, category: 'cutting', view: 'resource', completionFilter: 'incomplete', fseibans: ['unregistered'] });
    const loadQueries = () => mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => JSON.stringify(sql).includes('effectiveItems'));
    expect(loadQueries()).toHaveLength(1);
    mocks.prisma.productionScheduleGrindingPlanningBoardOverride.aggregate.mockResolvedValue({
      _count: { _all: 1 }, _max: { updatedAt: new Date('2026-10-08T00:00:00Z') }
    });
    await getGrindingPlanningBoardLoad({ siteKey: 'site-a', category: 'grinding' });
    expect(loadQueries()).toHaveLength(2);
  });

  it('reuses a first page without a snapshot ID and keeps both generation checks', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
    const first = await getGrindingPlanningBoard(params);
    mocks.prisma.$queryRaw.mockClear();
    mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockClear();
    const next = await getGrindingPlanningBoard(params);
    expect(next).toEqual({ ...first, snapshotId: expect.any(String) });
    expect(next.snapshotId).not.toBe(first.snapshotId);
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
    expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(2);
  });

  describe('first-page background rewarm', () => {
    beforeEach(() => {
      clearLeaderboardCanonicalRowCacheForTests();
      vi.spyOn(planningSource, 'readPlanningSource');
    });
    afterEach(() => vi.mocked(planningSource.readPlanningSource).mockRestore());

    const createStore = () => createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const request = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const };
    const changeGeneration = (version = 1, seibanOrder = ['ORDER-A']) => {
      mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue({ ...mocks.state, version, seibanOrder });
      mocks.prisma.productionScheduleGrindingPlanningBoardOverride.aggregate.mockResolvedValue({ _count: { _all: version }, _max: { updatedAt: new Date(version) } });
    };
    const pauseMachineNames = () => {
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const entered = new Promise<void>((resolve) => { started = resolve; });
      mocks.resolveSeibanMachineDisplayNamesBatched.mockImplementationOnce(async () => {
        started();
        await gate;
        return { machineNames: { 'ORDER-A': 'Machine A' } };
      });
      return { entered, release };
    };

    it('stores a rebuilt payload without cursor or arrival work and reuses it on the next read', async () => {
      const snapshotStore = createStore();
      const params = { ...request, snapshotStore };
      await getGrindingPlanningBoard(params);
      changeGeneration();
      const projection = mocks.projectGrindingPlanningBoard.getMockImplementation()!();
      mocks.projectGrindingPlanningBoard.mockReturnValue({ ...projection, items: projection.items.map((item: object) => ({ ...item, itemRevision: 'rewarmed' })) });
      const create = vi.spyOn(snapshotStore, 'create');
      mocks.findMaterialArrivalStatusByPart.mockClear();
      await scheduleGrindingPlanningBoardRewarm({ ...params, delayMs: 0 });
      expect(create).not.toHaveBeenCalled();
      expect(mocks.findMaterialArrivalStatusByPart).not.toHaveBeenCalled();
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
      const cached = [...reusablePlanningPayloads.get(snapshotStore)!.values()][0]!;
      expect(cached.generationToken).toBe(await readPlanningSnapshotGenerationToken(params.siteKey));
      mocks.projectGrindingPlanningBoard.mockClear();
      vi.mocked(planningSource.readPlanningSource).mockClear();
      mocks.prisma.csvDashboardRow.findMany.mockClear();
      mocks.prisma.$queryRaw.mockClear();
      const response = await getGrindingPlanningBoard(params);
      expect(response.items[0]?.itemRevision).toBe('rewarmed');
      expect(planningSource.readPlanningSource).not.toHaveBeenCalled();
      expect(mocks.projectGrindingPlanningBoard).not.toHaveBeenCalled();
      expect(mocks.prisma.csvDashboardRow.findMany).not.toHaveBeenCalled();
      expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
      const freshStore = createStore();
      const cold = await getGrindingPlanningBoard({ ...params, snapshotStore: freshStore });
      expect(cached.payload).toEqual(freshStore.get(cold.snapshotId!)!.payload);
      expect(cached.orderedRowIds).toEqual(freshStore.get(cold.snapshotId!)!.orderedRowIds);
    });

    it.each([undefined, ['ORDER-A', 'ORDER-B', 'ORDER-B']])('recomputes selected seibans after an order write for raw filter %j', async (fseibans) => {
      const actual = await vi.importActual<typeof import('../grinding-planning-board-projection.js')>('../grinding-planning-board-projection.js');
      mocks.projectGrindingPlanningBoard.mockImplementation(actual.projectGrindingPlanningBoard);
      const rows = ['ORDER-A', 'ORDER-B', 'ORDER-C'].map((fseiban, index) => ({ ...mocks.sourceRow, id: `source-${index}`, rowData: { ...mocks.sourceRow.rowData, FSEIBAN: fseiban } }));
      const details = await mocks.prisma.csvDashboardRow.findMany();
      mocks.prisma.csvDashboardRow.findMany.mockResolvedValue(rows.map((row) => ({ ...details[0], id: row.id })));
      mocks.prisma.$queryRaw.mockResolvedValue(rows);
      const snapshotStore = createStore();
      const params = { ...request, snapshotStore, fseibans, includeLoad: false };
      await getGrindingPlanningBoard(params);
      changeGeneration(1, ['ORDER-B', 'ORDER-C', 'ORDER-A']);
      await scheduleGrindingPlanningBoardRewarm({ ...params, delayMs: 0 });
      const selected = fseibans ? ['ORDER-B', 'ORDER-A'] : ['ORDER-B', 'ORDER-C', 'ORDER-A'];
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenLastCalledWith(expect.objectContaining({ selectedFseibans: new Set(selected) }));
      const entries = [...reusablePlanningPayloads.get(snapshotStore)!.entries()];
      expect(entries).toHaveLength(1);
      const [fingerprint, cached] = entries[0]!;
      expect(JSON.parse(fingerprint).fseibans).toEqual(selected);
      expect(cached.request.requestedFseibans).toEqual(fseibans ? ['ORDER-A', 'ORDER-B'] : undefined);
      expect(cached.payload.items.map((item) => item.fseiban)).toEqual(selected);
      const freshStore = createStore();
      const cold = await getGrindingPlanningBoard({ ...params, snapshotStore: freshStore });
      expect(cached.payload).toEqual(freshStore.get(cold.snapshotId!)!.payload);
      expect(cached.orderedRowIds).toEqual(freshStore.get(cold.snapshotId!)!.orderedRowIds);
      expect(cached.generationToken).toBe(await readPlanningSnapshotGenerationToken(params.siteKey));
      mocks.projectGrindingPlanningBoard.mockClear();
      expect((await getGrindingPlanningBoard(params)).seibanOrder).toEqual(selected);
      expect(mocks.projectGrindingPlanningBoard).not.toHaveBeenCalled();
    });

    it('shares one cold build between concurrent reads while creating independent cursors', async () => {
      const snapshotStore = createStore();
      const params = { ...request, snapshotStore };
      const [first, second] = await Promise.all([getGrindingPlanningBoard(params), getGrindingPlanningBoard(params)]);
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(1);
      expect(planningSource.readPlanningSource).toHaveBeenCalledTimes(1);
      expect(first.snapshotId).not.toBe(second.snapshotId);
      expect(first.items).toEqual(second.items);
    });

    it('lets a real read join a running rewarm', async () => {
      const snapshotStore = createStore();
      const params = { ...request, snapshotStore };
      await getGrindingPlanningBoard(params);
      changeGeneration();
      const pause = pauseMachineNames();
      const rewarm = scheduleGrindingPlanningBoardRewarm({ ...params, delayMs: 0 });
      await pause.entered;
      const read = getGrindingPlanningBoard(params);
      await new Promise<void>((resolve) => setImmediate(resolve));
      pause.release();
      await Promise.all([rewarm, read]);
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
      expect(planningSource.readPlanningSource).toHaveBeenCalledTimes(2);
    });

    it('retries a rejected shared build once and removes the failed in-flight entry', async () => {
      const params = { ...request, snapshotStore: createStore(), includeLoad: false };
      mocks.resolveSeibanMachineDisplayNamesBatched.mockRejectedValueOnce(new Error('temporary source failure'));
      const [first, joined] = await Promise.allSettled([getGrindingPlanningBoard(params), getGrindingPlanningBoard(params)]);
      expect(first.status).toBe('rejected');
      expect(joined.status).toBe('fulfilled');
      expect(mocks.resolveSeibanMachineDisplayNamesBatched).toHaveBeenCalledTimes(2);
      await getGrindingPlanningBoard(params);
      expect(mocks.resolveSeibanMachineDisplayNamesBatched).toHaveBeenCalledTimes(2);
    });

    it('debounces two writes and skips a still-valid cached payload', async () => {
      vi.useFakeTimers();
      try {
        const params = { ...request, snapshotStore: createStore() };
        await getGrindingPlanningBoard(params);
        changeGeneration();
        const first = scheduleGrindingPlanningBoardRewarm(params);
        await vi.advanceTimersByTimeAsync(100);
        changeGeneration(2);
        const second = scheduleGrindingPlanningBoardRewarm(params);
        expect(second).toBe(first);
        await vi.advanceTimersByTimeAsync(199);
        expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.all([first, second]);
        expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
        const unchanged = scheduleGrindingPlanningBoardRewarm(params);
        await vi.advanceTimersByTimeAsync(200);
        await unchanged;
        expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
      } finally { vi.useRealTimers(); }
    });

    it('collapses writes during a stale build into one follow-up and awaits its completion', async () => {
      const params = { ...request, snapshotStore: createStore(), includeLoad: false };
      await getGrindingPlanningBoard(params);
      changeGeneration();
      const pause = pauseMachineNames();
      const first = scheduleGrindingPlanningBoardRewarm({ ...params, delayMs: 0 });
      await pause.entered;
      changeGeneration(2);
      const second = scheduleGrindingPlanningBoardRewarm(params);
      changeGeneration(3);
      const third = scheduleGrindingPlanningBoardRewarm(params);
      expect(second).toBe(first);
      expect(third).toBe(first);
      pause.release();
      await first;
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(3);
      const cached = [...reusablePlanningPayloads.get(params.snapshotStore)!.values()][0]!;
      expect(cached.generationToken).toBe(await readPlanningSnapshotGenerationToken(params.siteKey));
      await getGrindingPlanningBoard(params);
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(3);
    });

    it('only rebuilds the three most recently used entries in the requested site and store', async () => {
      vi.useFakeTimers();
      try {
        const snapshotStore = createStore();
        const params = { ...request, snapshotStore, includeLoad: false };
        const filters = [
          { ...params, completionFilter: 'complete' as const },
          { ...params, completionFilter: 'incomplete' as const },
          { ...params, view: 'resource' as const },
          { ...params, category: 'all' as const }
        ];
        for (const filter of filters) {
          await getGrindingPlanningBoard(filter);
          vi.advanceTimersByTime(10);
        }
        const oldest = [...reusablePlanningPayloads.get(snapshotStore)!.values()][0]!;
        const expiresAtMs = oldest.expiresAtMs;
        await getGrindingPlanningBoard(filters[0]!);
        expect(oldest.lastUsedAtMs).toBe(Date.now());
        expect(oldest.expiresAtMs).toBe(expiresAtMs);
        await getGrindingPlanningBoard({ ...params, siteKey: 'site-b' });
        const otherStore = createStore();
        await getGrindingPlanningBoard({ ...params, snapshotStore: otherStore });
        changeGeneration();
        mocks.projectGrindingPlanningBoard.mockClear();
        const pending = scheduleGrindingPlanningBoardRewarm(params);
        await vi.advanceTimersByTimeAsync(200);
        await pending;
        expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(3);
        const token = await readPlanningSnapshotGenerationToken(params.siteKey);
        const entries = [...reusablePlanningPayloads.get(snapshotStore)!.values()];
        expect(entries.filter((entry) => entry.generationToken === token)).toHaveLength(3);
        expect(entries.find((entry) => entry.request.completionFilter === 'incomplete')!.generationToken).not.toBe(token);
        expect(entries.find((entry) => entry.siteKey === 'site-b')!.generationToken).not.toBe(token);
        expect([...reusablePlanningPayloads.get(otherStore)!.values()][0]!.generationToken).not.toBe(token);
      } finally { vi.useRealTimers(); }
    });

    it('swallows background errors and allows a later rewarm to retry', async () => {
      const params = { ...request, snapshotStore: createStore() };
      await getGrindingPlanningBoard(params);
      changeGeneration();
      mocks.resolveSeibanMachineDisplayNamesBatched.mockRejectedValueOnce(new Error('source unavailable'));
      await expect(scheduleGrindingPlanningBoardRewarm({ ...params, delayMs: 0 })).resolves.toBeUndefined();
      await scheduleGrindingPlanningBoardRewarm({ ...params, delayMs: 0 });
      const cached = [...reusablePlanningPayloads.get(params.snapshotStore)!.values()][0]!;
      expect(cached.generationToken).toBe(await readPlanningSnapshotGenerationToken(params.siteKey));
    });
  });

  it.each([
    { siteKey: 'site-b' }, { category: 'cutting' as const }, { view: 'resource' as const },
    { fseibans: ['unregistered'] }, { completionFilter: 'incomplete' as const }
  ])('does not share a first page across different filters: %j', async (changed) => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
    const first = await getGrindingPlanningBoard(params);
    const next = await getGrindingPlanningBoard({ ...params, ...changed });
    expect(next.snapshotId).not.toBe(first.snapshotId);
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
  });

  it.each(['csv', 'state', 'override', 'resource', 'machine-name', 'split-gate'])('rebuilds without a supplied ID after %s changes', async (change) => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
    const first = await getGrindingPlanningBoard(params);
    const revision = { _count: { _all: 3 }, _max: { updatedAt: new Date('2026-09-12T00:00:00Z') } };
    if (change === 'csv') mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('csv-2');
    if (change === 'state') mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue({ ...mocks.state, version: 1 });
    if (change === 'override') mocks.prisma.productionScheduleGrindingPlanningBoardOverride.aggregate.mockResolvedValue(revision);
    if (change === 'resource') mocks.prisma.productionScheduleResourceMaster.aggregate.mockResolvedValue(revision);
    if (change === 'machine-name') mocks.prisma.productionScheduleSeibanMachineNameSupplement.aggregate.mockResolvedValue(revision);
    if (change === 'split-gate') mocks.isProductionScheduleOrderSplitEnabled.mockReturnValue(true);
    const projection = mocks.projectGrindingPlanningBoard.mock.results[0]!.value;
    mocks.projectGrindingPlanningBoard.mockReturnValue({ ...projection, items: projection.items.map((item: object) => ({ ...item, itemRevision: 'changed' })) });
    const next = await getGrindingPlanningBoard(params);
    expect(next.snapshotId).not.toBe(first.snapshotId);
    expect(next.items[0]?.itemRevision).toBe('changed');
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
  });

  it('rejects a generation change while checking a reusable first page', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
    await getGrindingPlanningBoard(params);
    mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('changed').mockResolvedValueOnce('leaderboard-generation-1');
    await expect(getGrindingPlanningBoard(params)).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
  });

  it('rebuilds after a generation mismatch on the immediate reuse check', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
    await getGrindingPlanningBoard(params);
    mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockClear();
    mocks.readGrindingPlanningBoardSnapshotGenerationToken
      .mockResolvedValueOnce('leaderboard-generation-1').mockResolvedValueOnce('changed');

    await getGrindingPlanningBoard(params);
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
    expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(3);
  });

  it('retains payloads after store deletion and keeps them isolated between stores', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
    const first = await getGrindingPlanningBoard(params);
    snapshotStore.delete(first.snapshotId!);
    const afterDelete = await getGrindingPlanningBoard(params);
    expect(afterDelete.snapshotId).not.toBe(first.snapshotId);
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(1);
    const other = await getGrindingPlanningBoard({ ...params, snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 }) });
    expect(other.snapshotId).not.toBe(afterDelete.snapshotId);
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
  });

  describe('completed payload cache lifetime and eviction', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-08T14:58:00.000Z'));
    });
    afterEach(() => vi.useRealTimers());

    it('reuses across the five-minute store TTL and JST midnight with a fresh pageable snapshot and arrival status', async () => {
      const projection = mocks.projectGrindingPlanningBoard.getMockImplementation()!();
      const items = [
        { ...projection.items[0], fhincd: 'PART-A' },
        { ...projection.items[0], itemId: 'row:item-b', fhincd: 'PART-B' }
      ];
      mocks.projectGrindingPlanningBoard.mockReturnValue({ ...projection, allItems: items, items });
      const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 5 * 60_000 });
      const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, pageSize: 1, snapshotStore };
      const first = await getGrindingPlanningBoard(params);
      vi.advanceTimersByTime(5 * 60_000 + 1);
      expect(snapshotStore.get(first.snapshotId!)).toBeUndefined();
      await expect(getGrindingPlanningBoard({ ...params, snapshotId: first.snapshotId, cursor: 1 }))
        .rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
      mocks.prisma.$queryRaw.mockClear();
      mocks.prisma.csvDashboardRow.findMany.mockClear();
      mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockClear();
      mocks.findMaterialArrivalStatusByPart.mockResolvedValue(new Map([
        ['ORDER-A\tPART-A', { status: 'ordered', basis: 'part' }]
      ]));

      const reused = await getGrindingPlanningBoard(params);
      expect(reused.snapshotId).not.toBe(first.snapshotId);
      expect(reused.items[0]).toMatchObject({ materialArrivalStatus: 'ordered', materialArrivalBasis: 'part' });
      expect(first.items[0]).not.toHaveProperty('materialArrivalStatus');
      expect(reused.nextCursor).toBe('1');
      expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(2);
      const continued = await getGrindingPlanningBoard({ ...params, snapshotId: reused.snapshotId, cursor: 1 });
      expect(continued.snapshotId).toBe(reused.snapshotId);
      expect(continued.items).toEqual([items[1]]);
      expect(continued.nextCursor).toBeNull();
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(1);
      expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
      expect(mocks.prisma.csvDashboardRow.findMany).not.toHaveBeenCalled();
      expect(mocks.findMaterialArrivalStatusByPart).toHaveBeenCalledTimes(3);
    });

    it('rebuilds at twelve hours without extending the deadline on reuse', async () => {
      const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 5 * 60_000 });
      const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
      await getGrindingPlanningBoard(params);
      vi.advanceTimersByTime(12 * 60 * 60_000 - 1);
      await getGrindingPlanningBoard(params);
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(1);
      mocks.prisma.$queryRaw.mockClear();
      vi.advanceTimersByTime(2);
      await getGrindingPlanningBoard(params);
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(2);
      expect(mocks.prisma.$queryRaw).toHaveBeenCalled();
    });

    it.each([false, true])('evicts the least recently used payload on entry seventeen (touch oldest: %s)', async (touchOldest) => {
      const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 5 * 60_000 });
      const params = { category: 'grinding' as const, view: 'seiban' as const, includeLoad: false, snapshotStore };
      const first = await getGrindingPlanningBoard({ ...params, siteKey: 'site-0' });
      for (let index = 1; index < 16; index += 1) {
        vi.advanceTimersByTime(1);
        await getGrindingPlanningBoard({ ...params, siteKey: `site-${index}` });
      }
      if (touchOldest) await getGrindingPlanningBoard({ ...params, siteKey: 'site-0' });
      await getGrindingPlanningBoard({ ...params, siteKey: 'site-16' });
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(17);
      // Evicting a reusable payload must not invalidate active cursors.
      await getGrindingPlanningBoard({ ...params, siteKey: 'site-0', snapshotId: first.snapshotId });
      await getGrindingPlanningBoard({ ...params, siteKey: 'site-16' });
      if (touchOldest) await getGrindingPlanningBoard({ ...params, siteKey: 'site-0' });
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(17);
      await getGrindingPlanningBoard({ ...params, siteKey: touchOldest ? 'site-1' : 'site-0' });
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(18);
    });
  });


  it('gives a reused first page a full cursor lifetime without expiring previous readers', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    try {
      const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
      const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
      const first = await getGrindingPlanningBoard(params);
      clock.mockReturnValue(Date.now() + 55_000);
      const reused = await getGrindingPlanningBoard(params);
      expect(snapshotStore.get(first.snapshotId!)).toBeDefined();
      clock.mockReturnValue(Date.now() + 10_000);
      expect(snapshotStore.get(first.snapshotId!)).toBeUndefined();
      const continued = await getGrindingPlanningBoard({ ...params, snapshotId: reused.snapshotId, cursor: 0 });
      expect(continued.items).toEqual(first.items);
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(1);
    } finally { clock.mockRestore(); }
  });

  it('keeps pagination independent of first-page size', async () => {
    const projection = await mocks.projectGrindingPlanningBoard();
    const items = [projection.items[0], { ...projection.items[0], itemId: 'row:item-b' }];
    mocks.projectGrindingPlanningBoard.mockReset().mockReturnValue({ ...projection, allItems: items, items });
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
    const first = await getGrindingPlanningBoard({ ...params, pageSize: 1 });
    const larger = await getGrindingPlanningBoard({ ...params, pageSize: 2 });
    expect(larger.snapshotId).not.toBe(first.snapshotId);
    expect(larger.items).toHaveLength(2);
    const second = await getGrindingPlanningBoard({ ...params, snapshotId: first.snapshotId, cursor: 1, pageSize: 1 });
    expect(second.items).toEqual([items[1]]);
    expect(second.nextCursor).toBeNull();
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(1);
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
    expect(response.load).toEqual(expect.arrayContaining([
      expect.objectContaining({
        resourceCd: '305',
        originalItemCount: 1,
        alternateItemCount: 1,
        originalRequiredMinutes: 30,
        alternateRequiredMinutes: 30
      })
    ]));
    expect(response.seibanProgress).toEqual({ 'ORDER-A': { completed: 0, total: 1 } });
    expect(response.snapshotId).toEqual(expect.any(String));
    expect(response.nextCursor).toBeNull();
    expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(3);

    await expect(getGrindingPlanningBoard({
      siteKey: 'other-site',
      category: 'grinding',
      view: 'seiban',
      cursor: 1,
      snapshotId: response.snapshotId,
      snapshotStore
    })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
  });

  it('rejects a state update between the ensured state and the generation token', async () => {
    mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique
      .mockResolvedValueOnce(mocks.state)
      .mockResolvedValueOnce({ ...mocks.state, version: 1, updatedAt: new Date('2026-09-09T00:01:00.000Z') });

    await expect(getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 })
    })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    expect(mocks.prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a CSV generation change after the source and load read', async () => {
    mocks.readGrindingPlanningBoardSnapshotGenerationToken
      .mockResolvedValueOnce('leaderboard-generation-before')
      .mockResolvedValueOnce('leaderboard-generation-after');

    await expect(getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 })
    })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(2);
  });

  it('rejects a cursor read against an older snapshot generation', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const first = await getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      pageSize: 1,
      snapshotStore
    });
    mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('leaderboard-generation-2');

    await expect(getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      cursor: 1,
      snapshotId: first.snapshotId,
      snapshotStore
    })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
  });

  it('checks a valid cursor snapshot with two generation reads', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const first = await getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      pageSize: 1,
      snapshotStore
    });
    mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockClear();

    const continued = await getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      cursor: 0,
      snapshotId: first.snapshotId,
      snapshotStore
    });

    expect(continued.items).toHaveLength(1);
    expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(2);
  });

  it('rejects a cursor when the before-read generation differs from the stored snapshot', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const first = await getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      pageSize: 1,
      snapshotStore
    });
    mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockClear();
    mocks.readGrindingPlanningBoardSnapshotGenerationToken
      .mockResolvedValueOnce('leaderboard-generation-2')
      .mockResolvedValueOnce('leaderboard-generation-1');

    await expect(getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      cursor: 0,
      snapshotId: first.snapshotId,
      snapshotStore
    })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(2);
  });

  it('keeps the registered display source bounded when the database has many rows', async () => {
    const rowCount = 32_768;
    const largeRows = Array.from({ length: rowCount }, (_, index) => ({
      ...mocks.sourceRow,
      id: `source-row-${index + 1}`
    }));
    const detailIds: string[] = [];
    const rankIds: string[] = [];
    const detailBatchSizes: number[] = [];
    const rankBatchSizes: number[] = [];

    mocks.prisma.$queryRaw.mockImplementation(async (strings: unknown) => {
      const query = Array.isArray(strings) ? strings.join(' ') : JSON.stringify(strings);
      if (query.includes('ProductionScheduleGrindingPlanningBoardState')) return [mocks.state];
      if (query.includes('ProductionScheduleGrindingPlanningBoardOverride')) return [];
      if (query.includes('effectiveItems')) return [{
        originalResourceCd: '305',
        effectiveResourceCd: '305',
        itemCount: 1n,
        unknownItemCount: 0n,
        requiredMinutesSum: 30
      }];
      return largeRows;
    });
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
  });

  it('updates the shared seiban order only after validating its board revision', async () => {
    const secondSourceRow = {
      ...mocks.sourceRow,
      id: 'source-row-2',
      rowData: { ...mocks.sourceRow.rowData, FSEIBAN: 'ORDER-B' }
    };
    mocks.prisma.$queryRaw.mockImplementation(async (strings: unknown) => {
      const query = Array.isArray(strings) ? strings.join(' ') : JSON.stringify(strings);
      if (query.includes('ProductionScheduleGrindingPlanningBoardState')) return [mocks.state];
      if (query.includes('ProductionScheduleGrindingPlanningBoardOverride')) return [];
      if (query.includes('effectiveItems')) return [{
        originalResourceCd: '305',
        effectiveResourceCd: '305',
        itemCount: 1n,
        unknownItemCount: 0n,
        requiredMinutesSum: 30
      }];
      return [mocks.sourceRow, secondSourceRow];
    });
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


describe('bulk grinding resource order service', () => {
  const revision = JSON.stringify({ boardVersion: 0, orderHash: createHash('sha256').update(JSON.stringify(['ORDER-A'])).digest('hex') });
  let items: Array<{ itemId: string; itemRevision: string; version: number; sourceRowId: string; fseiban: string; originalResourceCd: string; effectiveResourceCd: string; isCompleted: boolean }>;
  beforeEach(() => {
    vi.clearAllMocks();
    clearLeaderboardMaterializedWinnerCacheForTests();
    configurePersistence();
    const second = { ...mocks.sourceRow, id: 'source-row-2', rowData: { ...mocks.sourceRow.rowData, FHINCD: 'PART-B' } };
    const rows = [mocks.sourceRow, second];
    items = rows.map((row) => ({ itemId: mocks.buildGrindingPlanningBoardRowItemId(row.rowData), itemRevision: `revision-${row.id}`,
      version: 0, sourceRowId: row.id, fseiban: 'ORDER-A', originalResourceCd: '305', effectiveResourceCd: '305', isCompleted: false }));
    mocks.prisma.$queryRaw.mockImplementation(async (strings: unknown) => {
      const query = Array.isArray(strings) ? strings.join(' ') : JSON.stringify(strings);
      return query.includes('ProductionScheduleGrindingPlanningBoardState') ? [mocks.state] : rows;
    });
    mocks.prisma.csvDashboardRow.findMany.mockResolvedValue(rows.map((row) => ({ id: row.id, updatedAt: row.updatedAt,
      rowNotes: [], orderSupplements: [], orderSplits: [], productionScheduleProgress: null, productionScheduleExternalCompletion: null })));
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: typeof mocks.prisma) => Promise<unknown>) => callback(mocks.prisma));
    mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert.mockImplementation(async ({ create }) => ({ ...create, version: 1 }));
    mocks.projectGrindingPlanningBoard.mockImplementation(({ overrides }: { overrides: Map<string, { alternateRank: number; version: number; orderPinned?: boolean }> }) => ({
      allItems: items.map((item) => {
        const saved = overrides.get(item.itemId);
        return saved ? { ...item, alternateRank: saved.alternateRank, orderPinned: saved.orderPinned, version: saved.version, itemRevision: `saved-${item.itemId}` } : item;
      })
    }));
  });
  const request = () => ({ siteKey: 'site-a', sourceRevision: revision, resourceCd: '305',
    items: [...items].reverse().map((item) => ({ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version })) });
  it('creates only a pin with null override semantics and returns the acknowledged item', async () => {
    const payload = request();
    const result = await updateGrindingPlanningBoardPins({ siteKey: 'site-a', sourceRevision: payload.sourceRevision, items: [payload.items[0]!], pinned: true });
    expect(result.items[0]).toMatchObject({ orderPinned: true, version: 1 });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).toHaveBeenCalledWith({
      where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: expect.any(String), siteKey: 'site-a', itemKey: payload.items[0]!.itemId } },
      create: expect.objectContaining({ orderPinned: true, overrideResourceCd: null, overrideDueDate: null, dueDateCleared: null, alternateRank: null, specialDueKind: null, specialDueExpiresAt: null }),
      update: expect.objectContaining({ orderPinned: true, version: { increment: 1 } })
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
  });
  it('does not create an override for an already unpinned item', async () => {
    await updateGrindingPlanningBoardPins({ ...request(), pinned: false });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).not.toHaveBeenCalled();
  });
  it('unpins without changing other overrides and resource-order writes preserve pins', async () => {
    const previous = { itemKey: items[0]!.itemId, version: 0, orderPinned: true, overrideResourceCd: '305',
      overrideDueDate: new Date('2026-10-19'), dueDateCleared: false, alternateRank: 7, specialDueKind: null, specialDueExpiresAt: null };
    mocks.prisma.productionScheduleGrindingPlanningBoardOverride.findMany.mockResolvedValue([previous]);
    // The mocked projection leaves the revision unchanged for the current override.
    mocks.projectGrindingPlanningBoard.mockReturnValue({ allItems: items });
    const payload = request();
    await updateGrindingPlanningBoardPins({ ...payload, items: [payload.items[1]!], pinned: false });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      update: { orderPinned: false, overrideResourceCd: '305', overrideDueDate: previous.overrideDueDate, dueDateCleared: false,
        alternateRank: 7, specialDueKind: null, specialDueExpiresAt: null, version: { increment: 1 } }
    }));
    await updateGrindingPlanningBoardResourceOrderBulk(payload);
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: expect.objectContaining({ orderPinned: true }) }));
  });
  it.each(['itemRevision', 'overrideVersion', 'completed', 'duplicate'] as const)('rejects invalid pins (%s) before any write', async (failure) => {
    const payload = { ...request(), pinned: true };
    if (failure === 'itemRevision') payload.items[0]!.itemRevision = 'stale';
    if (failure === 'overrideVersion') payload.items[0]!.overrideVersion = 99;
    if (failure === 'completed') items[0]!.isCompleted = true;
    if (failure === 'duplicate') payload.items[1] = payload.items[0]!;
    await expect(updateGrindingPlanningBoardPins(payload)).rejects.toMatchObject({ statusCode: failure === 'duplicate' ? 400 : 409 });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).not.toHaveBeenCalled();
  });
  it('assigns all ranks in one RepeatableRead transaction and returns ordered revisions', async () => {
    const payload = request();
    const result = await updateGrindingPlanningBoardResourceOrderBulk(payload);
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
    expect(result.sourceRevision).toBe(revision);
    expect(result.items.map((item) => item.itemId)).toEqual(payload.items.map((item) => item.itemId));
    expect(result.items.map((item) => item.alternateRank)).toEqual([1, 2]);
    expect(result.items.every((item) => item.version === 1 && item.itemRevision.startsWith('saved-'))).toBe(true);
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.acquireParentRowLock.mock.calls.map((call) => call[1])).toEqual(['source-row-1', 'source-row-2']);
  });
  it.each(['resource', 'itemRevision', 'overrideVersion', 'sourceRevision', 'completed'] as const)('rejects %s before any rank is written', async (failure) => {
    const payload = request();
    if (failure === 'resource') payload.resourceCd = '581';
    if (failure === 'sourceRevision') payload.sourceRevision = 'stale';
    if (failure === 'itemRevision') payload.items[1]!.itemRevision = 'stale';
    if (failure === 'overrideVersion') payload.items[1]!.overrideVersion = 99;
    if (failure === 'completed') items[0]!.isCompleted = true;
    await expect(updateGrindingPlanningBoardResourceOrderBulk(payload)).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).not.toHaveBeenCalled();
  });
  it('rejects duplicate items before a transaction', async () => {
    const payload = request(); payload.items[1] = payload.items[0]!;
    await expect(updateGrindingPlanningBoardResourceOrderBulk(payload)).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
