import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

// Keep the shared-DB guard identical to grinding-planning-board.integration.test.ts.
// There is deliberately no DATABASE_URL or localhost fallback.
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
type TestBarService = typeof import('../grinding-planning-board/test-bars.js');

let dbClient: PrismaClient | undefined;
let boardService: BoardService | undefined;
let testBarService: TestBarService | undefined;
let queryCount = 0;

if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  // Use the production adapter/pool configuration, enabling query events only
  // for this file. All service imports receive this same instrumented client.
  vi.doMock('../../../lib/prisma.js', async () => {
    const { PrismaClient } = await import('@prisma/client');
    const { PrismaPg } = await import('@prisma/adapter-pg');
    const { postgresPoolConfig } = await import('../../../lib/postgres-url-params.js');
    const prisma = new PrismaClient({
      adapter: new PrismaPg(postgresPoolConfig(testDatabaseUrl)),
      log: [{ emit: 'event', level: 'query' }]
    });
    prisma.$on('query', () => { queryCount += 1; });
    return { prisma };
  });
  ({ prisma: dbClient } = await import('../../../lib/prisma.js'));
  boardService = await import('../grinding-planning-board.service.js');
  testBarService = await import('../grinding-planning-board/test-bars.js');
}

const describeIntegration = hasDedicatedDatabase ? describe : describe.skip;

describeIntegration('planning board test bar performance (dedicated Postgres only)', () => {
  afterAll(async () => {
    await dbClient?.$disconnect();
    vi.doUnmock('../../../lib/prisma.js');
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('measures create/delete/restore/complete three times on a 40-seiban, 400-row board', async () => {
    if (!dbClient || !boardService || !testBarService) {
      throw new Error('TEST_DATABASE_URL must point to a dedicated database');
    }
    const db = dbClient;
    const api = testBarService;
    const prefix = `tb-perf-${randomUUID()}`;
    const siteKey = `${prefix}-site`;
    const resourceCds = ['305', '700']; // grinding and cutting
    const resourceNames = resourceCds.map((cd) => `${prefix}-${cd}`);
    const seibans = Array.from({ length: 40 }, (_, index) => `${prefix}-${index}`);
    const rows = seibans.flatMap((fseiban, seibanIndex) => Array.from({ length: 10 }, (_, index) => ({
      id: randomUUID(),
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date('2026-09-09T00:00:00.000Z'),
      dataHash: `${prefix}-${seibanIndex}-${index}`,
      rowData: {
        FSEIBAN: fseiban,
        FHINCD: `PART-${index}`,
        FSIGENCD: resourceCds[index % 2]!,
        FKOJUN: String(index + 1),
        ProductNo: String(seibanIndex * 10 + index + 1),
        FHINMEI: 'performance fixture part',
        FSIGENSHOYORYO: '30'
      }
    })));
    const rowWhere = { csvDashboardRowId: { in: rows.map((row) => row.id) } };
    const sharedWhere = {
      csvDashboardId_location: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared' }
    };
    const sharedStateBefore = await db.kioskProductionScheduleSearchState.findUnique({ where: sharedWhere });
    const readBoard = () => boardService!.getGrindingPlanningBoard({
      siteKey, category: 'all', view: 'resource', includePieces: true, pageSize: 640
    });
    async function measure<T>(op: string, run: () => Promise<T>): Promise<T> {
      const beforeQueries = queryCount;
      const started = performance.now();
      try {
        return await run();
      } finally {
        console.log(`[tb-perf] op=${op} ms=${(performance.now() - started).toFixed(2)} queries=${queryCount - beforeQueries}`);
      }
    }
    function expectContiguousLane(board: Awaited<ReturnType<typeof readBoard>>) {
      const lane = api.mixedPlanningLane(board.items, board.testBars ?? [], board.seibanOrder, '305');
      expect(lane).toHaveLength(201);
      // Fixtures have no special due dates: all 201 bars share one rank band.
      expect(lane.map((item) => item.alternateRank)).toEqual(Array.from({ length: 201 }, (_, index) => index + 1));
      return lane;
    }

    try {
      await db.csvDashboard.upsert({
        where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
        create: {
          id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: 'planning-board-test-bars-perf',
          columnDefinitions: [], templateType: 'TABLE', templateConfig: {},
          ingestMode: 'DEDUP', dedupKeyColumns: ['FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'], enabled: true
        },
        update: {}
      });
      await db.productionScheduleResourceMaster.createMany({
        data: resourceCds.map((resourceCd, index) => ({
          resourceCd, resourceName: resourceNames[index]!, resourceClassCd: 'M02', resourceGroupCd: 'IT'
        }))
      });
      await db.csvDashboardRow.createMany({ data: rows });
      await db.productionScheduleOrderSupplement.createMany({
        data: rows.map((row) => ({
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: row.id,
          sourceCsvDashboardId: prefix, productNo: row.rowData.ProductNo,
          resourceCd: row.rowData.FSIGENCD, processOrder: row.rowData.FKOJUN,
          plannedQuantity: 5, plannedEndDate: new Date('2026-09-20T00:00:00.000Z')
        }))
      });
      await db.productionScheduleRowNote.createMany({
        data: rows.map((row) => ({
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: row.id,
          note: 'performance fixture', dueDate: new Date('2026-09-20T00:00:00.000Z')
        }))
      });
      await db.kioskProductionScheduleSearchState.upsert({
        where: sharedWhere,
        create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: 'shared', state: { history: seibans } },
        update: { state: { history: seibans } }
      });

      let board = await readBoard();
      expect(board.seibanOrder).toEqual(seibans);
      expect(board.items).toHaveLength(400);
      expect(new Set(board.items.map((item) => item.fseiban)).size).toBe(40);
      expect(board.testBars ?? []).toEqual([]);
      for (let sample = 0; sample < 3; sample += 1) {
        const previousCount = board.testBars?.length ?? 0;
        let result = await measure('create', () => api.createPlanningTestBar({
          siteKey, sourceRevision: board.sourceRevision, resourceCd: '305', minutes: 30
        }));
        const id = result.testBar.itemId;
        board = await readBoard();
        expect(board.testBars).toHaveLength(previousCount + 1);
        expect(expectContiguousLane(board)[0]?.itemId).toBe(id);

        for (const action of ['delete', 'restore', 'complete'] as const) {
          result = await measure(action, () => api.mutatePlanningTestBar({
            siteKey, id: id.slice(5), sourceRevision: board.sourceRevision,
            expectedVersion: result.testBar.version, action
          }));
          board = await readBoard();
          const visible = board.testBars?.find((item) => item.itemId === id);
          if (action === 'delete') {
            expect(visible).toBeUndefined();
            expect(board.testBars).toHaveLength(previousCount);
            expect(result.testBar.deletedAt).not.toBeNull();
          } else if (action === 'restore') {
            expect(visible).toMatchObject({ itemId: id, deletedAt: null, isCompleted: false });
            expect(board.testBars).toHaveLength(previousCount + 1);
            expect(expectContiguousLane(board)[0]?.itemId).toBe(id);
          } else {
            expect(visible).toMatchObject({ itemId: id, isCompleted: true });
            expect(visible?.completedAt).not.toBeNull();
          }
          // delete/complete retain tombstone ranks rather than compacting them.
          if (action !== 'restore') {
            const lane = api.mixedPlanningLane(board.items, board.testBars ?? [], board.seibanOrder, '305');
            expect(lane).toHaveLength(200);
            expect(lane.map((item) => item.itemId)).not.toContain(id);
          }
        }
      }
    } finally {
      await db.productionScheduleGrindingPlanningBoardTestBar.deleteMany({ where: { siteKey } });
      await db.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { siteKey } });
      await db.productionScheduleGrindingPlanningBoardState.deleteMany({ where: { siteKey } });
      await db.productionScheduleRowNote.deleteMany({ where: rowWhere });
      await db.productionScheduleOrderSupplement.deleteMany({ where: rowWhere });
      await db.csvDashboardRow.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
      await db.kioskProductionScheduleSearchState.deleteMany({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: siteKey }
      });
      await db.productionScheduleResourceMaster.deleteMany({ where: { resourceName: { in: resourceNames } } });
      if (sharedStateBefore) {
        const { Prisma } = await import('@prisma/client');
        const state = sharedStateBefore.state ?? Prisma.JsonNull;
        await db.kioskProductionScheduleSearchState.upsert({
          where: { id: sharedStateBefore.id }, create: { ...sharedStateBefore, state }, update: { state }
        });
      } else {
        await db.kioskProductionScheduleSearchState.deleteMany({ where: sharedWhere.csvDashboardId_location });
      }
    }
    // Twelve writes can each consume the service's existing 30s transaction
    // budget. Do not change that production timeout for this measurement.
  }, 480_000);
});
