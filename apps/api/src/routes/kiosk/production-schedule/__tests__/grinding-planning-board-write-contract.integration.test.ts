// 画面側だけの直しなので対象外（web のテストが守る）:
// 9031af96, f302a0f4, c55f9e9a, 611241d3, 78d41a3f.
import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '@prisma/client';
import type {
  GrindingPlanningBoardItem,
  GrindingPlanningBoardOverridesResponse,
  GrindingPlanningBoardResourceMinutesResponse,
  GrindingPlanningBoardResourcePartMinutesRequest,
  GrindingPlanningBoardResponse,
  GrindingPlanningBoardTestBarMutationResponse,
  SessakuPiecesMutationResponse
} from '@raspi-system/shared-types';
import type { KioskRouteDeps } from '../shared.js';

import { resolveLocationScopeContext } from '../../../../lib/location-scope-resolver.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID as dashboardId } from '../../../../services/production-schedule/constants.js';

// Same opt-in as the service integrations: never write to the default/shared DB.
const originalDatabaseUrl = process.env.DATABASE_URL;
const workerId = process.env.VITEST_POOL_ID;
const ciWorkerUrl = process.env.CI === 'true' && process.env.API_TEST_DB_PER_WORKER === '1'
  && /^[1-9]\d*$/.test(workerId ?? '') && process.env.DATABASE_URL
  && new URL(process.env.DATABASE_URL).pathname === `/borrow_return_w${workerId}`
  ? process.env.DATABASE_URL : undefined;
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() || ciWorkerUrl;
const hasDedicatedDatabase = Boolean(testDatabaseUrl)
  && !['/borrow_return', '/postgres', '/template1', '/'].includes(new URL(testDatabaseUrl!).pathname);
const describeDatabase = hasDedicatedDatabase ? describe : describe.skip;

let prisma: PrismaClient;
let registerBoard: typeof import('../grinding-planning-board.js').registerProductionScheduleGrindingPlanningBoardRoute;
let registerPieces: typeof import('../sessaku-pieces.js').registerSessakuPiecesRoutes;
let registerErrorHandler: typeof import('../../../../plugins/error-handler.js').registerErrorHandler;
let createStore: typeof import('../../../../services/production-schedule/leaderboard/leaderboard-shell-snapshot.store.js').createInMemoryLeaderboardShellSnapshotStore;
let rewarm: typeof import('../../../../services/production-schedule/grinding-planning-board.service.js').scheduleGrindingPlanningBoardRewarm;
if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  ({ prisma } = await import('../../../../lib/prisma.js'));
  ({ registerProductionScheduleGrindingPlanningBoardRoute: registerBoard } = await import('../grinding-planning-board.js'));
  ({ registerSessakuPiecesRoutes: registerPieces } = await import('../sessaku-pieces.js'));
  ({ registerErrorHandler } = await import('../../../../plugins/error-handler.js'));
  ({ createInMemoryLeaderboardShellSnapshotStore: createStore } = await import('../../../../services/production-schedule/leaderboard/leaderboard-shell-snapshot.store.js'));
  ({ scheduleGrindingPlanningBoardRewarm: rewarm } = await import('../../../../services/production-schedule/grinding-planning-board.service.js'));
}

const base = '/kiosk/production-schedule/grinding-planning-board';
let app: FastifyInstance | undefined;
let deps: KioskRouteDeps | undefined;
let site: string;
let seiban: string;
let part: string;
let rowIds: string[];

function request(method: 'GET' | 'PUT' | 'POST' | 'DELETE', suffix = '', payload?: object, terminal = 'A') {
  return app!.inject({ method, url: `${base}${suffix}`, headers: { 'x-client-key': terminal }, payload });
}

async function board(dueSource: 'excel' | 'scaw' = 'excel', includePieces = false, terminal = 'A') {
  const response = await request('GET', `?category=cutting&view=resource&includeLoad=false&includePieces=${includePieces}&dueSource=${dueSource}`, undefined, terminal);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<GrindingPlanningBoardResponse>();
}

function itemFor(boardValue: GrindingPlanningBoardResponse, rowId = rowIds[0]!): GrindingPlanningBoardItem {
  const item = boardValue.items.find((entry) => entry.sourceRowId === rowId);
  expect(item).toBeDefined();
  return item!;
}

async function minutes(terminal = 'A') {
  const response = await request('GET', '/resource-minutes', undefined, terminal);
  expect(response.statusCode, response.body).toBe(200);
  return response.json<GrindingPlanningBoardResourceMinutesResponse>();
}

async function saveMinutes(value: Omit<GrindingPlanningBoardResourcePartMinutesRequest, 'resourceCd' | 'fhincd'>, terminal = 'A') {
  return request('PUT', '/resource-minutes/value', { resourceCd: '1', fhincd: part, ...value }, terminal);
}

function expectConflict(response: { statusCode: number; body: string; json: () => unknown }, code: string) {
  expect(response.statusCode, response.body).toBe(409);
  expect(response.json()).toEqual({
    message: expect.any(String), errorCode: code, requestId: expect.any(String), timestamp: expect.any(String)
  });
  // Current API supplies no version/details in a 409; callers obtain them with GET.
}

describeDatabase('planning board HTTP write contract (real Postgres)', () => {
  beforeEach(async () => {
    deps = undefined;
    app = undefined;
    vi.stubEnv('SESSAKU_PIECES_CREATE_ENABLED', 'true');
    site = `write-contract-${randomUUID()}`;
    seiban = `WC${randomUUID().slice(0, 8)}`;
    part = `PART-${randomUUID()}`;
    rowIds = [];
    await prisma.csvDashboard.upsert({ where: { id: dashboardId },
      create: { id: dashboardId, name: 'write-contract', columnDefinitions: [], templateConfig: {} }, update: {} });
    for (const [index, fhincd] of [part, `${part}-sibling`].entries()) {
      const row = await prisma.csvDashboardRow.create({ data: {
        csvDashboardId: dashboardId, occurredAt: new Date('2026-11-10T00:00:00Z'), dataHash: `${site}-${index}`,
        rowData: { FSEIBAN: seiban, FHINCD: fhincd, FSIGENCD: '1', FKOJUN: '1', ProductNo: `${index + 1}`, FSIGENSHOYORYO: '100' }
      } });
      rowIds.push(row.id);
      await prisma.productionScheduleOrderSupplement.create({ data: {
        csvDashboardId: dashboardId, csvDashboardRowId: row.id, sourceCsvDashboardId: site,
        productNo: `${index + 1}`, resourceCd: '1', processOrder: '1', plannedQuantity: 5,
        plannedEndDate: new Date('2026-11-20T00:00:00Z')
      } });
    }
    await prisma.productionScheduleGrindingPlanningBoardState.create({ data: {
      csvDashboardId: dashboardId, siteKey: site, seibanOrder: [seiban]
    } });
    const run = await prisma.productionScheduleDScheduleMinutesImportRun.create({ data: {
      gmailMessageId: site, subject: 'write-contract', filename: 'fixture.xlsx',
      meetingDate: new Date('2026-11-10T00:00:00Z'), receivedAt: new Date('2026-11-10T00:00:00Z'),
      status: 'COMPLETED', warnings: [], autoRegisteredSeibans: []
    } });
    await prisma.productionScheduleDScheduleMinutes.create({ data: {
      csvDashboardId: dashboardId, fseiban: seiban, partsCompleteDate: new Date('2026-11-15T00:00:00Z'),
      excelChangedAt: new Date('2026-11-10T00:00:00Z'), outsourceMarks: [], surfaceSendOutDates: [],
      sourceRunId: run.id, sourceRow: 1
    } });
    // A and B use the real routes/services and share a site; only device authentication is supplied here.
    deps = {
      requireClientDevice: async (raw) => ({ clientKey: String(raw), clientDevice: {
        id: `write-contract-${raw}`, apiKey: String(raw), name: `terminal-${raw}`,
        location: `${site} - terminal-${raw}`, siteKey: site, statusClientId: null
      } }),
      resolveLocationScopeContext,
      resolveTargetLocation: ({ actorLocation }) => actorLocation,
      leaderboardShellSnapshotStore: createStore({ defaultTtlMs: 60000 })
    };
    app = Fastify();
    registerErrorHandler(app);
    await registerBoard(app, deps);
    await registerPieces(app, deps);
  });

  afterEach(async () => {
    try {
      try {
        await app?.close();
      } finally {
        if (app && deps) {
          // Drain the routes' asynchronous warm reads before removing this fixture.
          await rewarm({ siteKey: site, snapshotStore: deps.leaderboardShellSnapshotStore, delayMs: 0 });
        }
      }
    } finally {
      app = undefined;
      deps = undefined;
      const removals = [
        () => prisma.productionScheduleSessakuPieceAuditLog.deleteMany({ where: { fseiban: seiban } }),
        () => prisma.productionScheduleSessakuPieceSet.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } }),
        () => prisma.productionScheduleSessakuPieceHistory.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } }),
        () => prisma.productionScheduleGrindingPlanningBoardResourcePartMinutes.deleteMany({ where: { siteKey: site } }),
        () => prisma.productionScheduleGrindingPlanningBoardResourceMinutesSource.deleteMany({ where: { siteKey: site } }),
        () => prisma.productionScheduleGrindingPlanningBoardTestBar.deleteMany({ where: { siteKey: site } }),
        () => prisma.productionScheduleGrindingPlanningBoardArrival.deleteMany({ where: { siteKey: site } }),
        () => prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.deleteMany({ where: { siteKey: site } }),
        () => prisma.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { siteKey: site } }),
        () => prisma.productionScheduleGrindingPlanningBoardState.deleteMany({ where: { siteKey: site } }),
        () => prisma.productionScheduleResourceMaster.deleteMany({ where: { resourceName: site } }),
        () => prisma.productionScheduleDScheduleMinutes.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } }),
        () => prisma.productionScheduleDScheduleMinutesImportRun.deleteMany({ where: { gmailMessageId: site } }),
        () => prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } }),
      ];
      async function removeFixture(index = 0): Promise<void> {
        if (index === removals.length) return;
        try {
          await removals[index]!();
        } finally {
          await removeFixture(index + 1);
        }
      }
      try {
        await removeFixture();
      } finally {
        vi.unstubAllEnvs();
      }
    }
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('changes the arrival revision on inserts, updates and deletes in both arrival tables', async () => {
    const revision = async () => {
      const response = await request('GET', '/arrival-revision');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toEqual({ revision: expect.any(String) });
      return response.json<{ revision: string }>().revision;
    };
    const empty = await revision();
    const key = { csvDashboardId: dashboardId, siteKey: site, itemKey: 'row:arrival-fixture' };
    const regular = await prisma.productionScheduleGrindingPlanningBoardArrival.create({
      data: { ...key, arrivalDate: new Date('2026-11-25T00:00:00Z') }
    });
    const regularOnly = await revision();
    expect(regularOnly).not.toBe(empty);
    const firstProcess = await prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.create({
      data: { ...key, state: 'arrived', recordedAt: new Date('2026-11-25T00:00:00Z') }
    });
    const both = await revision();
    expect(both).not.toBe(regularOnly);
    await prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.update({
      where: { id: firstProcess.id }, data: { state: 'excluded' }
    });
    expect(await revision()).not.toBe(both);
    await prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.delete({ where: { id: firstProcess.id } });
    expect(await revision()).toBe(regularOnly);
    await prisma.productionScheduleGrindingPlanningBoardArrival.delete({ where: { id: regular.id } });
    expect(await revision()).toBe(empty);
  });

  it('a: rejects A\'s stale item after B saves, and GET retains B', async () => {
    const before = await board();
    const item = itemFor(before);
    const saved = await request('PUT', '/pins', { sourceRevision: before.sourceRevision,
      items: [{ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version }], pinned: true }, 'B');
    expect(saved.statusCode, saved.body).toBe(200);
    const acknowledged = saved.json<GrindingPlanningBoardOverridesResponse>();
    const stale = await request('PUT', '/overrides', { sourceRevision: before.sourceRevision,
      items: [{ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, due: { kind: 'date', date: '2026-11-25' } }] });
    expectConflict(stale, 'STALE_PLANNING_BOARD_ITEM');
    const latest = await board();
    expect(latest.sourceRevision).toBe(acknowledged.sourceRevision);
    expect(itemFor(latest)).toMatchObject({ itemRevision: acknowledged.items[0]!.itemRevision,
      version: acknowledged.items[0]!.version, orderPinned: true, effectiveDueDate: item.effectiveDueDate });
    expect(itemFor(latest).itemRevision).not.toBe(item.itemRevision);
  });

  it.each([{ dueSource: 'excel', fix: '' }, { dueSource: 'scaw', fix: ' (6c9dd60e)' }] as const)('b: $dueSource save and immediate board GET agree on revision and content$fix', async ({ dueSource }) => {
    const before = await board(dueSource);
    const item = itemFor(before);
    if (dueSource === 'scaw') {
      expect(item.originalDueDate).toBe('2026-11-20');
      expect(itemFor(await board('excel')).itemRevision).not.toBe(item.itemRevision);
    }
    const response = await request('PUT', '/pins', { dueSource, sourceRevision: before.sourceRevision,
      items: [{ itemId: item.itemId, itemRevision: item.itemRevision }], pinned: true });
    expect(response.statusCode, response.body).toBe(200);
    const saved = response.json<GrindingPlanningBoardOverridesResponse>();
    const after = await board(dueSource, false, 'B');
    expect(after.sourceRevision).toBe(saved.sourceRevision);
    // machineName is display enrichment that only the board GET fills in (save responses return null).
    const { machineName: _machineName, ...savedItem } = saved.items[0]!;
    expect(itemFor(after)).toMatchObject({ ...savedItem, orderPinned: true });
  });

  it('c: stale part-value save cannot erase B\'s new operation definitions (02768544)', async () => {
    const before = await minutes();
    expect(before.values).toEqual([]);
    const response = await saveMinutes({ perUnitMinutes: 12, setupMinutes: 5, expectedOpIds: [],
      ops: [{ opNo: 1, minutes: 7, setupMinutes: 5 }, { opNo: 2, minutes: 5, setupMinutes: 0 }] }, 'B');
    expect(response.statusCode, response.body).toBe(200);
    const saved = response.json<GrindingPlanningBoardResourceMinutesResponse>();
    const stale = await saveMinutes({ perUnitMinutes: 8, setupMinutes: 0, expectedOpIds: [] });
    expectConflict(stale, 'OPERATION_SET_CHANGED');
    expect((await minutes()).values).toEqual(saved.values);
    // An ops-omitting save using fresh IDs preserves the exact definitions and IDs.
    const fresh = await saveMinutes({ perUnitMinutes: 12, setupMinutes: 5, expectedOpIds: saved.savedOpIds });
    expect(fresh.statusCode, fresh.body).toBe(200);
    expect((await minutes()).values).toEqual(saved.values);
  });

  it('a: rejects stale numeric minutes even when operation IDs still match (520d98e2)', async () => {
    const initial = await saveMinutes({ perUnitMinutes: 7, setupMinutes: 0, ops: [{ opNo: 1, minutes: 7, setupMinutes: 0 }] });
    expect(initial.statusCode, initial.body).toBe(200);
    const old = initial.json<GrindingPlanningBoardResourceMinutesResponse>();
    const changed = await saveMinutes({ perUnitMinutes: 9, setupMinutes: 0, expectedOpIds: old.savedOpIds,
      expectedMinutes: old.savedMinutes, ops: [{ opNo: 1, minutes: 9, setupMinutes: 0 }] }, 'B');
    expect(changed.statusCode, changed.body).toBe(200);
    const saved = changed.json<GrindingPlanningBoardResourceMinutesResponse>();
    expect(saved.savedOpIds).toEqual(old.savedOpIds);
    const stale = await saveMinutes({ perUnitMinutes: 8, setupMinutes: 0, expectedOpIds: old.savedOpIds,
      expectedMinutes: old.savedMinutes, ops: [{ opNo: 1, minutes: 8, setupMinutes: 0 }] });
    expectConflict(stale, 'RESOURCE_MINUTES_CHANGED');
    expect((await minutes()).values).toEqual(saved.values);
  });

  it('d: identical retry after a lost response succeeds with the same operation IDs (520d98e2)', async () => {
    const payload = { perUnitMinutes: 7, setupMinutes: 5, expectedOpIds: [], expectedMinutes: null,
      ops: [{ opNo: 1, minutes: 7, setupMinutes: 5 }] };
    const first = await saveMinutes(payload);
    expect(first.statusCode, first.body).toBe(200);
    const saved = first.json<GrindingPlanningBoardResourceMinutesResponse>();
    // Simulate losing the acknowledgement: resend the original, unmodified preconditions.
    const retry = await saveMinutes(payload);
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual(saved);
    expect((await minutes('B')).values).toEqual(saved.values);
  });

  it('b/c: splitting keeps a saved sibling on the same lane and returns readable piece versions (1b87230d)', async () => {
    const before = await board();
    const parent = itemFor(before);
    const sibling = itemFor(before, rowIds[1]);
    expect(sibling.effectiveResourceCd).toBe(parent.effectiveResourceCd);
    const pinned = await request('PUT', '/pins', { sourceRevision: before.sourceRevision,
      items: [{ itemId: sibling.itemId, itemRevision: sibling.itemRevision }], pinned: true }, 'B');
    expect(pinned.statusCode, pinned.body).toBe(200);
    const savedSibling = pinned.json<GrindingPlanningBoardOverridesResponse>().items[0]!;
    const response = await request('POST', '/pieces/split', { parentItemId: parent.itemId,
      itemRevision: parent.itemRevision, expectedPieceSetVersion: parent.pieceSetVersion ?? 0, quantities: [2, 3] });
    expect(response.statusCode, response.body).toBe(200);
    const saved = response.json<SessakuPiecesMutationResponse>();
    const after = await board('excel', true);
    expect(saved.pieces).toHaveLength(2);
    expect(saved.pieces.map((piece) => piece.quantity)).toEqual([2, 3]);
    for (const piece of saved.pieces) {
      expect(after.items.find((item) => item.itemId === piece.itemId)).toMatchObject({
        itemRevision: piece.itemRevision, pieceSetVersion: saved.pieceSetVersion, quantity: piece.quantity
      });
    }
    expect(itemFor(after, rowIds[1])).toMatchObject({ orderPinned: true, effectiveResourceCd: savedSibling.effectiveResourceCd });
    // A later sibling save must also leave both pieces in place.
    const currentSibling = itemFor(after, rowIds[1]);
    const staleRank = await request('PUT', '/rank', { sourceRevision: before.sourceRevision,
      itemId: currentSibling.itemId, itemRevision: currentSibling.itemRevision, alternateRank: 1 });
    expectConflict(staleRank, 'STALE_PLANNING_BOARD_ORDER');
    const unpin = await request('PUT', '/pins', { sourceRevision: after.sourceRevision,
      items: [{ itemId: currentSibling.itemId, itemRevision: currentSibling.itemRevision }], pinned: false }, 'B');
    expect(unpin.statusCode, unpin.body).toBe(200);
    expect((await board('excel', true)).items.filter((item) => item.pieceId).map((item) => item.itemId).sort())
      .toEqual(saved.pieces.map((item) => item.itemId).sort());
  });

  it('b: concurrent split and same-lane sibling save retain both results or return 409 (9b3f18df)', async () => {
    const before = await board();
    const parent = itemFor(before);
    const sibling = itemFor(before, rowIds[1]);
    expect(sibling.effectiveResourceCd).toBe(parent.effectiveResourceCd);
    const laneWrites = await import('../../../../services/production-schedule/sessaku-pieces/piece-lane-writes.js');
    const originalReplace = laneWrites.replaceSiteItems;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let splitPid = 0;
    // Pause after the split has read lane overrides, before it rewrites the sibling.
    const spy = vi.spyOn(laneWrites, 'replaceSiteItems').mockImplementation(async (...args) => {
      if (args[3] === site && !splitPid) {
        const [backend] = await args[0].$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
        splitPid = backend!.pid;
        await gate;
      }
      return originalReplace(...args);
    });
    let saveSettled = false;
    let blocked = false;
    try {
      const results = await Promise.allSettled([
        request('POST', '/pieces/split', { parentItemId: parent.itemId, itemRevision: parent.itemRevision,
          expectedPieceSetVersion: parent.pieceSetVersion ?? 0, quantities: [2, 3] }),
        (async () => {
          let save: ReturnType<typeof request> | undefined;
          try {
            await vi.waitFor(() => expect(splitPid).toBeGreaterThan(0), { timeout: 10000 });
            save = request('PUT', '/pins', { sourceRevision: before.sourceRevision,
              items: [{ itemId: sibling.itemId, itemRevision: sibling.itemRevision }], pinned: true }, 'B');
            void save.then(() => { saveSettled = true; }, () => { saveSettled = true; });
            await vi.waitFor(async () => {
              const [waiting] = await prisma.$queryRaw<Array<{ blocked: boolean }>>`
                SELECT EXISTS (
                  SELECT 1 FROM pg_stat_activity
                  WHERE ${splitPid} = ANY(pg_blocking_pids(pid))
                    AND query LIKE '%ProductionScheduleGrindingPlanningBoardState%'
                ) AS blocked`;
              blocked = waiting!.blocked;
              expect(blocked || saveSettled).toBe(true);
            }, { timeout: 10000, interval: 20 });
          } finally {
            release();
            // Drain the HTTP request even when the barrier assertion fails.
            if (save) await Promise.allSettled([save]);
          }
          return save!;
        })()
      ]);
      const responses = results.map((result) => {
        expect(result.status).toBe('fulfilled');
        if (result.status !== 'fulfilled') throw result.reason;
        return result.value;
      });
      const [split, save] = responses;
      expect(split!.statusCode, split!.body).toBe(200);
      expect([200, 409], save!.body).toContain(save!.statusCode);
      const after = await board('excel', true);
      const pieces = split!.json<SessakuPiecesMutationResponse>().pieces;
      expect(pieces.map((piece) => piece.quantity)).toEqual([2, 3]);
      expect(after.items.filter((item) => item.pieceId).map((item) => item.itemId).sort())
        .toEqual(pieces.map((piece) => piece.itemId).sort());
      expect(itemFor(after, rowIds[1]).orderPinned).toBe(save!.statusCode === 200);
      const persisted = await prisma.productionScheduleGrindingPlanningBoardOverride.findUniqueOrThrow({
        where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: dashboardId, siteKey: site, itemKey: sibling.itemId } }
      });
      expect(persisted.orderPinned).toBe(save!.statusCode === 200);
      // Without the shared state lock, the successful save is overwritten by the paused split.
      expect(blocked).toBe(true);
    } finally {
      release();
      spy.mockRestore();
    }
  });

  it('c: configuring a moved leading piece returns 409 without changing pieces or operations (d1903d19)', async () => {
    for (const resourceCd of ['1', '2']) {
      const saved = await request('PUT', '/resource-minutes/value', { resourceCd, fhincd: part,
        perUnitMinutes: 7, setupMinutes: 0,
        ops: [{ opNo: 1, minutes: 3, setupMinutes: 0 }, { opNo: 2, minutes: 4, setupMinutes: 0 }] });
      expect(saved.statusCode, saved.body).toBe(200);
    }
    // Existing operation intervals allow configuration without enabling automatic unit splitting.
    const set = await prisma.productionScheduleSessakuPieceSet.create({ data: {
      csvDashboardId: dashboardId, fseiban: seiban, fhincd: part, fsigencd: '1', fkojun: '1', productNo: '1',
      plannedQuantity: 5, nextPosition: 3, pieces: { create: [
        { position: 1, quantity: 1, opSplits: { create: { fromOpNo: 2, sourceResourceCd: '1', leadingSourceResourceCd: '1' } } },
        { position: 2, quantity: 4 }
      ] }
    }, include: { pieces: { orderBy: { position: 'asc' } } } });
    const headId = `piece:${set.pieces[0]!.id}`;
    await prisma.productionScheduleGrindingPlanningBoardOverride.create({ data: {
      csvDashboardId: dashboardId, siteKey: site, itemKey: headId, overrideResourceCd: '2'
    } });
    const before = await board('excel', true);
    const head = before.items.find((item) => item.itemId === headId)!;
    expect(head).toMatchObject({ effectiveResourceCd: '2', opSplitSourceResourceCd: '1', quantity: 1 });
    const settings = await minutes();
    const target = settings.values.find((value) => value.resourceCd === '2')!;
    const readPersisted = async () => ({
      set: await prisma.productionScheduleSessakuPieceSet.findUniqueOrThrow({ where: { id: set.id },
        include: { pieces: { orderBy: { position: 'asc' }, include: { opSplits: true, opCompletions: true } } } }),
      history: await prisma.productionScheduleSessakuPieceHistory.findMany({ where: { fseiban: seiban } }),
      overrides: await prisma.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: site }, orderBy: { itemKey: 'asc' } }),
      minutes: await minutes()
    });
    const persisted = await readPersisted();
    const response = await request('POST', '/pieces/ops/configure', {
      itemId: head.itemId, itemRevision: head.itemRevision, expectedPieceSetVersion: head.pieceSetVersion,
      resourceCd: '2', minutes: [8, 9], expectedOpIds: target.ops!.map((op) => op.id!),
      expectedMinutes: { perUnitMinutes: target.perUnitMinutes, setupMinutes: target.setupMinutes,
        ops: target.ops!.map((op) => ({ opNo: op.opNo, minutes: op.minutes, setupMinutes: op.setupMinutes ?? null })) }
    });
    expectConflict(response, 'STALE_SESSAKU_PIECES');
    expect(await readPersisted()).toEqual(persisted);
    const after = await board('excel', true, 'B');
    expect(after.sourceRevision).toBe(before.sourceRevision);
    expect(after.items).toEqual(before.items);
  });

  it('a/b: test-bar writes reject stale versions and restore at the requested position (e7318fa3)', async () => {
    // 資源マスタは拠点で分かれていない全体の表なので、他のテストと同じ DB を同時に使わないこと。
    await prisma.productionScheduleResourceMaster.create({ data: {
      resourceCd: '1', resourceName: site, resourceClassCd: 'M02', resourceGroupCd: 'IT'
    } });
    const before = await board();
    const created = await request('POST', '/test-bars', { sourceRevision: before.sourceRevision, resourceCd: '1', minutes: 10 });
    expect(created.statusCode, created.body).toBe(200);
    const first = created.json<GrindingPlanningBoardTestBarMutationResponse>();
    const completed = await request('PUT', `/test-bars/${first.testBar.itemId.slice(5)}/completion`, {
      sourceRevision: first.sourceRevision, expectedVersion: first.testBar.version, intent: 'complete'
    }, 'B');
    expect(completed.statusCode, completed.body).toBe(200);
    const saved = completed.json<GrindingPlanningBoardTestBarMutationResponse>();
    expect(saved.testBar.version).toBe(first.testBar.version + 1);
    // Use the fresh board revision to isolate the test bar's own stale version check.
    const stale = await request('DELETE', `/test-bars/${first.testBar.itemId.slice(5)}`, {
      sourceRevision: saved.sourceRevision, expectedVersion: first.testBar.version
    });
    expectConflict(stale, 'STALE_TEST_BAR');
    const after = await board();
    expect(after.sourceRevision).toBe(saved.sourceRevision);
    expect(after.testBars).toEqual([saved.testBar]);
    expect(saved.testBar.isCompleted).toBe(true);
    const incomplete = await request('PUT', `/test-bars/${first.testBar.itemId.slice(5)}/completion`, {
      sourceRevision: after.sourceRevision, expectedVersion: saved.testBar.version, intent: 'incomplete'
    });
    expect(incomplete.statusCode, incomplete.body).toBe(200);
    const active = incomplete.json<GrindingPlanningBoardTestBarMutationResponse>();
    const deleted = await request('DELETE', `/test-bars/${first.testBar.itemId.slice(5)}`, {
      sourceRevision: active.sourceRevision, expectedVersion: active.testBar.version
    });
    expect(deleted.statusCode, deleted.body).toBe(200);
    const tombstone = deleted.json<GrindingPlanningBoardTestBarMutationResponse>();
    const without = await board();
    expect(without.testBars).toEqual([]);
    const predecessor = itemFor(without, rowIds[1]);
    const restored = await request('POST', `/test-bars/${first.testBar.itemId.slice(5)}/restore`, {
      sourceRevision: without.sourceRevision, expectedVersion: tombstone.testBar.version,
      restoreAfterItemId: predecessor.itemId
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const restoredBoard = await board();
    expect(restoredBoard.testBars).toEqual([restored.json<GrindingPlanningBoardTestBarMutationResponse>().testBar]);
    // GET exposes the mixed lane's ordering as alternateRank on items and test bars.
    const lane = [...restoredBoard.items, ...(restoredBoard.testBars ?? [])].sort((a, b) => a.alternateRank! - b.alternateRank!);
    expect(lane.map((bar) => bar.itemId)).toEqual([
      itemFor(without).itemId, predecessor.itemId, first.testBar.itemId
    ]);
  });

  it('b: another terminal GET does not reuse stale board content after minutes or source saves', async () => {
    await board(); // Prime reusable board payloads before changing settings.
    const response = await saveMinutes({ perUnitMinutes: 7, setupMinutes: 0, ops: [] });
    expect(response.statusCode, response.body).toBe(200);
    const saved = response.json<GrindingPlanningBoardResourceMinutesResponse>();
    expect((await minutes('B')).values).toEqual(saved.values);
    const own = itemFor(await board('excel', false, 'B'));
    expect(own).toMatchObject({ requiredMinutesSource: 'own', requiredMinutes: 35 });
    const original = await request('PUT', '/resource-minutes/source', { resourceCd: '1', source: 'original' });
    expect(original.statusCode, original.body).toBe(200);
    expect(itemFor(await board('excel', false, 'B')).requiredMinutesSource).toBe('original');
    const restored = await request('PUT', '/resource-minutes/source', { resourceCd: '1', source: 'own' });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(itemFor(await board('excel', false, 'B'))).toMatchObject({
      itemRevision: own.itemRevision, requiredMinutesSource: 'own', requiredMinutes: 35
    });
  });

  it('d: deleting the last part value and retrying does not resurrect it (520d98e2)', async () => {
    const initial = await saveMinutes({ perUnitMinutes: 7, setupMinutes: 0, ops: [{ opNo: 1, minutes: 7, setupMinutes: 0 }] });
    expect(initial.statusCode, initial.body).toBe(200);
    const saved = initial.json<GrindingPlanningBoardResourceMinutesResponse>();
    expect(saved.savedOpIds.length).toBeGreaterThan(0);
    // The retry resends the original op IDs, which the first delete already removed.
    const payload = { perUnitMinutes: null, setupMinutes: 0, ops: [], expectedOpIds: saved.savedOpIds,
      expectedMinutes: saved.savedMinutes };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await saveMinutes(payload);
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ savedMinutes: null, savedOpIds: [], values: [] });
      expect((await minutes('B')).values).toEqual([]);
    }
  });
});
