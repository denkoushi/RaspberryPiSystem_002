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
let deps: KioskRouteDeps;
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
    await app?.close();
    app = undefined;
    // Drain the routes' asynchronous warm reads before removing this fixture.
    await rewarm({ siteKey: site, snapshotStore: deps.leaderboardShellSnapshotStore, delayMs: 0 });
    await prisma.productionScheduleSessakuPieceAuditLog.deleteMany({ where: { fseiban: seiban } });
    await prisma.productionScheduleSessakuPieceSet.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } });
    await prisma.productionScheduleSessakuPieceHistory.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } });
    await prisma.productionScheduleGrindingPlanningBoardResourcePartMinutes.deleteMany({ where: { siteKey: site } });
    await prisma.productionScheduleGrindingPlanningBoardResourceMinutesSource.deleteMany({ where: { siteKey: site } });
    await prisma.productionScheduleGrindingPlanningBoardTestBar.deleteMany({ where: { siteKey: site } });
    await prisma.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { siteKey: site } });
    await prisma.productionScheduleGrindingPlanningBoardState.deleteMany({ where: { siteKey: site } });
    await prisma.productionScheduleResourceMaster.deleteMany({ where: { resourceName: site } });
    await prisma.productionScheduleDScheduleMinutes.deleteMany({ where: { csvDashboardId: dashboardId, fseiban: seiban } });
    await prisma.productionScheduleDScheduleMinutesImportRun.deleteMany({ where: { gmailMessageId: site } });
    await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
    vi.unstubAllEnvs();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('a: rejects A\'s stale item after B saves, and GET retains B (9b3f18df, 6c9dd60e)', async () => {
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

  it.each(['excel', 'scaw'] as const)('b: %s save and immediate board GET agree on revision and content (6c9dd60e)', async (dueSource) => {
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
    expect(itemFor(after)).toMatchObject({ ...saved.items[0]!, orderPinned: true });
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

  it('b/c: splitting keeps a saved sibling on the same lane and returns readable piece versions (9b3f18df, 1b87230d)', async () => {
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

  it('a/b: test-bar writes require the latest version and GET matches the acknowledgement (e7318fa3)', async () => {
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
  });

  it('b: own/original switches publish the saved minutes to another terminal\'s reads (611241d3, c55f9e9a, 78d41a3f)', async () => {
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

  it('d: deleting the last part value and retrying does not resurrect it (f302a0f4, 520d98e2)', async () => {
    const initial = await saveMinutes({ perUnitMinutes: 7, setupMinutes: 0, ops: [] });
    expect(initial.statusCode, initial.body).toBe(200);
    const saved = initial.json<GrindingPlanningBoardResourceMinutesResponse>();
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
