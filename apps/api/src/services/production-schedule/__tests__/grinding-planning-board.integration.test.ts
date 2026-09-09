import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Prisma } from '@prisma/client';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardResponse } from '@raspi-system/shared-types';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

/**
 * This file intentionally has no localhost/database fallback. The production
 * schedule dashboard is shared by many tests and must never be modified by an
 * integration run that did not opt into an isolated database.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? '';
const databaseName = (() => {
  try {
    return new URL(testDatabaseUrl).pathname.replace(/^\//, '').split('?')[0] ?? '';
  } catch {
    return '';
  }
})();
const hasDedicatedDatabase = Boolean(testDatabaseUrl) && !['borrow_return', 'postgres', 'template1'].includes(databaseName);
const originalDatabaseUrl = process.env.DATABASE_URL;

type PrismaClient = import('@prisma/client').PrismaClient;
type BoardService = typeof import('../grinding-planning-board.service.js');
type SnapshotStore = ReturnType<typeof import('../leaderboard/leaderboard-shell-snapshot.store.js').createInMemoryLeaderboardShellSnapshotStore>;

let dbClient: PrismaClient | undefined;
let boardService: BoardService | undefined;
let createSnapshotStore: typeof import('../leaderboard/leaderboard-shell-snapshot.store.js').createInMemoryLeaderboardShellSnapshotStore | undefined;

if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  ({ prisma: dbClient } = await import('../../../lib/prisma.js'));
  boardService = await import('../grinding-planning-board.service.js');
  ({ createInMemoryLeaderboardShellSnapshotStore: createSnapshotStore } = await import('../leaderboard/leaderboard-shell-snapshot.store.js'));
}

const describeIntegration = hasDedicatedDatabase ? describe : describe.skip;

function db(): PrismaClient {
  if (!dbClient) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return dbClient;
}

function service(): BoardService {
  if (!boardService) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return boardService;
}

function snapshotStore(): SnapshotStore {
  if (!createSnapshotStore) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return createSnapshotStore({ defaultTtlMs: 60_000 });
}

type RowSpec = {
  fseiban: string;
  fhincd?: string;
  resourceCd?: string;
  processOrder?: string;
  productNo?: string;
  dueDate?: string;
  requiredMinutes?: string | null;
  plannedQuantity?: number | null;
  completed?: boolean;
  externallyCompleted?: boolean;
  rank?: number;
  splitQuantity?: number;
};

type Fixture = {
  prefix: string;
  siteKey: string;
  rowIds: string[];
  splitIds: string[];
  resourceNames: string[];
  sharedStateBefore: { id: string; csvDashboardId: string; location: string; state: Prisma.JsonValue } | null;
};

const fixtures: Fixture[] = [];

async function ensureDashboard(): Promise<void> {
  await db().csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    create: {
      id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      name: 'grinding-planning-board-integration',
      columnDefinitions: [],
      templateType: 'TABLE',
      templateConfig: {},
      ingestMode: 'DEDUP',
      dedupKeyColumns: ['FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'],
      enabled: true
    },
    update: {}
  });
}

async function createFixture(): Promise<Fixture> {
  const prefix = `grinding-board-it-${randomUUID()}`;
  const sharedState = await db().kioskProductionScheduleSearchState.findUnique({
    where: { csvDashboardId_location: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared' } }
  });
  const fixture: Fixture = {
    prefix,
    siteKey: `${prefix}-site`,
    rowIds: [],
    splitIds: [],
    resourceNames: [`${prefix}-305`, `${prefix}-581`, `${prefix}-1`],
    sharedStateBefore: sharedState
      ? { id: sharedState.id, csvDashboardId: sharedState.csvDashboardId, location: sharedState.location, state: sharedState.state }
      : null
  };
  await db().productionScheduleResourceMaster.createMany({
    data: [
      { resourceCd: '305', resourceName: fixture.resourceNames[0]!, resourceClassCd: 'M02', resourceGroupCd: 'IT' },
      { resourceCd: '581', resourceName: fixture.resourceNames[1]!, resourceClassCd: 'M02', resourceGroupCd: 'IT' },
      { resourceCd: '1', resourceName: fixture.resourceNames[2]!, resourceClassCd: 'M02', resourceGroupCd: 'IT' }
    ]
  });
  fixtures.push(fixture);
  return fixture;
}

function rowData(spec: RowSpec, index: number): Record<string, string> {
  return {
    FSEIBAN: spec.fseiban,
    FHINCD: spec.fhincd ?? `PART-${index}`,
    FSIGENCD: spec.resourceCd ?? '305',
    FKOJUN: spec.processOrder ?? String(index + 1),
    ProductNo: spec.productNo ?? String(index + 1),
    FHINMEI: 'integration part',
    FSIGENSHOYORYO: spec.requiredMinutes === undefined ? '30' : spec.requiredMinutes ?? ''
  };
}

async function addRows(fixture: Fixture, specs: readonly RowSpec[]): Promise<string[]> {
  const rows: Array<{ id: string; data: Record<string, string>; spec: RowSpec }> = [];
  for (const [index, spec] of specs.entries()) {
    const data = rowData(spec, index);
    const row = await db().csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date('2026-09-09T00:00:00.000Z'),
        dataHash: `${fixture.prefix}-${index}-${randomUUID()}`,
        rowData: data
      },
      select: { id: true }
    });
    rows.push({ id: row.id, data, spec });
    fixture.rowIds.push(row.id);
  }

  if (rows.length > 0) {
    await db().productionScheduleOrderSupplement.createMany({
      data: rows.map(({ id, data, spec }) => ({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: id,
        // The production table allows the same numeric ProductNo to recur in
        // different source imports. Keep parallel fixtures independent from
        // the source-import uniqueness key without changing winner identity.
        sourceCsvDashboardId: fixture.prefix,
        productNo: data.ProductNo!,
        resourceCd: data.FSIGENCD!,
        processOrder: data.FKOJUN!,
        plannedQuantity: spec.plannedQuantity === undefined ? 5 : spec.plannedQuantity,
        plannedEndDate: new Date(`${spec.dueDate ?? '2026-09-20'}T00:00:00.000Z`)
      }))
    });
    await db().productionScheduleRowNote.createMany({
      data: rows.map(({ id, spec }) => ({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: id,
        note: 'integration fixture',
        dueDate: new Date(`${spec.dueDate ?? '2026-09-20'}T00:00:00.000Z`)
      }))
    });

    // Each isolated fixture needs a registered seiban order so the planning
    // board exercises its normal shared-history seed path. Restore the exact
    // pre-fixture shared row during cleanup below.
    const historyRows = await Promise.all(fixture.rowIds.map((id) => db().csvDashboardRow.findUniqueOrThrow({ where: { id }, select: { rowData: true } })));
    const history = historyRows.map((row) => String((row.rowData as Record<string, unknown>).FSEIBAN ?? '')).filter(Boolean);
    await db().kioskProductionScheduleSearchState.upsert({
      where: { csvDashboardId_location: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared' } },
      create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared', state: { history } },
      update: { state: { history } }
    });
  }

  for (const { id, data, spec } of rows) {
    if (spec.rank !== undefined) {
      await db().productionScheduleOrderAssignment.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          csvDashboardRowId: id,
          location: fixture.siteKey,
          siteKey: fixture.siteKey,
          resourceCd: data.FSIGENCD!,
          orderNumber: spec.rank
        }
      });
    }
    if (spec.completed) {
      await db().productionScheduleProgress.create({
        data: { csvDashboardRowId: id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, isCompleted: true }
      });
    }
    if (spec.externallyCompleted) {
      await db().productionScheduleExternalCompletion.create({
        data: { csvDashboardRowId: id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, isExternallyCompleted: true }
      });
    }
    if (spec.splitQuantity !== undefined) {
      const split = await db().productionScheduleOrderSplit.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          parentCsvDashboardRowId: id,
          splitNo: 1,
          splitQuantity: spec.splitQuantity,
          dueDate: new Date(`${spec.dueDate ?? '2026-09-20'}T00:00:00.000Z`)
        },
        select: { id: true }
      });
      fixture.splitIds.push(split.id);
    }
  }
  return rows.map(({ id }) => id);
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  await db().productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { siteKey: fixture.siteKey } });
  await db().productionScheduleGrindingPlanningBoardState.deleteMany({ where: { siteKey: fixture.siteKey } });
  if (fixture.splitIds.length > 0) {
    await db().productionScheduleOrderSplitAssignment.deleteMany({ where: { splitId: { in: fixture.splitIds } } });
    await db().productionScheduleOrderSplit.deleteMany({ where: { id: { in: fixture.splitIds } } });
  }
  if (fixture.rowIds.length > 0) {
    const where = { csvDashboardRowId: { in: fixture.rowIds } };
    await db().productionScheduleProgress.deleteMany({ where });
    await db().productionScheduleExternalCompletion.deleteMany({ where });
    await db().productionScheduleRowNote.deleteMany({ where });
    await db().productionScheduleOrderSupplement.deleteMany({ where });
    await db().productionScheduleOrderAssignment.deleteMany({ where });
    await db().csvDashboardRow.deleteMany({ where: { id: { in: fixture.rowIds } } });
  }
  await db().kioskProductionScheduleSearchState.deleteMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: fixture.siteKey }
  });
  await db().productionScheduleResourceMaster.deleteMany({ where: { resourceName: { in: fixture.resourceNames } } });
  if (fixture.sharedStateBefore) {
    await db().kioskProductionScheduleSearchState.upsert({
      where: { id: fixture.sharedStateBefore.id },
      create: fixture.sharedStateBefore,
      update: { state: fixture.sharedStateBefore.state }
    });
  } else {
    await db().kioskProductionScheduleSearchState.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared' }
    });
  }
}

function boardItem(response: GrindingPlanningBoardResponse, predicate: (item: GrindingPlanningBoardItem) => boolean): GrindingPlanningBoardItem {
  const item = response.items.find(predicate);
  if (!item) throw new Error(`fixture item not found in board response: ${JSON.stringify(response.items)}`);
  return item;
}

async function boardFor(fixture: Fixture, options: Partial<Parameters<BoardService['getGrindingPlanningBoard']>[0]> = {}): Promise<GrindingPlanningBoardResponse> {
  return service().getGrindingPlanningBoard({
    siteKey: fixture.siteKey,
    category: 'grinding',
    view: 'seiban',
    pageSize: 160,
    ...options
  });
}

async function updateItem(fixture: Fixture, item: GrindingPlanningBoardItem, options: { resourceCd?: string | null; due?: { kind: 'date'; date: string } | { kind: 'offsetDays'; days: number } | { kind: 'restore' }; alternateRank?: number | null }, sourceRevision: string) {
  return service().updateGrindingPlanningBoardOverrides({
    siteKey: fixture.siteKey,
    sourceRevision,
    items: [{ itemId: item.itemId, itemRevision: item.itemRevision, ...options }]
  });
}

describeIntegration('grinding planning board service real Postgres integration', () => {
  beforeEach(async () => {
    await ensureDashboard();
  });

  afterEach(async () => {
    while (fixtures.length > 0) {
      const fixture = fixtures.pop();
      if (fixture) await cleanupFixture(fixture);
    }
  });

  afterAll(async () => {
    await dbClient?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('seeds the site order from shared history once and keeps later site order isolated', async () => {
    const fixture = await createFixture();
    await addRows(fixture, [
      { fseiban: `${fixture.prefix}-A`, fhincd: 'PART-A', processOrder: '1', productNo: '1' },
      { fseiban: `${fixture.prefix}-B`, fhincd: 'PART-B', processOrder: '1', productNo: '2' }
    ]);
    const oldShared = await db().kioskProductionScheduleSearchState.findUnique({
      where: { csvDashboardId_location: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared' } }
    });
    const sharedHistory = [`${fixture.prefix}-B`, `${fixture.prefix}-A`];
    try {
      await db().kioskProductionScheduleSearchState.upsert({
        where: { csvDashboardId_location: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared' } },
        create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared', state: { history: sharedHistory } },
        update: { state: { history: sharedHistory } }
      });
      const first = await boardFor(fixture);
      expect(first.registeredFseibans.slice(0, 2)).toEqual(sharedHistory);
      const reordered = await service().updateGrindingPlanningBoardSeibanOrder({
        siteKey: fixture.siteKey,
        sourceRevision: first.sourceRevision,
        fseibans: [sharedHistory[1]!, sharedHistory[0]!]
      });
      expect(reordered.seibanOrder).toEqual([sharedHistory[1]!, sharedHistory[0]!]);

      const secondSite = { ...fixture, siteKey: `${fixture.prefix}-other-site` };
      const second = await boardFor(secondSite);
      expect(second.registeredFseibans.slice(0, 2)).toEqual(sharedHistory);
      expect((await db().productionScheduleGrindingPlanningBoardState.findUnique({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: fixture.siteKey } } }))?.seibanOrder).toEqual([sharedHistory[1]!, sharedHistory[0]!]);
      expect((await db().productionScheduleGrindingPlanningBoardState.findUnique({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: secondSite.siteKey } } }))?.seibanOrder).toEqual(sharedHistory);
      await db().productionScheduleGrindingPlanningBoardState.deleteMany({ where: { siteKey: secondSite.siteKey } });
    } finally {
      if (oldShared) {
        await db().kioskProductionScheduleSearchState.upsert({
          where: { id: oldShared.id },
          create: { id: oldShared.id, csvDashboardId: oldShared.csvDashboardId, location: oldShared.location, state: oldShared.state },
          update: { state: oldShared.state }
        });
      } else {
        await db().kioskProductionScheduleSearchState.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared' } });
      }
    }
  });

  it('retrieves all 400 items from one snapshot and rejects wrong-site or changed-filter cursors', async () => {
    const fixture = await createFixture();
    await addRows(fixture, Array.from({ length: 400 }, (_, index) => ({
      fseiban: `${fixture.prefix}-400`,
      fhincd: `PART-${index}`,
      processOrder: String(index + 1),
      productNo: String(index + 1)
    })));
    const store = snapshotStore();
    const hydrateModule = await import('../leaderboard/leaderboard-shell-hydrate.service.js');
    const hydrateSpy = vi.spyOn(hydrateModule, 'fetchLeaderboardScheduleHydratedRowsOrderedByIds');
    const first = await boardFor(fixture, { snapshotStore: store });
    const all = [...first.items];
    let cursor = first.nextCursor;
    const hydrationCallsAfterFirstPage = hydrateSpy.mock.calls.length;
    expect(hydrationCallsAfterFirstPage).toBeGreaterThan(0);
    hydrateSpy.mockImplementation(async () => {
      throw new Error('continuation must use the stored snapshot payload');
    });
    while (cursor != null) {
      const page = await boardFor(fixture, { cursor: Number(cursor), snapshotId: first.snapshotId, snapshotStore: store });
      all.push(...page.items);
      cursor = page.nextCursor;
    }
    expect(hydrateSpy.mock.calls.length).toBe(hydrationCallsAfterFirstPage);
    hydrateSpy.mockRestore();
    expect(all).toHaveLength(400);
    expect(new Set(all.map((item) => item.itemId)).size).toBe(400);
    await expect(boardFor({ ...fixture, siteKey: `${fixture.siteKey}-wrong` }, { cursor: 160, snapshotId: first.snapshotId, snapshotStore: store })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    await expect(boardFor(fixture, { category: 'cutting', cursor: 0, snapshotId: first.snapshotId, snapshotStore: store })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
  });

  it('invalidates a snapshot and refreshes the item after an in-place CSV rowData update', async () => {
    const fixture = await createFixture();
    const [updatedRow] = await addRows(fixture, [
      { fseiban: `${fixture.prefix}-IN-PLACE`, fhincd: 'PART-1', processOrder: '1', productNo: '1' },
      { fseiban: `${fixture.prefix}-IN-PLACE`, fhincd: 'PART-2', processOrder: '2', productNo: '2' }
    ]);
    const store = snapshotStore();
    const first = await boardFor(fixture, { pageSize: 1, snapshotStore: store });
    expect(first.nextCursor).toBe('1');
    const before = await db().csvDashboardRow.findUniqueOrThrow({ where: { id: updatedRow }, select: { createdAt: true, rowData: true } });
    const rowCountBefore = await db().csvDashboardRow.count({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } });
    await db().csvDashboardRow.update({
      where: { id: updatedRow },
      data: {
        rowData: { ...(before.rowData as Record<string, unknown>), FHINMEI: 'updated in place' },
        updatedAt: new Date('2026-09-10T00:00:00.000Z')
      }
    });
    const after = await db().csvDashboardRow.findUniqueOrThrow({ where: { id: updatedRow }, select: { createdAt: true, rowData: true } });
    expect(after.createdAt).toEqual(before.createdAt);
    expect(await db().csvDashboardRow.count({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID } })).toBe(rowCountBefore);

    await expect(boardFor(fixture, { cursor: 1, snapshotId: first.snapshotId, snapshotStore: store, pageSize: 1 })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
    const refreshed = await boardFor(fixture, { pageSize: 1, snapshotStore: store });
    expect(boardItem(refreshed, (item) => item.sourceRowId === updatedRow).fhinmei).toBe('updated in place');
  });

  it('rejects a continuation after the board state changes', async () => {
    const fixture = await createFixture();
    await addRows(fixture, [
      { fseiban: `${fixture.prefix}-STATE`, processOrder: '1', productNo: '1' },
      { fseiban: `${fixture.prefix}-STATE`, processOrder: '2', productNo: '2' }
    ]);
    const store = snapshotStore();
    const first = await boardFor(fixture, { pageSize: 1, snapshotStore: store });
    expect(first.nextCursor).toBe('1');
    const state = await db().productionScheduleGrindingPlanningBoardState.findUniqueOrThrow({
      where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: fixture.siteKey } },
      select: { id: true, version: true }
    });
    await db().productionScheduleGrindingPlanningBoardState.update({
      where: { id: state.id },
      data: { version: state.version + 1 }
    });

    await expect(boardFor(fixture, { cursor: 1, snapshotId: first.snapshotId, snapshotStore: store, pageSize: 1 })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
  });

  it('rejects a continuation after an override changes', async () => {
    const fixture = await createFixture();
    await addRows(fixture, [
      { fseiban: `${fixture.prefix}-OVERRIDE`, processOrder: '1', productNo: '1' },
      { fseiban: `${fixture.prefix}-OVERRIDE`, processOrder: '2', productNo: '2' }
    ]);
    const store = snapshotStore();
    const first = await boardFor(fixture, { pageSize: 1, snapshotStore: store });
    expect(first.nextCursor).toBe('1');
    const item = first.items[0];
    if (!item) throw new Error('fixture item not found');
    await updateItem(fixture, item, { resourceCd: '581' }, first.sourceRevision);

    await expect(boardFor(fixture, { cursor: 1, snapshotId: first.snapshotId, snapshotStore: store, pageSize: 1 })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_SNAPSHOT' });
  });

  it('keeps registered items scoped while load includes an unregistered seiban', async () => {
    const fixture = await createFixture();
    await addRows(fixture, [
      { fseiban: `${fixture.prefix}-REGISTERED`, fhincd: 'PART-REGISTERED', processOrder: '1', productNo: '1', requiredMinutes: '10' },
      { fseiban: `${fixture.prefix}-UNREGISTERED`, fhincd: 'PART-UNREGISTERED', processOrder: '1', productNo: '2', requiredMinutes: '20' }
    ]);
    await db().kioskProductionScheduleSearchState.update({
      where: { csvDashboardId_location: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared' } },
      data: { state: { history: [`${fixture.prefix}-REGISTERED`] } }
    });

    const response = await boardFor(fixture);
    expect(response.registeredFseibans).toEqual([`${fixture.prefix}-REGISTERED`]);
    expect(response.items.map((item) => item.fseiban)).toEqual([`${fixture.prefix}-REGISTERED`]);
    const resourceLoad = response.load.find((entry) => entry.resourceCd === '305');
    expect(resourceLoad).toMatchObject({
      originalItemCount: 2,
      alternateItemCount: 2,
      originalRequiredMinutes: 30,
      alternateRequiredMinutes: 30,
      unfinishedItemCount: 2
    });
  });

  it('counts every registered process in progress and caps the copied seiban order at 50', async () => {
    const progressFixture = await createFixture();
    await addRows(progressFixture, [
      { fseiban: `${progressFixture.prefix}-PROGRESS`, fhincd: 'PART-PROGRESS', resourceCd: '305', processOrder: '1', productNo: '1', completed: true },
      { fseiban: `${progressFixture.prefix}-PROGRESS`, fhincd: 'PART-PROGRESS', resourceCd: '1', processOrder: '2', productNo: '1' }
    ]);
    const progressResponse = await boardFor(progressFixture);
    expect(progressResponse.items).toHaveLength(1);
    expect(progressResponse.seibanProgress[`${progressFixture.prefix}-PROGRESS`]).toEqual({ completed: 1, total: 2 });

    const cappedFixture = await createFixture();
    await addRows(cappedFixture, Array.from({ length: 52 }, (_, index) => ({
      fseiban: `${cappedFixture.prefix}-${String(index + 1).padStart(2, '0')}`,
      fhincd: `PART-${index + 1}`,
      processOrder: '1',
      productNo: String(index + 1),
      requiredMinutes: '1'
    })));
    const cappedResponse = await boardFor(cappedFixture);
    expect(cappedResponse.registeredFseibans).toHaveLength(50);
    expect(cappedResponse.items).toHaveLength(50);
    expect(cappedResponse.load.find((entry) => entry.resourceCd === '305')).toMatchObject({
      originalItemCount: 52,
      alternateItemCount: 52,
      originalRequiredMinutes: 52,
      alternateRequiredMinutes: 52
    });
  });

  it('applies resource and due together, clears rank, preserves originals, and makes a true no-op', async () => {
    const fixture = await createFixture();
    const [rowId] = await addRows(fixture, [{ fseiban: `${fixture.prefix}-BULK`, rank: 3, dueDate: '2026-09-20' }]);
    await db().productionScheduleProgress.create({
      data: { csvDashboardRowId: rowId, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, isCompleted: false }
    });
    await db().kioskProductionScheduleSearchState.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: fixture.siteKey,
        state: { history: [`${fixture.prefix}-BULK`] }
      }
    });
    const before = await Promise.all([
      db().csvDashboardRow.findUniqueOrThrow({ where: { id: rowId }, select: { rowData: true, updatedAt: true } }),
      db().productionScheduleRowNote.findUniqueOrThrow({ where: { csvDashboardRowId: rowId }, select: { dueDate: true, note: true } }),
      db().productionScheduleOrderAssignment.findFirstOrThrow({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: fixture.siteKey, resourceCd: '305' }, select: { orderNumber: true, resourceCd: true } }),
      db().productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: rowId }, select: { plannedQuantity: true, plannedEndDate: true, resourceCd: true, processOrder: true } }),
      db().productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: rowId }, select: { isCompleted: true, updatedAt: true } }),
      db().kioskProductionScheduleSearchState.findUniqueOrThrow({ where: { csvDashboardId_location: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: fixture.siteKey } }, select: { state: true, updatedAt: true } }),
      db().productionScheduleResourceMaster.findMany({ where: { resourceName: { in: fixture.resourceNames } }, orderBy: { resourceName: 'asc' }, select: { resourceCd: true, resourceName: true, resourceClassCd: true, resourceGroupCd: true } })
    ]);
    const initial = await boardFor(fixture);
    const item = boardItem(initial, (candidate) => candidate.sourceRowId === rowId);
    expect(item.originalRank).toBe(3);
    await updateItem(fixture, item, { alternateRank: 4 }, initial.sourceRevision);
    const ranked = await boardFor(fixture);
    const rankedItem = boardItem(ranked, (candidate) => candidate.sourceRowId === rowId);
    expect(rankedItem.alternateRank).toBe(4);

    await updateItem(fixture, rankedItem, { resourceCd: '581', due: { kind: 'offsetDays', days: 2 } }, ranked.sourceRevision);
    const changed = await boardFor(fixture);
    const changedItem = boardItem(changed, (candidate) => candidate.sourceRowId === rowId);
    expect(changedItem.effectiveResourceCd).toBe('581');
    expect(changedItem.effectiveDueDate).toBe('2026-09-22');
    expect(changedItem.alternateRank).toBeNull();
    const override = await db().productionScheduleGrindingPlanningBoardOverride.findUniqueOrThrow({ where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: fixture.siteKey, itemKey: changedItem.itemId } } });
    const versionBeforeNoop = override.version;

    await updateItem(fixture, changedItem, { resourceCd: '581', due: { kind: 'date', date: '2026-09-22' } }, changed.sourceRevision);
    const afterNoop = await db().productionScheduleGrindingPlanningBoardOverride.findUniqueOrThrow({ where: { id: override.id } });
    expect(afterNoop.version).toBe(versionBeforeNoop);
    expect(await Promise.all([
      db().csvDashboardRow.findUniqueOrThrow({ where: { id: rowId }, select: { rowData: true, updatedAt: true } }),
      db().productionScheduleRowNote.findUniqueOrThrow({ where: { csvDashboardRowId: rowId }, select: { dueDate: true, note: true } }),
      db().productionScheduleOrderAssignment.findFirstOrThrow({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: fixture.siteKey, resourceCd: '305' }, select: { orderNumber: true, resourceCd: true } }),
      db().productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: rowId }, select: { plannedQuantity: true, plannedEndDate: true, resourceCd: true, processOrder: true } }),
      db().productionScheduleProgress.findUniqueOrThrow({ where: { csvDashboardRowId: rowId }, select: { isCompleted: true, updatedAt: true } }),
      db().kioskProductionScheduleSearchState.findUniqueOrThrow({ where: { csvDashboardId_location: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: fixture.siteKey } }, select: { state: true, updatedAt: true } }),
      db().productionScheduleResourceMaster.findMany({ where: { resourceName: { in: fixture.resourceNames } }, orderBy: { resourceName: 'asc' }, select: { resourceCd: true, resourceName: true, resourceClassCd: true, resourceGroupCd: true } })
    ])).toEqual(before);
  });

  it('rejects completed and externally completed items without writing overrides', async () => {
    const fixture = await createFixture();
    const [completedRow, externalRow] = await addRows(fixture, [
      { fseiban: `${fixture.prefix}-DONE`, completed: true, processOrder: '1' },
      { fseiban: `${fixture.prefix}-EXTERNAL`, externallyCompleted: true, processOrder: '2' }
    ]);
    const response = await boardFor(fixture);
    for (const rowId of [completedRow, externalRow]) {
      const item = boardItem(response, (candidate) => candidate.sourceRowId === rowId);
      expect(item.isCompleted).toBe(true);
      await expect(updateItem(fixture, item, { resourceCd: '581' }, response.sourceRevision)).rejects.toMatchObject({ code: 'COMPLETED_ITEM' });
    }
    expect(await db().productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: fixture.siteKey } })).toBe(0);
  });

  it('rolls back the entire bulk mutation when one item revision is stale', async () => {
    const fixture = await createFixture();
    const [firstRow, secondRow] = await addRows(fixture, [
      { fseiban: `${fixture.prefix}-STALE`, processOrder: '1' },
      { fseiban: `${fixture.prefix}-STALE`, processOrder: '2' }
    ]);
    const response = await boardFor(fixture);
    const first = boardItem(response, (item) => item.sourceRowId === firstRow);
    const second = boardItem(response, (item) => item.sourceRowId === secondRow);
    const current = await db().csvDashboardRow.findUniqueOrThrow({ where: { id: secondRow }, select: { rowData: true } });
    await db().csvDashboardRow.update({ where: { id: secondRow }, data: { rowData: { ...(current.rowData as Record<string, unknown>), FHINMEI: 'stale fixture update' } } });
    await expect(service().updateGrindingPlanningBoardOverrides({
      siteKey: fixture.siteKey,
      sourceRevision: response.sourceRevision,
      items: [
        { itemId: first.itemId, itemRevision: first.itemRevision, resourceCd: '581' },
        { itemId: second.itemId, itemRevision: second.itemRevision, resourceCd: '581' }
      ]
    })).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_ITEM' });
    expect(await db().productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: fixture.siteKey } })).toBe(0);
  });

  it('serializes the same item to one success and one conflict, while distinct items both succeed', async () => {
    const fixture = await createFixture();
    const [sameRow] = await addRows(fixture, [{ fseiban: `${fixture.prefix}-CONCURRENT`, processOrder: '1' }]);
    const initial = await boardFor(fixture);
    const same = boardItem(initial, (item) => item.sourceRowId === sameRow);
    const concurrentSame = await Promise.allSettled([
      updateItem(fixture, same, { resourceCd: '581' }, initial.sourceRevision),
      updateItem(fixture, same, { resourceCd: '581' }, initial.sourceRevision)
    ]);
    expect(concurrentSame.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(concurrentSame.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const separateFixture = await createFixture();
    const [firstRow, secondRow] = await addRows(separateFixture, [
      { fseiban: `${separateFixture.prefix}-CONCURRENT`, processOrder: '1' },
      { fseiban: `${separateFixture.prefix}-CONCURRENT`, processOrder: '2' }
    ]);
    const separate = await boardFor(separateFixture);
    const first = boardItem(separate, (item) => item.sourceRowId === firstRow);
    const second = boardItem(separate, (item) => item.sourceRowId === secondRow);
    const concurrentDifferent = await Promise.allSettled([
      updateItem(separateFixture, first, { resourceCd: '581' }, separate.sourceRevision),
      updateItem(separateFixture, second, { resourceCd: '581' }, separate.sourceRevision)
    ]);
    expect(concurrentDifferent.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await db().productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: separateFixture.siteKey } })).toBe(2);
  });

  it('keeps an override on a same-logical-key winner, rejects deleted splits, and does not inherit parent overrides', async () => {
    const fixture = await createFixture();
    const [oldRow] = await addRows(fixture, [{ fseiban: `${fixture.prefix}-WINNER`, fhincd: 'PART-W', processOrder: '1', productNo: '1' }]);
    const first = await boardFor(fixture);
    const oldItem = boardItem(first, (item) => item.sourceRowId === oldRow);
    await updateItem(fixture, oldItem, { resourceCd: '581' }, first.sourceRevision);
    const [newRow] = await addRows(fixture, [{ fseiban: `${fixture.prefix}-WINNER`, fhincd: 'PART-W', processOrder: '1', productNo: '2' }]);
    const afterWinner = await boardFor(fixture);
    const winnerItem = boardItem(afterWinner, (item) => item.fseiban === `${fixture.prefix}-WINNER`);
    expect(winnerItem.sourceRowId).toBe(newRow);
    expect(winnerItem.itemId).toBe(oldItem.itemId);
    expect(winnerItem.effectiveResourceCd).toBe('581');
    await db().productionScheduleRowNote.deleteMany({ where: { csvDashboardRowId: oldRow } });
    await db().productionScheduleOrderSupplement.deleteMany({ where: { csvDashboardRowId: oldRow } });
    await db().productionScheduleOrderAssignment.deleteMany({ where: { csvDashboardRowId: oldRow } });
    await db().csvDashboardRow.delete({ where: { id: oldRow } });
    const afterOldWinnerDelete = await boardFor(fixture);
    expect(boardItem(afterOldWinnerDelete, (item) => item.fseiban === `${fixture.prefix}-WINNER`)).toMatchObject({ sourceRowId: newRow, itemId: oldItem.itemId, effectiveResourceCd: '581' });

    const splitFixture = await createFixture();
    const [parentRow] = await addRows(splitFixture, [{ fseiban: `${splitFixture.prefix}-SPLIT`, splitQuantity: 2 }]);
    const previousSplitFlag = process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;
    vi.stubEnv('KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED', 'true');
    try {
      const withSplit = await boardFor(splitFixture);
      const parent = boardItem(withSplit, (item) => item.sourceRowId === parentRow);
      expect(parent.kind).toBe('split');
      expect(parent.effectiveResourceCd).toBe(parent.originalResourceCd);
      await expect(updateItem(splitFixture, parent, { resourceCd: '581' }, withSplit.sourceRevision)).resolves.toBeDefined();

      vi.stubEnv('KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED', 'false');
      const splitOff = await boardFor(splitFixture);
      const parentWhenOff = boardItem(splitOff, (item) => item.sourceRowId === parentRow);
      expect(parentWhenOff.kind).toBe('row');
      expect(parentWhenOff.effectiveResourceCd).toBe(parentWhenOff.originalResourceCd);

      vi.stubEnv('KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED', 'true');
      const splitId = splitFixture.splitIds[0]!;
      await db().productionScheduleOrderSplit.delete({ where: { id: splitId } });
      await expect(updateItem(splitFixture, parent, { resourceCd: '581' }, withSplit.sourceRevision)).rejects.toMatchObject({ code: 'STALE_PLANNING_BOARD_ITEM' });
    } finally {
      if (previousSplitFlag === undefined) vi.unstubAllEnvs();
      else vi.stubEnv('KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED', previousSplitFlag);
    }
  });
});
