vi.mock('../sessaku-pieces/piece-key.js', async (importOriginal) => ({ ...await importOriginal<typeof import('../sessaku-pieces/piece-key.js')>(), readSessakuPieceGeneration: vi.fn().mockResolvedValue('empty-pieces') }));
import { readSessakuPieceGeneration } from '../sessaku-pieces/piece-key.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { enrichRowsWithProcessArrival } from '../process-arrival.service.js';
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
    $executeRaw: vi.fn(),
    productionScheduleGrindingPlanningBoardResourceCapacity: { findMany: vi.fn(), aggregate: vi.fn() },
    productionScheduleGrindingPlanningBoardResourceMinutesSource: { findMany: vi.fn(), aggregate: vi.fn() },
    productionScheduleGrindingPlanningBoardResourcePartMinutes: { findMany: vi.fn(), aggregate: vi.fn() },
    productionScheduleSessakuPieceSet: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
    csvDashboardRow: { findMany: vi.fn() },
    productionScheduleDScheduleMinutes: { findMany: vi.fn() },
    orderPlacementBranchState: { findMany: vi.fn() },
    mobilePlacementShelf: { findMany: vi.fn() },
    mobileSlipVerifyRecord: { groupBy: vi.fn().mockResolvedValue([]) },
    productionScheduleGrindingPlanningBoardState: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    productionScheduleGrindingPlanningBoardFirstProcessArrival: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    productionScheduleGrindingPlanningBoardArrival: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    productionScheduleGrindingPlanningBoardTestBar: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) },
    productionScheduleGrindingPlanningBoardOverride: { findMany: vi.fn(), aggregate: vi.fn(), upsert: vi.fn() },
    productionScheduleOrderAssignment: { findMany: vi.fn() },
    productionScheduleResourceMaster: { findMany: vi.fn(), aggregate: vi.fn() },
    productionScheduleSeibanMachineNameSupplement: { aggregate: vi.fn() }
  };
  return {
    prisma,
    pieceSets: [] as Array<{ fseiban: string; fhincd: string; fsigencd: string; fkojun: string; id: string; version: number }>,
    listKinds: vi.fn(),
    findMaterialArrivalStatusByPart: vi.fn(),
    sourceRow,
    state,
    getResourceCategoryPolicy: vi.fn(),
    filterProductionScheduleResourceCdsByCategoryWithPolicy: vi.fn(),
    isProductionScheduleGrindingResourceCd: vi.fn(),
    isProductionScheduleCuttingResourceCd: vi.fn(),
    normalizeProductionScheduleResourceCd: vi.fn(),
    acquireParentRowLock: vi.fn(),
    resolveSeibanMachineDisplayNamesBatched: vi.fn(),
    projectGrindingPlanningBoard: vi.fn(),
    buildGrindingPlanningBoardLogicalKey: vi.fn(),
    buildGrindingPlanningBoardRowItemId: vi.fn(),
    readGrindingPlanningBoardSnapshotGenerationToken: vi.fn()
  };
});

vi.mock('../d-schedule-minutes/kind-membership.js', () => ({ listDScheduleMinutesKinds: mocks.listKinds }));

vi.mock('../process-arrival.service.js', () => ({
  enrichRowsWithProcessArrival: vi.fn(async (rows) => rows.map((row: { id: string }) => ({ ...row, arrived: true, manualArrivalDate: null, isFirstProcess: false, firstProcessState: null })))
}));

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
vi.mock('../order-assignment/production-schedule-parent-row-lock.service.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../order-assignment/production-schedule-parent-row-lock.service.js')>(),
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
  updateGrindingPlanningBoardArrival,
  updateGrindingPlanningBoardFirstProcessArrival,
  updateGrindingPlanningBoardPins,
  updateGrindingPlanningBoardResourceOrderBulk,
  updateGrindingPlanningBoardResourceOrder
} from '../grinding-planning-board.service.js';

import * as planningSource from '../grinding-planning-board/source.js';
import * as loadSummary from '../grinding-planning-board-load-summary.js';
import { createGrindingPlanningBoardStartupWarmup } from '../grinding-planning-board/startup-warmup.js';
import { clearLeaderboardCanonicalRowCacheForTests } from '../leaderboard/leaderboard-canonical-row-cache.js';
import { readPlanningSnapshotGenerationToken, reusablePlanningPayloads } from '../grinding-planning-board/state.js';

let databaseGeneration = 0;
let overrideResourceFingerprint = 'empty-overrides';

function configurePersistence(): void {
  // Each test models an independent database generation for the in-process cache.
  databaseGeneration += 1;
  overrideResourceFingerprint = 'empty-overrides';
  const { prisma, sourceRow, state } = mocks;
  prisma.$transaction.mockImplementation(async (callback) => callback(prisma));
  mocks.pieceSets = [];
  vi.mocked(readSessakuPieceGeneration).mockResolvedValue('empty-pieces');
  const details = {
    id: sourceRow.id,
    updatedAt: sourceRow.updatedAt,
    rowNotes: [{ dueDate: new Date('2026-09-20T00:00:00.000Z') }],
    orderSupplements: [{ plannedQuantity: 1, plannedEndDate: new Date('2026-09-20T00:00:00.000Z') }],
    productionScheduleProgress: { isCompleted: false, updatedAt: sourceRow.updatedAt },
    productionScheduleExternalCompletion: { isExternallyCompleted: false, updatedAt: sourceRow.updatedAt },
  };
  mocks.getResourceCategoryPolicy.mockResolvedValue({ grindingResourceCds: ['305'], cuttingExcludedResourceCds: [], cuttingResourceCds: [] });
  mocks.filterProductionScheduleResourceCdsByCategoryWithPolicy.mockImplementation((values: string[]) => values);
  mocks.isProductionScheduleGrindingResourceCd.mockReturnValue(true);
  mocks.isProductionScheduleCuttingResourceCd.mockReturnValue(false);
  mocks.normalizeProductionScheduleResourceCd.mockImplementation((value: string | null | undefined) => {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  });
  mocks.resolveSeibanMachineDisplayNamesBatched.mockResolvedValue({ machineNames: { 'ORDER-A': 'Machine A' } });
  mocks.buildGrindingPlanningBoardLogicalKey.mockImplementation((data: Record<string, unknown>) => JSON.stringify([data.FSEIBAN, data.FHINCD, data.FSIGENCD, data.FKOJUN]));
  mocks.buildGrindingPlanningBoardRowItemId.mockImplementation((data: Record<string, unknown>) => `row:${Buffer.from(JSON.stringify([data.FSEIBAN, data.FHINCD, data.FSIGENCD, data.FKOJUN])).toString('base64url')}`);
  mocks.projectGrindingPlanningBoard.mockReturnValue({
    allItems: [{
      productNo: '1',
      fhincd: 'PART-A',
      lslhSurface: false,
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
      productNo: '1',
      fhincd: 'PART-A',
      lslhSurface: false,
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
  prisma.productionScheduleSessakuPieceSet.findMany.mockResolvedValue([]);
  for (const table of [prisma.productionScheduleGrindingPlanningBoardResourceCapacity, prisma.productionScheduleGrindingPlanningBoardResourceMinutesSource, prisma.productionScheduleGrindingPlanningBoardResourcePartMinutes]) {
    table.findMany.mockResolvedValue([]);
    table.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { updatedAt: null } });
  }
  prisma.productionScheduleGrindingPlanningBoardResourceMinutesSource.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { updatedAt: new Date(databaseGeneration) } });
  prisma.csvDashboardRow.findMany.mockResolvedValue([details]);
  prisma.productionScheduleGrindingPlanningBoardOverride.findMany.mockResolvedValue([]);
  prisma.productionScheduleGrindingPlanningBoardArrival.findMany.mockResolvedValue([]);
  prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.findMany.mockResolvedValue([]);
  prisma.mobileSlipVerifyRecord.groupBy.mockResolvedValue([]);
  prisma.productionScheduleGrindingPlanningBoardOverride.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { updatedAt: null } });
  prisma.productionScheduleOrderAssignment.findMany.mockResolvedValue([]);
  prisma.productionScheduleResourceMaster.findMany.mockResolvedValue([{ resourceCd: '305' }, { resourceCd: '581' }]);
  prisma.productionScheduleResourceMaster.aggregate.mockResolvedValue({ _count: { _all: 2 }, _max: { updatedAt: new Date(databaseGeneration) } });
  prisma.productionScheduleSeibanMachineNameSupplement.aggregate.mockResolvedValue({ _count: { _all: 0 }, _max: { updatedAt: null } });
  mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('leaderboard-generation-1');
  prisma.$queryRaw.mockImplementation(async (strings: unknown) => {
    const query = Array.isArray(strings) ? strings.join(' ') : JSON.stringify(strings);
    if (query.includes('string_agg(') && query.includes('ProductionScheduleGrindingPlanningBoardOverride') && !query.includes('effectiveItems')) return [{ fingerprint: overrideResourceFingerprint }];
    if (query.includes('WITH parents AS')) {
      const scope = (strings as { values: unknown[] }).values.find(Array.isArray) as string[] | undefined;
      const sets = mocks.pieceSets.filter((set) => scope === undefined || scope.includes(set.fseiban));
      return [{ fingerprint: JSON.stringify([...sets].sort((a, b) => a.id.localeCompare(b.id))) }];
    }
    if (query.includes('ProductionScheduleGrindingPlanningBoardTestBar')) return [];
    if (query.includes('ProductionScheduleGrindingPlanningBoardState')) return [state];
    if (query.includes('ProductionScheduleGrindingPlanningBoardOverride') && !query.includes('effectiveItems')) return [];
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
  async function usePieceGenerations() {
    const actual = await vi.importActual<typeof import('../sessaku-pieces/piece-key.js')>('../sessaku-pieces/piece-key.js');
    vi.mocked(readSessakuPieceGeneration).mockImplementation(actual.readSessakuPieceGeneration);
  }

  const pieceSet = (fseiban: string) => ({ fseiban, fhincd: 'PART-A', fsigencd: '305', fkojun: '1', id: `set-${fseiban}`, version: 1 });

  it('keeps paging and reusing A after unrelated B changes, but rejects A updates, deletion and recreation', async () => {
    await usePieceGenerations();
    mocks.pieceSets = [pieceSet('ORDER-A'), pieceSet('ORDER-B')];
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const,
      includeLoad: false, includePieces: true, snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 }) };
    const first = await getGrindingPlanningBoard(params);
    mocks.pieceSets[1]!.version += 1;
    await expect(getGrindingPlanningBoard({ ...params, snapshotId: first.snapshotId, cursor: 1 })).resolves.toBeDefined();
    const projections = mocks.projectGrindingPlanningBoard.mock.calls.length;
    const reused = await getGrindingPlanningBoard(params);
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(projections);
    expect(reused.sourceRevision).toBe(first.sourceRevision);
    for (const change of ['update', 'delete', 'recreate'] as const) {
      const baseline = await getGrindingPlanningBoard(params);
      if (change === 'update') mocks.pieceSets[0]!.version += 1;
      if (change === 'delete') mocks.pieceSets.shift();
      if (change === 'recreate') mocks.pieceSets.unshift({ ...pieceSet('ORDER-A'), id: 'recreated-a' });
      await expect(getGrindingPlanningBoard({ ...params, snapshotId: baseline.snapshotId, cursor: 1 }))
        .rejects.toMatchObject({ statusCode: 409, code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    }
  });

  it.each(['ORDER-A', 'ORDER-B'])('handles a %s update during list construction with the same scope', async (fseiban) => {
    await usePieceGenerations();
    mocks.pieceSets = [pieceSet('ORDER-A'), pieceSet('ORDER-B')];
    const projection = mocks.projectGrindingPlanningBoard.getMockImplementation()!();
    mocks.projectGrindingPlanningBoard.mockImplementationOnce(() => {
      mocks.pieceSets.find((set) => set.fseiban === fseiban)!.version += 1;
      return projection;
    });
    const read = getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'seiban', includeLoad: false,
      snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 }) });
    if (fseiban === 'ORDER-A') await expect(read).rejects.toMatchObject({ statusCode: 409 });
    else await expect(read).resolves.toBeDefined();
  });

  it.each([true, false])('invalidates the global load population for B updates (list: %s)', async (list) => {
    await usePieceGenerations();
    mocks.pieceSets = [pieceSet('ORDER-A'), pieceSet('ORDER-B')];
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, includeLoad: true,
      snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 }) };
    if (list) {
      const first = await getGrindingPlanningBoard(params);
      mocks.pieceSets[1]!.version += 1;
      await expect(getGrindingPlanningBoard({ ...params, snapshotId: first.snapshotId, cursor: 1 })).rejects.toMatchObject({ statusCode: 409 });
    } else {
      const summary = vi.spyOn(loadSummary, 'readGrindingPlanningBoardLoadSummary').mockImplementationOnce(async () => {
        mocks.pieceSets[1]!.version += 1;
        return { load: [], unknownRequiredMinutesCount: 0 };
      });
      try { await expect(getGrindingPlanningBoardLoad(params)).rejects.toMatchObject({ statusCode: 409 }); }
      finally { summary.mockRestore(); }
    }
  });

  it('batches code-based and manual LSLH identification for all response items', async () => {
    const base = mocks.projectGrindingPlanningBoard().items[0];
    mocks.projectGrindingPlanningBoard.mockReturnValue({
      allItems: [], items: [
        { ...base, itemId: 'code', productNo: 'CODE', fhincd: 'PAINT' },
        { ...base, itemId: 'manual', productNo: 'MANUAL', fhincd: 'LSLH-PART' },
        { ...base, itemId: 'other', productNo: 'OTHER', fhincd: 'OTHER-PART' }
      ], load: [], unknownRequiredMinutesCount: 0, progress: { bySeiban: new Map() }
    });
    const query = mocks.prisma.$queryRaw.getMockImplementation()!;
    mocks.prisma.$queryRaw.mockImplementation(async (sql: unknown) => {
      if (JSON.stringify(sql).includes('FSEZONO')) return [
        { productNo: 'CODE', fhincd: null }, { productNo: null, fhincd: 'LSLH-PART' }
      ];
      return query(sql);
    });
    const result = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'resource' });
    expect(result.items.map(({ itemId, lslhSurface }) => [itemId, lslhSurface])).toEqual([
      ['code', true], ['manual', true], ['other', false]
    ]);
    const calls = mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => JSON.stringify(sql).includes('FSEZONO'));
    expect(calls).toHaveLength(1);
    const sql = JSON.stringify(calls[0]);
    for (const value of ['1143016000', '1143016002', 'CODE', 'MANUAL', 'OTHER', 'LSLH-PART', 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e']) expect(sql).toContain(value);
    expect(sql).toContain('processingType');
    expect(sql).not.toContain('FKOJUNST');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearLeaderboardMaterializedWinnerCacheForTests();
    configurePersistence();
    mocks.prisma.productionScheduleDScheduleMinutes.findMany.mockResolvedValue([]);
    mocks.findMaterialArrivalStatusByPart.mockResolvedValue(new Map());
    mocks.prisma.orderPlacementBranchState.findMany.mockResolvedValue([]);
    mocks.prisma.mobilePlacementShelf.findMany.mockResolvedValue([]);
  });


  it.each([
    ['dCompany', ['D', 'DUAL', 'MANUAL']],
    ['general', ['GENERAL', 'DUAL', 'MANUAL']],
    ['both', ['D', 'GENERAL', 'DUAL', 'MANUAL']]
  ] as const)('filters %s before source/projection and retains all registrations', async (scheduleSource, visible) => {
    const registered = ['D', 'GENERAL', 'DUAL', 'MANUAL'];
    mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue({ ...mocks.state, seibanOrder: registered });
    mocks.listKinds.mockResolvedValue(new Map([['D', ['D_COMPANY']], ['GENERAL', ['INTERNAL']], ['DUAL', ['INTERNAL', 'D_COMPANY']]]));
    const template = mocks.projectGrindingPlanningBoard.getMockImplementation()!({} as never);
    mocks.projectGrindingPlanningBoard.mockImplementation(({ selectedFseibans }) => {
      const items = registered.filter((fseiban) => selectedFseibans.has(fseiban)).map((fseiban) => ({ ...template.items[0], itemId: `row:${fseiban}`, fseiban }));
      return { ...template, allItems: items, items };
    });
    const source = vi.spyOn(planningSource, 'readPlanningSource').mockResolvedValue({
      baseWhere: { strings: ['TRUE'], values: [] } as never, generationToken: 'generation', rows: [], details: new Map(), progressRows: []
    });
    try {
      const params = { scheduleSource, siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, includeLoad: false };
      const result = await getGrindingPlanningBoard(params);
      expect(result.items.map((item) => item.fseiban)).toEqual(visible);
      expect(result.seibanOrder).toEqual(visible);
      expect(result.registeredFseibans).toEqual(registered);
      expect(source).toHaveBeenCalledWith(expect.objectContaining({ fseibans: visible }));
      if (scheduleSource === 'both') expect(mocks.listKinds).not.toHaveBeenCalled();
      // A cursor cannot cross the schedule-source boundary, even when CSV/state generations match.
      await expect(getGrindingPlanningBoard({ ...params, scheduleSource: scheduleSource === 'general' ? 'dCompany' : 'general', snapshotId: result.snapshotId, cursor: 1 }))
        .rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
      expect(mocks.prisma.productionScheduleGrindingPlanningBoardState.update).not.toHaveBeenCalled();
      expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).not.toHaveBeenCalled();
    } finally { source.mockRestore(); }
  });

  it.each((['general', 'dCompany', 'both'] as const).flatMap((scheduleSource) => [false, true].map((list) => ({ scheduleSource, list }))))('scopes load and its cache to $scheduleSource with C collation (list: $list)', async ({ scheduleSource, list }) => {
    mocks.listKinds.mockResolvedValue(new Map([['D', ['D_COMPANY']], ['GENERAL', ['INTERNAL']], ['DUAL', ['INTERNAL', 'D_COMPANY']]]));
    const summary = vi.spyOn(loadSummary, 'readGrindingPlanningBoardLoadSummary').mockResolvedValue({ load: [], unknownRequiredMinutesCount: 0 });
    try {
      if (list) {
        await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'seiban', scheduleSource });
      } else {
        await getGrindingPlanningBoardLoad({ siteKey: 'site-a', category: 'grinding', scheduleSource });
      }
      const params = summary.mock.lastCall![0];
      expect(params.cache?.scheduleSource).toBe(scheduleSource);
      const predicate = params.leaderboardMaterializedBaseWhere!;
      expect(predicate.sql).toContain('"CsvDashboardRow"."id" COLLATE "C" = ANY(');
      expect(predicate.sql).not.toContain('"id"::text');
      expect(predicate.values).toContainEqual([mocks.sourceRow.id]);
      const winnerQueries = mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => JSON.stringify(sql).includes('ROW_NUMBER()') && !JSON.stringify(sql).includes('effectiveItems'));
      expect(winnerQueries).toHaveLength(1);
      if (scheduleSource === 'both') {
        expect(mocks.listKinds).not.toHaveBeenCalled();
        expect(predicate.sql).not.toContain('NOT IN');
      } else {
        expect(predicate.sql).toContain('NOT IN');
        expect(predicate.values).toContain(scheduleSource === 'general' ? 'D' : 'GENERAL');
        expect(predicate.values).not.toContain('DUAL');
      }
    } finally { summary.mockRestore(); }
  });

  it('derives unchecked seibans for legacy boards and returns persisted checks instead when saved', async () => {
    mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue({ ...mocks.state, uncheckedFseibans: null });
    mocks.prisma.productionScheduleDScheduleMinutes.findMany.mockResolvedValue([
      { fseiban: 'ORDER-A', assigneesKnown: true, assignees: ['組立課'] },
      { fseiban: 'ABSENT', assigneesKnown: true, assignees: [] }
    ]);
    const legacy = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'seiban' });
    expect(legacy.uncheckedFseibans).toEqual(['ORDER-A']);
    mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue({ ...mocks.state, uncheckedFseibans: [] });
    const saved = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'seiban' });
    expect(saved.uncheckedFseibans).toEqual([]);
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardState.update).not.toHaveBeenCalled();
  });

  it('reads shared same-day arrivals on warm snapshots and ignores them at JST midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-06T14:59:59.000Z'));
      vi.mocked(enrichRowsWithProcessArrival).mockImplementation(async (rows) => rows.map((row) => ({ ...row, arrived: false })));
      const savedDate = new Date('2026-11-06T00:00:00.000Z');
      mocks.prisma.productionScheduleGrindingPlanningBoardArrival.findMany.mockImplementation(async ({ where }) =>
        where.siteKey === 'site-a' && where.arrivalDate.getTime() === savedDate.getTime() ? [{ itemKey: 'row:item-a' }] : []);
      const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const };
      const first = await getGrindingPlanningBoard(params);
      expect(first.items[0]).toMatchObject({ arrived: true, manualArrivalDate: '2026-11-06' });
      const otherKiosk = await getGrindingPlanningBoard(params);
      expect(otherKiosk.items[0]).toMatchObject({ arrived: true, manualArrivalDate: '2026-11-06' });
      vi.setSystemTime(new Date('2026-11-06T15:00:00.000Z'));
      const nextDay = await getGrindingPlanningBoard({ ...params, snapshotId: first.snapshotId, cursor: 0 });
      expect(nextDay.items[0]).toMatchObject({ arrived: false, manualArrivalDate: null });
      expect(mocks.projectGrindingPlanningBoard.mock.results[0]?.value.items[0]).not.toHaveProperty('manualArrivalDate');
      vi.mocked(enrichRowsWithProcessArrival).mockImplementation(async (rows) => rows.map((row) => ({ ...row, arrived: true })));
      expect((await getGrindingPlanningBoard(params)).items[0]?.arrived).toBe(true);
    } finally {
      vi.useRealTimers();
      vi.mocked(enrichRowsWithProcessArrival).mockImplementation(async (rows) => rows.map((row) => ({ ...row, arrived: true })));
    }
  });

  it.each([
    [true, ['資材課'], ['ORDER-A']],
    [true, [], ['ORDER-A']],
    [true, ['機械課・資材課'], []],
    [true, ['設計機械課'], []],
    [false, [], []]
  ])('reads assignees on every response: known=%s values=%j', async (assigneesKnown, assignees, expected) => {
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'resource' as const };
    const first = await getGrindingPlanningBoard(params);
    expect(first.excelNonMachineFseibans).toEqual([]);
    mocks.prisma.productionScheduleDScheduleMinutes.findMany.mockResolvedValue([{ fseiban: 'ORDER-A', assigneesKnown, assignees }]);
    const next = await getGrindingPlanningBoard({ ...params, snapshotId: first.snapshotId });
    expect(next.excelNonMachineFseibans).toEqual(expected);
    expect(mocks.prisma.productionScheduleDScheduleMinutes.findMany).toHaveBeenLastCalledWith({
      where: { csvDashboardId: '3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01', fseiban: { in: ['ORDER-A'] } },
      select: { fseiban: true, assignees: true, assigneesKnown: true }
    });
  });

  it.each([
    ['arrived', 'ordered', '2026-11-05T00:00:00Z', true, 'arrived'],
    ['excluded', 'received', null, false, 'excluded'],
    [null, 'ordered', '2026-11-05T00:00:00Z', true, null],
    [null, 'unordered', null, false, null],
    [null, 'ordered', null, false, null],
    [null, 'received', null, true, null],
    [null, 'partial', null, true, null],
    [null, null, null, true, null],
    ['excluded', 'ordered', '2026-11-06T00:00:01Z', true, null],
    ['excluded', 'ordered', '2026-11-05T23:59:59Z', false, 'excluded'],
    ['excluded', 'ordered', '2026-11-06T00:00:00Z', false, 'excluded']
  ] as const)('resolves first-process priority state=%s material=%s placement=%s', async (state, status, placedAt, arrived, effective) => {
    vi.mocked(enrichRowsWithProcessArrival).mockImplementationOnce(async (rows) => rows.map((row) => ({ ...row, arrived: true, isFirstProcess: true })));
    mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.findMany.mockResolvedValue(state ? [
      { itemKey: 'row:item-a', state, recordedAt: new Date('2026-11-06T00:00:00Z') }
    ] : []);
    mocks.findMaterialArrivalStatusByPart.mockResolvedValue(new Map(status ? [['ORDER-A\tPART-A', { status, basis: 'material' }]] : []));
    if (placedAt) mocks.prisma.orderPlacementBranchState.findMany.mockResolvedValue([
      { manufacturingOrderBarcodeRaw: '1', shelfCodeRaw: 'A', updatedAt: new Date(placedAt) }
    ]);
    const result = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'resource' });
    expect(result.items[0]).toMatchObject({ isFirstProcess: true, firstProcessState: effective, arrived });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.deleteMany).not.toHaveBeenCalled();
    const projection = mocks.projectGrindingPlanningBoard.mock.results[0]?.value.items[0];
    expect(projection).not.toHaveProperty('isFirstProcess');
    expect(projection).not.toHaveProperty('firstProcessState');
  });

  it.each([
    [null, 'unordered', '2026-11-05T00:00:00Z', true, null],
    [null, 'ordered', null, false, null],
    ['excluded', 'unordered', '2026-11-06T00:00:01Z', true, null],
    ['excluded', 'unordered', '2026-11-05T23:59:59Z', false, 'excluded']
  ] as const)('treats a phone verify match as arrived state=%s material=%s verifiedAt=%s', async (state, status, verifiedAt, arrived, effective) => {
    vi.mocked(enrichRowsWithProcessArrival).mockImplementationOnce(async (rows) => rows.map((row) => ({ ...row, arrived: true, isFirstProcess: true })));
    mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.findMany.mockResolvedValue(state ? [
      { itemKey: 'row:item-a', state, recordedAt: new Date('2026-11-06T00:00:00Z') }
    ] : []);
    mocks.findMaterialArrivalStatusByPart.mockResolvedValue(new Map([['ORDER-A\tPART-A', { status, basis: 'material' }]]));
    mocks.prisma.mobileSlipVerifyRecord.groupBy.mockResolvedValue(verifiedAt ? [
      { transferOrderBarcodeRaw: '1', _max: { verifiedAt: new Date(verifiedAt) } }
    ] : []);
    const result = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'resource' });
    expect(result.items[0]).toMatchObject({ isFirstProcess: true, firstProcessState: effective, arrived });
    expect(mocks.prisma.mobileSlipVerifyRecord.groupBy).toHaveBeenCalledWith({
      by: ['transferOrderBarcodeRaw'],
      where: { outcome: 'match', transferOrderBarcodeRaw: { in: ['1'] } },
      _max: { verifiedAt: true }
    });
  });

  it.each([true, false])('uses first-process state only on first processes and ignores old daily arrival there (%s)', async (isFirstProcess) => {
    vi.mocked(enrichRowsWithProcessArrival).mockImplementationOnce(async (rows) => rows.map((row) => ({ ...row, arrived: false, isFirstProcess })));
    mocks.prisma.productionScheduleGrindingPlanningBoardArrival.findMany.mockResolvedValue([{ itemKey: 'row:item-a' }]);
    mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.findMany.mockResolvedValue([
      { itemKey: 'row:item-a', state: 'excluded', recordedAt: new Date('2026-11-06T00:00:00Z') }
    ]);
    const result = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'resource' });
    expect(result.items[0]).toMatchObject({ isFirstProcess, firstProcessState: isFirstProcess ? 'excluded' : null, arrived: !isFirstProcess });
  });

  it('reads first-process state by parent key for split pieces', async () => {
    const projection = mocks.projectGrindingPlanningBoard();
    mocks.projectGrindingPlanningBoard.mockReturnValue({ ...projection,
      items: [{ ...projection.items[0], itemId: 'piece:a', parentItemId: 'row:item-a' }] });
    vi.mocked(enrichRowsWithProcessArrival).mockImplementationOnce(async (rows) => rows.map((row) => ({ ...row, arrived: true, isFirstProcess: true })));
    mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.findMany.mockResolvedValue([
      { itemKey: 'row:item-a', state: 'excluded', recordedAt: new Date('2026-11-06T00:00:00Z') }
    ]);
    const result = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'resource' });
    expect(result.items[0]).toMatchObject({ itemId: 'piece:a', arrived: false, firstProcessState: 'excluded' });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ itemKey: { in: ['row:item-a'] } })
    }));
  });

  it.each(['arrived', 'excluded'] as const)('retains first-process %s across midnight and warm snapshot reads', async (state) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.mocked(enrichRowsWithProcessArrival).mockImplementation(async (rows) => rows.map((row) => ({ ...row, arrived: true, isFirstProcess: true })));
      mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.findMany.mockResolvedValue([
        { itemKey: 'row:item-a', state, recordedAt: new Date('2026-11-05T00:00:00Z') }
      ]);
      const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'resource' as const };
      vi.setSystemTime(new Date('2026-11-06T14:59:00Z'));
      const first = await getGrindingPlanningBoard(params);
      vi.setSystemTime(new Date('2026-11-06T15:01:00Z'));
      const next = await getGrindingPlanningBoard({ ...params, snapshotId: first.snapshotId });
      for (const result of [first, next]) expect(result.items[0]).toMatchObject({ firstProcessState: state, arrived: state === 'arrived' });
      const query = mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.findMany.mock.calls[0][0];
      expect(query.where).toEqual({ csvDashboardId: expect.any(String), siteKey: 'site-a', itemKey: { in: ['row:item-a'] } });
    } finally {
      vi.useRealTimers();
      vi.mocked(enrichRowsWithProcessArrival).mockImplementation(async (rows) => rows.map((row) => ({ ...row, arrived: true })));
    }
  });

  it('adds current process arrival to responses without mutating the saved projection', async () => {
    vi.mocked(enrichRowsWithProcessArrival).mockImplementationOnce(async (rows) => rows.map((row) => ({ ...row, arrived: false })));
    const result = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'resource' });
    expect(result.items[0]?.arrived).toBe(false);
    expect(enrichRowsWithProcessArrival).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: 'row:item-a', sourceRowId: 'source-row-1' })]),
      expect.objectContaining({ siteKey: 'site-a', placedProductNos: new Set() }));
    expect(mocks.projectGrindingPlanningBoard.mock.results[0]?.value.items[0]).not.toHaveProperty('arrived');
  });

  it.each(['scaw', undefined] as const)('matches GET and acknowledged revisions using dueSource=%s', async (dueSource) => {
    const actual = await vi.importActual<typeof import('../grinding-planning-board-projection.js')>('../grinding-planning-board-projection.js');
    mocks.projectGrindingPlanningBoard.mockImplementation(actual.projectGrindingPlanningBoard);
    const [detail] = await mocks.prisma.csvDashboardRow.findMany();
    const dueDetail = { ...detail, rowNotes: [], excelDueDate: new Date('2026-09-10'),
      orderSupplements: [{ plannedQuantity: 1, plannedEndDate: new Date('2026-09-20') }] };
    mocks.prisma.csvDashboardRow.findMany.mockResolvedValue([dueDetail]);
    vi.spyOn(planningSource, 'readPlanningSource').mockResolvedValueOnce({ baseWhere: { strings: ['TRUE'], values: [] } as never,
      generationToken: 'generation', rows: [mocks.sourceRow], details: new Map([[mocks.sourceRow.id, dueDetail]]), progressRows: [] });
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const board = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'grinding', view: 'resource', dueSource, includeLoad: false, snapshotStore });
    const item = board.items[0]!;
    expect(item.originalDueDate).toBe(dueSource === 'scaw' ? '2026-09-20' : '2026-09-10');
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
    mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert.mockImplementation(async ({ create }) => ({ ...create, version: 1 }));
    await expect(updateGrindingPlanningBoardPins({ siteKey: 'site-a', sourceRevision: board.sourceRevision,
      dueSource: dueSource === 'scaw' ? undefined : 'scaw', items: [{ itemId: item.itemId, itemRevision: item.itemRevision }], pinned: true
    })).rejects.toMatchObject({ statusCode: 409, code: 'STALE_PLANNING_BOARD_ITEM' });
    const result = await updateGrindingPlanningBoardPins({ siteKey: 'site-a', sourceRevision: board.sourceRevision, dueSource,
      items: [{ itemId: item.itemId, itemRevision: item.itemRevision }], pinned: true });
    const saved = result.items[0]!;
    expect(saved).toMatchObject({ originalDueDate: item.originalDueDate, effectiveDueDate: item.effectiveDueDate, orderPinned: true });
    expect(saved.itemRevision).not.toBe(item.itemRevision);
    const projected = actual.projectGrindingPlanningBoard({ rows: [mocks.sourceRow], details: new Map([[mocks.sourceRow.id,
      dueDetail]]),
      overrides: new Map([[item.itemId, { ...mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert.mock.calls[0]![0].create, version: 1 }]]),
      ranks: { rows: new Map() }, seibanOrder: ['ORDER-A'], category: 'grinding', dueSource });
    expect(saved.itemRevision).toBe(projected.items[0]!.itemRevision);
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

  it.each([null, '棚A'])('attaches one shelf with its label or raw code (%s)', async (displayLabel) => {
    mocks.prisma.orderPlacementBranchState.findMany.mockResolvedValue([
      { manufacturingOrderBarcodeRaw: '1', shelfCodeRaw: 'A', updatedAt: new Date('2026-10-24T06:20:00Z') }
    ]);
    mocks.prisma.mobilePlacementShelf.findMany.mockResolvedValue([{ shelfCodeRaw: 'A', displayLabel }]);
    const response = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'all', view: 'seiban',
      snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 }) });
    expect(response.items[0]?.placement).toEqual({ shelves: [
      { shelfCodeRaw: 'A', label: displayLabel ?? 'A', placedAt: '2026-10-24T06:20:00.000Z' }
    ] });
  });

  it('batches only page product numbers and manufacturing orders, sorting and deduplicating shelves', async () => {
    const projection = mocks.projectGrindingPlanningBoard.getMockImplementation()!();
    const items = [' 1 ', '2', '1', '3'].map((productNo, index) => ({ ...projection.items[0], productNo, itemId: `item-${index}` }));
    mocks.projectGrindingPlanningBoard.mockReturnValue({ ...projection, items, allItems: items });
    const states = [
      { manufacturingOrderBarcodeRaw: '1', branchNo: 1, slipKind: 'manufacturing_order', shelfCodeRaw: 'A', updatedAt: new Date('2026-10-23T06:20:00Z') },
      { manufacturingOrderBarcodeRaw: '1', branchNo: 2, slipKind: 'manufacturing_order', shelfCodeRaw: 'B', updatedAt: new Date('2026-10-24T06:20:00Z') },
      { manufacturingOrderBarcodeRaw: '1', branchNo: 3, slipKind: 'manufacturing_order', shelfCodeRaw: 'A', updatedAt: new Date('2026-10-25T06:20:00Z') },
      { manufacturingOrderBarcodeRaw: '2', branchNo: 1, slipKind: 'purchase_order', shelfCodeRaw: 'C', updatedAt: new Date('2026-10-25T06:20:00Z') }
    ];
    mocks.prisma.orderPlacementBranchState.findMany.mockImplementation(async ({ where, orderBy }) => {
      expect(where).toEqual({ slipKind: 'manufacturing_order', manufacturingOrderBarcodeRaw: { in: ['1', '2'] } });
      expect(orderBy).toEqual({ updatedAt: 'desc' });
      return states.filter((state) => state.slipKind === where.slipKind && where.manufacturingOrderBarcodeRaw.in.includes(state.manufacturingOrderBarcodeRaw))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    });
    mocks.prisma.mobilePlacementShelf.findMany.mockResolvedValue([{ shelfCodeRaw: 'A', displayLabel: '棚A' }]);
    const response = await getGrindingPlanningBoard({ siteKey: 'site-a', category: 'all', view: 'seiban', pageSize: 3,
      snapshotStore: createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 }) });
    expect(response.items[0]?.placement).toEqual({ shelves: [
      { shelfCodeRaw: 'A', label: '棚A', placedAt: '2026-10-25T06:20:00.000Z' },
      { shelfCodeRaw: 'B', label: 'B', placedAt: '2026-10-24T06:20:00.000Z' }
    ] });
    expect(response.items[1]).not.toHaveProperty('placement');
    expect(response.items[2]?.placement).toEqual(response.items[0]?.placement);
    expect(mocks.prisma.orderPlacementBranchState.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.mobilePlacementShelf.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.mobilePlacementShelf.findMany).toHaveBeenCalledWith({
      where: { shelfCodeRaw: { in: ['A', 'B'] } }, select: { shelfCodeRaw: true, displayLabel: true }
    });
  });

  it('refreshes placement on snapshot and warm reads without changing revisions or cached items', async () => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'all' as const, view: 'seiban' as const, snapshotStore };
    const first = await getGrindingPlanningBoard(params);
    expect(first.items[0]).not.toHaveProperty('placement');
    expect(mocks.prisma.mobilePlacementShelf.findMany).not.toHaveBeenCalled();
    mocks.prisma.orderPlacementBranchState.findMany.mockResolvedValue([
      { manufacturingOrderBarcodeRaw: '1', shelfCodeRaw: 'B', updatedAt: new Date('2026-10-24T06:20:00Z') }
    ]);
    const next = await getGrindingPlanningBoard({ ...params, snapshotId: first.snapshotId });
    expect(next.items[0]?.placement?.shelves[0]?.label).toBe('B');
    expect(next.items[0]?.itemRevision).toBe(first.items[0]?.itemRevision);
    expect(next.sourceRevision).toBe(first.sourceRevision);
    expect((snapshotStore.get(first.snapshotId)?.payload as { items: object[] }).items[0]).not.toHaveProperty('placement');
    mocks.prisma.orderPlacementBranchState.findMany.mockResolvedValue([]);
    const warm = await getGrindingPlanningBoard(params);
    expect(warm.items[0]).not.toHaveProperty('placement');
    expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.orderPlacementBranchState.findMany).toHaveBeenCalledTimes(3);
  });

  it('reuses load aggregates across board-only writes on both read paths', async () => {
    const params = { siteKey: 'site-a', category: 'grinding' as const };
    const first = await getGrindingPlanningBoardLoad(params);
    mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue({ ...mocks.state, version: 1 });
    expect(await getGrindingPlanningBoardLoad(params)).toEqual(first);
    await getGrindingPlanningBoard({ ...params, view: 'seiban' });
    const calls = mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => JSON.stringify(sql).includes('effectiveItems'));
    expect(calls).toHaveLength(1);
  });

  it('accepts board-only generation changes during a load-only read', async () => {
    mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique
      .mockResolvedValueOnce(mocks.state).mockResolvedValue({ ...mocks.state, version: 1 });
    await expect(getGrindingPlanningBoardLoad({ siteKey: 'site-a', category: 'grinding' })).resolves.toHaveProperty('load');
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
    const queries = mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => !JSON.stringify(sql).includes('string_agg('));
    expect(queries).toHaveLength(1);
    expect(JSON.stringify(queries[0])).toContain('ProductionScheduleGrindingPlanningBoardTestBar');
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
    overrideResourceFingerprint = 'changed-override-resource';
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
    const queries = mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => !JSON.stringify(sql).includes('string_agg('));
    expect(queries).toHaveLength(1);
    expect(JSON.stringify(queries[0])).toContain('FSEZONO');
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
      overrideResourceFingerprint = `override-resources-${version}`;
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

    it('hits startup payload and load caches through the real readers with the UI request keys', async () => {
      vi.useFakeTimers();
      const snapshotStore = createStore();
      const query = mocks.prisma.$queryRaw.getMockImplementation()!;
      mocks.prisma.$queryRaw.mockImplementation(async (sql: unknown) => {
        if (JSON.stringify(sql).includes('UNION') && JSON.stringify(sql).includes('ProductionScheduleGrindingPlanningBoardState')) {
          return [{ siteKey: 'site-a' }];
        }
        return query(sql);
      });
      const warmup = createGrindingPlanningBoardStartupWarmup({ enabled: true, delayMs: 45_000, snapshotStore });
      const create = vi.spyOn(snapshotStore, 'create');
      try {
        warmup.start();
        await vi.advanceTimersByTimeAsync(45_000);
        await warmup.stop();
        expect(planningSource.readPlanningSource).toHaveBeenCalledTimes(3);
        expect(mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => JSON.stringify(sql).includes('effectiveItems'))).toHaveLength(1);
        expect(create).not.toHaveBeenCalled();
        expect(mocks.findMaterialArrivalStatusByPart).not.toHaveBeenCalled();
        for (const category of ['grinding', 'cutting', 'all'] as const) {
          vi.mocked(planningSource.readPlanningSource).mockClear();
          mocks.projectGrindingPlanningBoard.mockClear();
          mocks.prisma.$queryRaw.mockClear();
          const response = await getGrindingPlanningBoard({
            siteKey: 'site-a', category, view: 'resource', completionFilter: 'incomplete',
            includeLoad: false, includePieces: true, snapshotStore
          });
          await getGrindingPlanningBoardLoad({ siteKey: 'site-a', category });
          expect(response.items).toHaveLength(1);
          expect(response.load).toEqual([]);
          expect(planningSource.readPlanningSource).not.toHaveBeenCalled();
          expect(mocks.projectGrindingPlanningBoard).not.toHaveBeenCalled();
          const queries = mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => !JSON.stringify(sql).includes('string_agg('));
          expect(queries).toHaveLength(2);
          expect(JSON.stringify(queries[0])).toContain('FSEZONO');
        }
        changeGeneration();
        await getGrindingPlanningBoardLoad({ siteKey: 'site-a', category: 'grinding' });
        expect(mocks.prisma.$queryRaw.mock.calls.some(([sql]) => JSON.stringify(sql).includes('effectiveItems'))).toBe(true);
      } finally {
        await warmup.stop();
        vi.useRealTimers();
      }
    });

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
      const queries = mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => !JSON.stringify(sql).includes('string_agg('));
      expect(queries).toHaveLength(1);
      expect(JSON.stringify(queries[0])).toContain('FSEZONO');
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

  it.each(['csv', 'state', 'override', 'resource', 'machine-name', 'minute-source', 'part-minutes'])('rebuilds without a supplied ID after %s changes', async (change) => {
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, snapshotStore };
    const first = await getGrindingPlanningBoard(params);
    const revision = { _count: { _all: 3 }, _max: { updatedAt: new Date('2026-09-12T00:00:00Z') } };
    if (change === 'csv') mocks.readGrindingPlanningBoardSnapshotGenerationToken.mockResolvedValue('csv-2');
    if (change === 'state') mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue({ ...mocks.state, version: 1 });
    if (change === 'override') mocks.prisma.productionScheduleGrindingPlanningBoardOverride.aggregate.mockResolvedValue(revision);
    if (change === 'resource') mocks.prisma.productionScheduleResourceMaster.aggregate.mockResolvedValue(revision);
    if (change === 'minute-source') mocks.prisma.productionScheduleGrindingPlanningBoardResourceMinutesSource.aggregate.mockResolvedValue(revision);
    if (change === 'part-minutes') mocks.prisma.productionScheduleGrindingPlanningBoardResourcePartMinutes.aggregate.mockResolvedValue(revision);
    if (change === 'machine-name') mocks.prisma.productionScheduleSeibanMachineNameSupplement.aggregate.mockResolvedValue(revision);
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
      expect(continued.items).toEqual([{ ...items[1], arrived: true, manualArrivalDate: null, isFirstProcess: false, firstProcessState: null }]);
      expect(continued.nextCursor).toBeNull();
      expect(mocks.projectGrindingPlanningBoard).toHaveBeenCalledTimes(1);
      const queries = mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => !JSON.stringify(sql).includes('string_agg('));
      expect(queries).toHaveLength(2);
      for (const call of queries) expect(JSON.stringify(call)).toContain('FSEZONO');
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
    expect(second.items).toEqual([{ ...items[1], arrived: true, manualArrivalDate: null, isFirstProcess: false, firstProcessState: null }]);
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
    expect(mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => !JSON.stringify(sql).includes('string_agg('))).toHaveLength(0);
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

  it('keeps the default at 160 and reads generation once per continuation capped at 640', async () => {
    const projection = mocks.projectGrindingPlanningBoard.getMockImplementation()!();
    const items = Array.from({ length: 1441 }, (_, index) => ({ ...projection.items[0], itemId: `row:${index}` }));
    mocks.projectGrindingPlanningBoard.mockReturnValue({ ...projection, allItems: items, items });
    const snapshotStore = createInMemoryLeaderboardShellSnapshotStore({ defaultTtlMs: 60_000 });
    const params = { siteKey: 'site-a', category: 'grinding' as const, view: 'seiban' as const, includeLoad: false, snapshotStore };
    const first = await getGrindingPlanningBoard(params);
    expect(first.items).toHaveLength(160);
    expect(first.nextCursor).toBe('160');

    for (const [cursor, pageSize] of [[160, 640], [800, 641]]) {
      vi.clearAllMocks();
      const continued = await getGrindingPlanningBoard({ ...params, cursor, pageSize, snapshotId: first.snapshotId });
      expect(continued.items).toEqual(items.slice(cursor, cursor + 640).map((item) => ({ ...item, arrived: true, manualArrivalDate: null, isFirstProcess: false, firstProcessState: null })));
      expect(continued.nextCursor).toBe(String(cursor + 640));
      expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(1);
      expect(mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique).toHaveBeenCalledTimes(2);
      expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.aggregate).toHaveBeenCalledTimes(1);
      expect(mocks.prisma.productionScheduleResourceMaster.aggregate).toHaveBeenCalledTimes(1);
      expect(mocks.prisma.productionScheduleSeibanMachineNameSupplement.aggregate).toHaveBeenCalledTimes(1);
    }
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
      .mockResolvedValueOnce('leaderboard-generation-2');

    await expect(getGrindingPlanningBoard({
      siteKey: 'site-a',
      category: 'grinding',
      view: 'seiban',
      cursor: 0,
      snapshotId: first.snapshotId,
      snapshotStore
    })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    expect(mocks.readGrindingPlanningBoardSnapshotGenerationToken).toHaveBeenCalledTimes(1);
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
      if (query.includes('ProductionScheduleGrindingPlanningBoardTestBar')) return [];
      if (query.includes('ProductionScheduleGrindingPlanningBoardState')) return [mocks.state];
      if (query.includes('ProductionScheduleGrindingPlanningBoardOverride') && !query.includes('effectiveItems')) return [];
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
      if (query.includes('ProductionScheduleGrindingPlanningBoardTestBar')) return [];
      if (query.includes('ProductionScheduleGrindingPlanningBoardState')) return [mocks.state];
      if (query.includes('ProductionScheduleGrindingPlanningBoardOverride') && !query.includes('effectiveItems')) return [];
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
      productionScheduleDScheduleMinutes: mocks.prisma.productionScheduleDScheduleMinutes,
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
      productionScheduleDScheduleMinutes: mocks.prisma.productionScheduleDScheduleMinutes,
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
    mocks.prisma.productionScheduleDScheduleMinutes.findMany.mockResolvedValue([]);
    const second = { ...mocks.sourceRow, id: 'source-row-2', rowData: { ...mocks.sourceRow.rowData, FHINCD: 'PART-B' } };
    const rows = [mocks.sourceRow, second];
    items = rows.map((row) => ({ itemId: mocks.buildGrindingPlanningBoardRowItemId(row.rowData), itemRevision: `revision-${row.id}`,
      version: 0, sourceRowId: row.id, fseiban: 'ORDER-A', originalResourceCd: '305', effectiveResourceCd: '305', isCompleted: false }));
    mocks.prisma.$queryRaw.mockImplementation(async (strings: unknown) => {
      const query = Array.isArray(strings) ? strings.join(' ') : JSON.stringify(strings);
      return query.includes('ProductionScheduleGrindingPlanningBoardState') ? [mocks.state] : rows;
    });
    mocks.prisma.csvDashboardRow.findMany.mockResolvedValue(rows.map((row) => ({ id: row.id, updatedAt: row.updatedAt,
      rowNotes: [], orderSupplements: [], productionScheduleProgress: null, productionScheduleExternalCompletion: null })));
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
  it('records and cancels a site-shared arrival without modifying ranks or overrides', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-05T15:00:00.000Z'));
      const target = items[0]!;
      const payload = { siteKey: 'site-a', itemId: target.itemId, itemRevision: target.itemRevision, overrideVersion: 0 };
      expect(await updateGrindingPlanningBoardArrival({ ...payload, recorded: true })).toEqual({
        itemId: target.itemId, manualArrivalDate: '2026-11-06'
      });
      const key = { csvDashboardId: expect.any(String), siteKey: 'site-a', itemKey: target.itemId, arrivalDate: new Date('2026-11-06T00:00:00.000Z') };
      expect(mocks.prisma.productionScheduleGrindingPlanningBoardArrival.upsert).toHaveBeenCalledWith({
        where: { csvDashboardId_siteKey_arrivalDate_itemKey: key }, create: key, update: {}
      });
      expect(await updateGrindingPlanningBoardArrival({ ...payload, recorded: false })).toEqual({ itemId: target.itemId, manualArrivalDate: null });
      expect(mocks.prisma.productionScheduleGrindingPlanningBoardArrival.deleteMany).toHaveBeenCalledWith({ where: key });
      expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it.each(['arrived', 'excluded', null] as const)('persists first-process state %s with locks and no arrival date', async (state) => {
    vi.mocked(enrichRowsWithProcessArrival).mockImplementationOnce(async (rows) => rows.map((row) => ({ ...row, arrived: true, isFirstProcess: true })));
    const target = items[0]!;
    const before = Date.now();
    const result = await updateGrindingPlanningBoardFirstProcessArrival({ siteKey: 'site-a', itemId: target.itemId,
      itemRevision: target.itemRevision, overrideVersion: 0, state });
    expect(result).toEqual({ itemId: target.itemId, firstProcessState: state });
    expect(mocks.acquireParentRowLock).toHaveBeenCalledWith(mocks.prisma, target.sourceRowId);
    const key = { csvDashboardId: expect.any(String), siteKey: 'site-a', itemKey: target.itemId };
    if (state) {
      const data = { state, recordedAt: expect.any(Date) };
      expect(mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.upsert).toHaveBeenCalledWith({
        where: { csvDashboardId_siteKey_itemKey: key }, create: { ...key, ...data }, update: data
      });
      expect(mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.upsert.mock.calls[0][0].update.recordedAt.getTime()).toBeGreaterThanOrEqual(before);
    } else expect(mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.deleteMany).toHaveBeenCalledWith({ where: key });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardArrival.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).not.toHaveBeenCalled();
  });

  it.each(['revision', 'version', 'completed', 'missing', 'invalid', 'later'] as const)('rejects %s first-process writes before persistence', async (guard) => {
    const target = items[0]!;
    if (guard === 'completed') target.isCompleted = true;
    if (guard === 'missing') items = [];
    vi.mocked(enrichRowsWithProcessArrival).mockImplementationOnce(async (rows) => rows.map((row) => ({ ...row, arrived: true, isFirstProcess: false })));
    await expect(updateGrindingPlanningBoardFirstProcessArrival({ siteKey: 'site-a', state: 'arrived',
      itemId: guard === 'invalid' ? 'bad-id' : target.itemId,
      itemRevision: guard === 'revision' ? 'stale' : target.itemRevision, overrideVersion: guard === 'version' ? 99 : 0
    })).rejects.toMatchObject({ code: guard === 'invalid' ? 'INVALID_ITEM_ID' : guard === 'completed' ? 'COMPLETED_ITEM' : guard === 'later' ? 'NOT_FIRST_PROCESS' : 'STALE_PLANNING_BOARD_ITEM' });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.deleteMany).not.toHaveBeenCalled();
    vi.mocked(enrichRowsWithProcessArrival).mockReset().mockImplementation(async (rows) => rows.map((row) => ({ ...row, arrived: true })));
  });

  it.each(['revision', 'version', 'completed', 'missing', 'invalid'] as const)('rejects %s arrival writes before persistence', async (guard) => {
    const target = items[0]!;
    if (guard === 'completed') target.isCompleted = true;
    if (guard === 'missing') items = [];
    await expect(updateGrindingPlanningBoardArrival({ siteKey: 'site-a', recorded: true,
      itemId: guard === 'invalid' ? 'bad-id' : target.itemId,
      itemRevision: guard === 'revision' ? 'stale' : target.itemRevision, overrideVersion: guard === 'version' ? 99 : 0
    })).rejects.toMatchObject({ code: guard === 'invalid' ? 'INVALID_ITEM_ID' : guard === 'completed' ? 'COMPLETED_ITEM' : 'STALE_PLANNING_BOARD_ITEM' });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardArrival.upsert).not.toHaveBeenCalled();
  });

  it('drag reorders the full pane without duplicate ranks and keeps a hidden leading row in place', async () => {
    const hidden = { ...items[0]!, itemId: 'hidden-parent', alternateRank: 1, productNo: '1', processOrder: '5', arrived: false };
    items = items.map((item, index) => ({ ...item, alternateRank: index + 2, productNo: '1', processOrder: String(index * 10 + 10) }));
    const [target, source] = items;
    items.push(hidden);
    const result = await updateGrindingPlanningBoardResourceOrder({ siteKey: 'site-a', sourceRevision: revision,
      itemId: source!.itemId, itemRevision: source!.itemRevision, targetItemId: target!.itemId, targetItemRevision: target!.itemRevision,
      placement: 'before' });
    expect(result.items.map((item) => item.itemId)).toEqual([hidden.itemId, source!.itemId, target!.itemId]);
    expect(result.items.map((item) => item.alternateRank)).toEqual([1, 2, 3]);
    expect(new Set(result.items.map((item) => item.alternateRank)).size).toBe(3);
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).toHaveBeenCalledExactlyOnceWith(expect.any(Function), { isolationLevel: 'RepeatableRead', timeout: 30000, maxWait: 15000 });
    const winnerQueries = mocks.prisma.$queryRaw.mock.calls.filter(([query]) => JSON.stringify(query).includes('rowData'));
    expect(winnerQueries).toHaveLength(1); // one FSEIBAN-scoped winner read; no dashboard-wide winner materialization

    expect(result.items.find((item) => item.itemId === hidden.itemId)?.alternateRank).toBe(hidden.alternateRank);
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert.mock.calls.map(([args]) => args.create.itemKey))
      .toEqual([hidden.itemId, source!.itemId, target!.itemId]);
  });

  it.each(['drag', 'bulk'] as const)('preserves the slot of a seiban hidden by scheduleSource during %s', async (method) => {
    const hiddenRow = { ...mocks.sourceRow, id: 'hidden-row', rowData: { ...mocks.sourceRow.rowData, FSEIBAN: 'HIDDEN' } };
    const hidden = { ...items[0]!, sourceRowId: hiddenRow.id, fseiban: 'HIDDEN',
      itemId: mocks.buildGrindingPlanningBoardRowItemId(hiddenRow.rowData), alternateRank: 2 };
    items = items.map((item, index) => ({ ...item, alternateRank: index * 2 + 1 }));
    const [target, source] = items;
    items.push(hidden);
    const state = { ...mocks.state, seibanOrder: ['ORDER-A', 'HIDDEN'] };
    const sourceRevision = JSON.stringify({ boardVersion: state.version,
      orderHash: createHash('sha256').update(JSON.stringify(state.seibanOrder)).digest('hex') });
    mocks.prisma.productionScheduleGrindingPlanningBoardState.findUnique.mockResolvedValue(state);
    mocks.listKinds.mockResolvedValue(new Map([['ORDER-A', ['D_COMPANY']], ['HIDDEN', ['INTERNAL']]]));
    const read = mocks.prisma.$queryRaw.getMockImplementation()!;
    mocks.prisma.$queryRaw.mockImplementation(async (...args) => {
      const query = Array.isArray(args[0]) ? args[0].join(' ') : JSON.stringify(args[0]);
      if (query.includes('ProductionScheduleGrindingPlanningBoardTestBar')) return [];
      if (query.includes('ProductionScheduleGrindingPlanningBoardState')) return [state];
      const result = await read(...args);
      return query.includes('rowData') || (query.includes('CsvDashboardRow') && query.includes('FOR UPDATE')) ? [...result, hiddenRow] : result;
    });
    const project = mocks.projectGrindingPlanningBoard.getMockImplementation()!;
    mocks.projectGrindingPlanningBoard.mockImplementation((params) => ({
      allItems: project(params).allItems.filter((item: { sourceRowId: string }) => params.rows.some((row: { id: string }) => row.id === item.sourceRowId))
    }));
    const result = method === 'drag'
      ? await updateGrindingPlanningBoardResourceOrder({ siteKey: 'site-a', scheduleSource: 'dCompany', sourceRevision,
        itemId: source!.itemId, itemRevision: source!.itemRevision, targetItemId: target!.itemId, targetItemRevision: target!.itemRevision, placement: 'before' })
      : await updateGrindingPlanningBoardResourceOrderBulk({ siteKey: 'site-a', scheduleSource: 'dCompany', sourceRevision, resourceCd: '305',
        items: [source!, target!].map((item) => ({ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: 0 })) });
    expect(result.items.map((item) => item.itemId)).toEqual([source!.itemId, target!.itemId]);
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert.mock.calls.map(([args]) => [args.create.itemKey, args.create.alternateRank]))
      .toEqual([[source!.itemId, 1], [hidden.itemId, 2], [target!.itemId, 3]]);
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardState.update).not.toHaveBeenCalled();
    expect(state.seibanOrder).toEqual(['ORDER-A', 'HIDDEN']);
  });

  it('creates only a pin with null override semantics and returns the acknowledged item', async () => {
    const payload = request();
    const result = await updateGrindingPlanningBoardPins({ siteKey: 'site-a', sourceRevision: payload.sourceRevision, items: [payload.items[0]!], pinned: true });
    expect(result.items[0]).toMatchObject({ orderPinned: true, version: 1 });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).toHaveBeenCalledWith({
      where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: expect.any(String), siteKey: 'site-a', itemKey: payload.items[0]!.itemId } },
      create: expect.objectContaining({ orderPinned: true, overrideResourceCd: null, overrideDueDate: null, dueDateCleared: null, alternateRank: null, specialDueKind: null, specialDueExpiresAt: null }),
      update: expect.objectContaining({ orderPinned: true, version: { increment: 1 } })
    });
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', timeout: 30000, maxWait: 15000 });
  });
  it('does not create an override for an already unpinned item', async () => {
    await updateGrindingPlanningBoardPins({ ...request(), pinned: false });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).not.toHaveBeenCalled();
  });
  it('unpins without changing other overrides and resource-order writes preserve pins', async () => {
    const previous = { itemKey: items[0]!.itemId, version: 0, orderPinned: true, overrideResourceCd: '305',
      overrideDueDate: new Date('2026-10-19'), overrideDueDateSetAt: new Date('2026-10-18T01:00:00Z'), dueDateCleared: false, alternateRank: 7,
      specialDueKind: null, specialDueExpiresAt: null };
    mocks.prisma.productionScheduleGrindingPlanningBoardOverride.findMany.mockResolvedValue([previous]);
    // The mocked projection leaves the revision unchanged for the current override.
    mocks.projectGrindingPlanningBoard.mockReturnValue({ allItems: items });
    const payload = request();
    await updateGrindingPlanningBoardPins({ ...payload, items: [payload.items[1]!], pinned: false });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).toHaveBeenLastCalledWith(expect.objectContaining({
      update: { orderPinned: false, overrideResourceCd: '305', overrideDueDate: previous.overrideDueDate,
        overrideDueDateSetAt: previous.overrideDueDateSetAt, dueDateCleared: false,
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
  it('assigns ordinary row ranks in one legacy RepeatableRead transaction and returns ordered revisions', async () => {
    const payload = request();
    const result = await updateGrindingPlanningBoardResourceOrderBulk(payload);
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead', timeout: 30000, maxWait: 15000 });
    expect(result.sourceRevision).toBe(revision);
    expect(result.items.map((item) => item.itemId)).toEqual(payload.items.map((item) => item.itemId));
    expect(result.items.map((item) => item.alternateRank)).toEqual([1, 2]);
    expect(result.items.every((item) => item.version === 1 && item.itemRevision.startsWith('saved-'))).toBe(true);
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).toHaveBeenCalledTimes(2);
    expect(mocks.acquireParentRowLock).not.toHaveBeenCalled();
  });
  it('locks multiple parents with exactly two SQL calls in sorted row order', async () => {
    await updateGrindingPlanningBoardResourceOrderBulk(request());
    expect(mocks.prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [advisorySql, lockIds] = mocks.prisma.$executeRaw.mock.calls[0]!;
    expect(advisorySql.join(' ')).toContain('pg_advisory_xact_lock');
    expect(lockIds).toEqual(['source-row-1', 'source-row-2'].map((id) => createHash('sha256').update(id).digest().readBigInt64BE(0)));
    const parentLocks = mocks.prisma.$queryRaw.mock.calls.filter(([sql]) => Array.isArray(sql) && sql.join(' ').includes('FOR UPDATE') && sql.join(' ').includes('CsvDashboardRow'));
    expect(parentLocks).toHaveLength(1);
    const [sql, dashboardId, rowIds] = parentLocks[0]!;
    expect(sql.join(' ')).toBe('SELECT "id" FROM "CsvDashboardRow" WHERE "csvDashboardId" =   AND "id" = ANY( ::text[]) ORDER BY "id" FOR UPDATE');
    expect(dashboardId).toBe(PRODUCTION_SCHEDULE_DASHBOARD_ID);
    expect(rowIds).toEqual(['source-row-1', 'source-row-2']);
    const stateLockIndex = mocks.prisma.$queryRaw.mock.calls.findIndex(([query]) => Array.isArray(query) && query.join(' ').includes('FOR UPDATE') && query.join(' ').includes('ProductionScheduleGrindingPlanningBoardState'));
    const stateLockOrder = mocks.prisma.$queryRaw.mock.invocationCallOrder[stateLockIndex]!;
    expect(stateLockOrder).toBeLessThan(mocks.prisma.$executeRaw.mock.invocationCallOrder[0]!);
    expect(mocks.prisma.$executeRaw.mock.invocationCallOrder[0]!).toBeLessThan(mocks.prisma.$queryRaw.mock.invocationCallOrder[mocks.prisma.$queryRaw.mock.calls.indexOf(parentLocks[0]!)]!);
  });
  it.each(['source-row-1', 'source-row-2'])('returns the existing 409 when parent %s disappears before locking', async (missingId) => {
    const read = mocks.prisma.$queryRaw.getMockImplementation()!;
    mocks.prisma.$queryRaw.mockImplementation(async (...args) => {
      const rows = await read(...args);
      const query = Array.isArray(args[0]) ? args[0].join(' ') : JSON.stringify(args[0]);
      return query.includes('CsvDashboardRow') && query.includes('FOR UPDATE') ? rows.filter((row: { id: string }) => row.id !== missingId) : rows;
    });
    await expect(updateGrindingPlanningBoardResourceOrderBulk(request())).rejects.toMatchObject({
      statusCode: 409, code: 'STALE_PLANNING_BOARD_ITEM', message: '元行が消滅しています。再読み込みしてください'
    });
    expect(mocks.prisma.productionScheduleGrindingPlanningBoardOverride.upsert).not.toHaveBeenCalled();
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
