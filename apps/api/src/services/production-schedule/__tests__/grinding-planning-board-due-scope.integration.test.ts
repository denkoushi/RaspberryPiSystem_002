import { randomUUID } from 'node:crypto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type {
  GrindingPlanningBoardDueDetail,
  GrindingPlanningBoardDueScope,
  GrindingPlanningBoardDueScopeSnapshot,
  GrindingPlanningBoardItem,
  GrindingPlanningBoardResponse
} from '@raspi-system/shared-types';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildGrindingPlanningBoardRowItemId } from '../grinding-planning-board-projection.js';

/**
 * This suite is deliberately opt-in. It must run only against a disposable
 * localhost PostgreSQL database named planning_due_scope_* supplied through
 * TEST_DATABASE_URL.
 */
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim() ?? '';
const databaseName = (() => {
  try {
    return new URL(testDatabaseUrl).pathname.replace(/^\//, '').split('?')[0] ?? '';
  } catch {
    return '';
  }
})();
const databaseHost = (() => {
  try {
    return new URL(testDatabaseUrl).hostname;
  } catch {
    return '';
  }
})();
const hasDedicatedDatabase = Boolean(testDatabaseUrl) &&
  databaseName.startsWith('planning_due_scope_') &&
  ['localhost', '127.0.0.1', '::1'].includes(databaseHost);
const originalDatabaseUrl = process.env.DATABASE_URL;
const originalSplitFlag = process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;

type PrismaClient = import('@prisma/client').PrismaClient;
type FastifyInstance = import('fastify').FastifyInstance;
type DueSnapshot = GrindingPlanningBoardDueScopeSnapshot & { scope?: GrindingPlanningBoardDueScope };
type ApiErrorBody = { error?: { code?: string } | string };

let dbClient: PrismaClient | undefined;
let app: FastifyInstance | undefined;

if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = 'true';
  ({ prisma: dbClient } = await import('../../../lib/prisma.js'));
}

const describeIntegration = hasDedicatedDatabase ? describe : describe.skip;

function db(): PrismaClient {
  if (!dbClient) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return dbClient;
}

type Device = { apiKey: string; siteKey: string; location: string };
type SplitSpec = { dueDate?: string | null; plannedEndDate?: string | null; rank?: number; alternateRank?: number; overrideDueDate?: string | null };
type RowSpec = {
  fseiban: string;
  fhincd: string;
  productNo: string;
  resourceCd: string;
  processOrder: string;
  dueDate?: string;
  noteDueDate?: string | null;
  plannedEndDate?: string | null;
  processingType?: string;
  completed?: boolean;
  externallyCompleted?: boolean;
  rank?: number;
  alternateRank?: number;
  splits?: readonly SplitSpec[];
};
type Fixture = {
  prefix: string;
  fseiban: string;
  rowIds: string[];
  splitIds: string[];
  resourceNames: string[];
  devices: Device[];
};

const fixtures: Fixture[] = [];

function date(value: string | null | undefined): Date | null {
  return value == null ? null : new Date(`${value}T00:00:00.000Z`);
}

async function ensureDashboard(): Promise<void> {
  await db().csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    create: {
      id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      name: 'grinding-planning-board-due-scope-integration',
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

async function createFixture(options: { fseiban?: string; originalSeibanDue?: string; originalProcessing?: Record<string, string> } = {}): Promise<Fixture> {
  // Production fseiban is VARCHAR(20); keep the disposable fixture within
  // the same API limit while retaining per-test uniqueness.
  const prefix = `gds-${randomUUID().slice(0, 8)}`;
  const fseiban = options.fseiban ?? `${prefix}-SEIBAN`;
  const siteA = `${prefix}-site-a`;
  const siteB = `${prefix}-site-b`;
  const fixture: Fixture = {
    prefix,
    fseiban,
    rowIds: [],
    splitIds: [],
    resourceNames: ['305', '581', '1', '10'].map((resourceCd) => `${prefix}-${resourceCd}`),
    devices: [
      { apiKey: `${prefix}-key-a`, siteKey: siteA, location: siteA },
      { apiKey: `${prefix}-key-b`, siteKey: siteB, location: siteB }
    ]
  };
  await db().productionScheduleResourceMaster.createMany({
    data: [
      { resourceCd: '305', resourceName: fixture.resourceNames[0]!, resourceClassCd: 'M02', resourceGroupCd: 'IT' },
      { resourceCd: '581', resourceName: fixture.resourceNames[1]!, resourceClassCd: 'M02', resourceGroupCd: 'IT' },
      { resourceCd: '1', resourceName: fixture.resourceNames[2]!, resourceClassCd: 'M02', resourceGroupCd: 'IT' },
      { resourceCd: '10', resourceName: fixture.resourceNames[3]!, resourceClassCd: 'M02', resourceGroupCd: 'IT' }
    ]
  });
  await db().clientDevice.createMany({
    data: fixture.devices.map((device) => ({ name: `${device.siteKey} - terminal`, location: device.location, apiKey: device.apiKey, defaultMode: 'TAG' }))
  });
  for (const device of fixture.devices) {
    await db().productionScheduleGrindingPlanningBoardState.create({
      data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: device.siteKey, seibanOrder: [fseiban] }
    });
  }
  if (options.originalSeibanDue) {
    await db().productionScheduleSeibanDueDate.create({
      data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban, dueDate: date(options.originalSeibanDue)! }
    });
  }
  if (options.originalProcessing && Object.keys(options.originalProcessing).length > 0) {
    await db().productionScheduleSeibanProcessingDueDate.createMany({
      data: Object.entries(options.originalProcessing).map(([processingType, dueDate]) => ({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        fseiban,
        processingType,
        dueDate: date(dueDate)!
      }))
    });
  }
  fixtures.push(fixture);
  return fixture;
}

async function addRows(fixture: Fixture, specs: readonly RowSpec[]): Promise<string[]> {
  const created: Array<{ id: string; data: Record<string, string>; spec: RowSpec }> = [];
  for (const spec of specs) {
    const data = {
      FSEIBAN: spec.fseiban,
      FHINCD: spec.fhincd,
      FSIGENCD: spec.resourceCd,
      FKOJUN: spec.processOrder,
      ProductNo: spec.productNo,
      FHINMEI: `${spec.fhincd} integration part`,
      FSIGENSHOYORYO: '30'
    };
    const row = await db().csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date('2026-09-09T00:00:00.000Z'),
        dataHash: `${fixture.prefix}-${spec.fhincd}-${spec.processOrder}-${randomUUID()}`,
        rowData: data
      },
      select: { id: true }
    });
    fixture.rowIds.push(row.id);
    created.push({ id: row.id, data, spec });
  }

  await db().productionScheduleOrderSupplement.createMany({
    data: created.map(({ id, data, spec }) => ({
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: id,
      sourceCsvDashboardId: fixture.prefix,
      productNo: data.ProductNo!,
      resourceCd: data.FSIGENCD!,
      processOrder: data.FKOJUN!,
      plannedQuantity: 5,
      plannedEndDate: date(spec.plannedEndDate === undefined ? spec.dueDate ?? '2026-09-20' : spec.plannedEndDate)
    }))
  });
  await db().productionScheduleRowNote.createMany({
    data: created.map(({ id, spec }) => ({
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      csvDashboardRowId: id,
      note: 'due scope fixture',
      processingType: spec.processingType,
      dueDate: date(spec.noteDueDate === undefined ? spec.dueDate ?? '2026-09-20' : spec.noteDueDate)
    }))
  });
  const processingRows = created.filter(({ spec }) => spec.processingType);
  if (processingRows.length > 0) {
    await db().productionSchedulePartProcessingType.createMany({
      data: processingRows.map(({ data, spec }) => ({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        fhincd: data.FHINCD!,
        processingType: spec.processingType!
      }))
    });
  }
  for (const { id, data, spec } of created) {
    if (spec.rank !== undefined) {
      await db().productionScheduleOrderAssignment.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          csvDashboardRowId: id,
          location: fixture.devices[0]!.siteKey,
          siteKey: fixture.devices[0]!.siteKey,
          resourceCd: data.FSIGENCD!,
          orderNumber: spec.rank
        }
      });
    }
    if (spec.alternateRank !== undefined) {
      await db().productionScheduleGrindingPlanningBoardOverride.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          siteKey: fixture.devices[0]!.siteKey,
          itemKey: buildGrindingPlanningBoardRowItemId(data),
          alternateRank: spec.alternateRank
        }
      });
    }
    if (spec.completed) {
      await db().productionScheduleProgress.create({ data: { csvDashboardRowId: id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, isCompleted: true } });
    }
    if (spec.externallyCompleted) {
      await db().productionScheduleExternalCompletion.create({ data: { csvDashboardRowId: id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, isExternallyCompleted: true } });
    }
    for (const [splitIndex, splitSpec] of (spec.splits ?? []).entries()) {
      const split = await db().productionScheduleOrderSplit.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          parentCsvDashboardRowId: id,
          splitNo: splitIndex + 1,
          splitQuantity: 2,
          dueDate: date(splitSpec.dueDate),
          plannedEndDate: date(splitSpec.plannedEndDate)
        },
        select: { id: true }
      });
      fixture.splitIds.push(split.id);
      if (splitSpec.rank !== undefined) {
        await db().productionScheduleOrderSplitAssignment.create({
          data: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            splitId: split.id,
            location: fixture.devices[0]!.siteKey,
            siteKey: fixture.devices[0]!.siteKey,
            resourceCd: data.FSIGENCD!,
            orderNumber: splitSpec.rank
          }
        });
      }
      if (splitSpec.alternateRank !== undefined || splitSpec.overrideDueDate !== undefined) {
        await db().productionScheduleGrindingPlanningBoardOverride.create({
          data: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            siteKey: fixture.devices[0]!.siteKey,
            itemKey: `split:${split.id}`,
            overrideDueDate: date(splitSpec.overrideDueDate),
            alternateRank: splitSpec.alternateRank ?? null
          }
        });
      }
    }
  }
  return created.map(({ id }) => id);
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const rowWhere = { csvDashboardRowId: { in: fixture.rowIds } };
  await db().productionScheduleGrindingPlanningBoardDueScope.deleteMany({ where: { fseiban: fixture.fseiban } });
  await db().productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { siteKey: { in: fixture.devices.map((device) => device.siteKey) } } });
  await db().productionScheduleGrindingPlanningBoardState.deleteMany({ where: { siteKey: { in: fixture.devices.map((device) => device.siteKey) } } });
  await db().productionScheduleOrderSplitAssignment.deleteMany({ where: { splitId: { in: fixture.splitIds } } });
  await db().productionScheduleOrderSplit.deleteMany({ where: { id: { in: fixture.splitIds } } });
  if (fixture.rowIds.length > 0) {
    await db().productionScheduleProgress.deleteMany({ where: rowWhere });
    await db().productionScheduleExternalCompletion.deleteMany({ where: rowWhere });
    await db().productionSchedulePartProcessingType.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fhincd: { in: (await db().csvDashboardRow.findMany({ where: { id: { in: fixture.rowIds } }, select: { rowData: true } })).map((row) => String((row.rowData as Record<string, unknown>).FHINCD ?? '')) } } });
    await db().productionScheduleRowNote.deleteMany({ where: rowWhere });
    await db().productionScheduleOrderSupplement.deleteMany({ where: rowWhere });
    await db().productionScheduleOrderAssignment.deleteMany({ where: rowWhere });
    await db().csvDashboardRow.deleteMany({ where: { id: { in: fixture.rowIds } } });
  }
  await db().productionScheduleSeibanProcessingDueDate.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: fixture.fseiban } });
  await db().productionScheduleSeibanDueDate.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: fixture.fseiban } });
  await db().clientDevice.deleteMany({ where: { apiKey: { in: fixture.devices.map((device) => device.apiKey) } } });
  await db().productionScheduleResourceMaster.deleteMany({ where: { resourceName: { in: fixture.resourceNames } } });
}

function headers(device: Device): Record<string, string> {
  return { 'x-client-key': device.apiKey };
}

async function getDueDetail(device: Device, fseiban: string): Promise<DueSnapshot> {
  const response = await app!.inject({
    method: 'GET',
    url: `/api/kiosk/production-schedule/grinding-planning-board/seiban/${encodeURIComponent(fseiban)}/due-detail`,
    headers: headers(device)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as DueSnapshot;
}

async function getLegacyDueDetail(device: Device, fseiban: string): Promise<unknown> {
  const response = await app!.inject({
    method: 'GET',
    url: `/api/kiosk/production-schedule/due-management/seiban/${encodeURIComponent(fseiban)}`,
    headers: headers(device)
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { detail: unknown }).detail;
}

function normalizeWireDates(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  if (Array.isArray(value)) return value.map(normalizeWireDates);
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalizeWireDates(child)]));
  }
  return value;
}

async function putDueScope(device: Device, fseiban: string, snapshot: DueSnapshot, scope: GrindingPlanningBoardDueScope, dueDate: string): Promise<{ sourceGenerationToken: string; scopeRevision: string }> {
  const response = await app!.inject({
    method: 'PUT',
    url: `/api/kiosk/production-schedule/grinding-planning-board/seiban/${encodeURIComponent(fseiban)}/due-scope`,
    headers: headers(device),
    payload: {
      sourceGenerationToken: snapshot.sourceGenerationToken,
      scopeRevision: snapshot.scopeRevision,
      scope,
      dueDate
    }
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { sourceGenerationToken: string; scopeRevision: string };
}

async function putDueScopeExpectConflict(device: Device, fseiban: string, snapshot: DueSnapshot, scope: GrindingPlanningBoardDueScope, dueDate: string): Promise<ApiErrorBody> {
  const response = await app!.inject({
    method: 'PUT',
    url: `/api/kiosk/production-schedule/grinding-planning-board/seiban/${encodeURIComponent(fseiban)}/due-scope`,
    headers: headers(device),
    payload: {
      sourceGenerationToken: snapshot.sourceGenerationToken,
      scopeRevision: snapshot.scopeRevision,
      scope,
      dueDate
    }
  });
  expect(response.statusCode).toBe(409);
  return response.json() as ApiErrorBody;
}

async function putPlanningOverride(device: Device, board: GrindingPlanningBoardResponse, item: GrindingPlanningBoardItem, due: { kind: 'restore' } | { kind: 'date'; date: string }): Promise<void> {
  const response = await app!.inject({
    method: 'PUT',
    url: '/api/kiosk/production-schedule/grinding-planning-board/overrides',
    headers: headers(device),
    payload: {
      sourceRevision: board.sourceRevision,
      items: [{ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, due }]
    }
  });
  expect(response.statusCode).toBe(200);
}

async function putPlanningResource(device: Device, board: GrindingPlanningBoardResponse, item: GrindingPlanningBoardItem, resourceCd: string): Promise<void> {
  const response = await app!.inject({
    method: 'PUT',
    url: '/api/kiosk/production-schedule/grinding-planning-board/overrides',
    headers: headers(device),
    payload: {
      sourceRevision: board.sourceRevision,
      items: [{ itemId: item.itemId, itemRevision: item.itemRevision, overrideVersion: item.version, resourceCd }]
    }
  });
  expect(response.statusCode).toBe(200);
}

async function putPlanningRank(device: Device, board: GrindingPlanningBoardResponse, item: GrindingPlanningBoardItem, alternateRank: number): Promise<void> {
  const response = await app!.inject({
    method: 'PUT',
    url: '/api/kiosk/production-schedule/grinding-planning-board/rank',
    headers: headers(device),
    payload: {
      sourceRevision: board.sourceRevision,
      itemId: item.itemId,
      itemRevision: item.itemRevision,
      overrideVersion: item.version,
      alternateRank
    }
  });
  expect(response.statusCode).toBe(200);
}

async function putPlanningRankExpectConflict(device: Device, board: GrindingPlanningBoardResponse, item: GrindingPlanningBoardItem, alternateRank: number): Promise<void> {
  const response = await app!.inject({
    method: 'PUT',
    url: '/api/kiosk/production-schedule/grinding-planning-board/rank',
    headers: headers(device),
    payload: {
      sourceRevision: board.sourceRevision,
      itemId: item.itemId,
      itemRevision: item.itemRevision,
      overrideVersion: item.version,
      alternateRank
    }
  });
  expect(response.statusCode).toBe(409);
}

async function getMainBoard(device: Device, query = 'category=grinding&view=seiban&completionFilter=incomplete&pageSize=160'): Promise<GrindingPlanningBoardResponse> {
  const response = await app!.inject({
    method: 'GET',
    url: `/api/kiosk/production-schedule/grinding-planning-board?${query}`,
    headers: headers(device)
  });
  expect(response.statusCode).toBe(200);
  return response.json() as GrindingPlanningBoardResponse;
}

function itemFor(board: GrindingPlanningBoardResponse, predicate: (item: GrindingPlanningBoardItem) => boolean): GrindingPlanningBoardItem {
  const item = board.items.find(predicate);
  if (!item) throw new Error(`fixture board item not found: ${JSON.stringify(board.items)}`);
  return item;
}

function partFor(detail: GrindingPlanningBoardDueDetail, fhincd: string) {
  const part = detail.parts.find((candidate) => candidate.fhincd === fhincd);
  if (!part) throw new Error(`fixture due part not found: ${fhincd}`);
  return part;
}

async function captureSource(fixture: Fixture) {
  return Promise.all([
    db().csvDashboardRow.findMany({ where: { id: { in: fixture.rowIds } }, orderBy: { id: 'asc' }, select: { id: true, rowData: true, updatedAt: true } }),
    db().productionScheduleRowNote.findMany({ where: { csvDashboardRowId: { in: fixture.rowIds } }, orderBy: { csvDashboardRowId: 'asc' }, select: { csvDashboardRowId: true, processingType: true, dueDate: true, note: true } }),
    db().productionScheduleOrderSupplement.findMany({ where: { csvDashboardRowId: { in: fixture.rowIds } }, orderBy: { csvDashboardRowId: 'asc' }, select: { csvDashboardRowId: true, plannedQuantity: true, plannedEndDate: true, resourceCd: true, processOrder: true } }),
    db().productionScheduleSeibanDueDate.findUnique({ where: { csvDashboardId_fseiban: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: fixture.fseiban } } }),
    db().productionScheduleSeibanProcessingDueDate.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: fixture.fseiban }, orderBy: { processingType: 'asc' } })
  ]);
}

describeIntegration('grinding planning board due scope API and writeback integration', () => {
  beforeAll(async () => {
    await ensureDashboard();
    const { buildServer } = await import('../../../app.js');
    app = await buildServer();
  });

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
    await app?.close();
    await dbClient?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalSplitFlag === undefined) delete process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;
    else process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = originalSplitFlag;
  });

  it('updates every raw winner regardless of category/completion filters, keeps original tables unchanged, and isolates sites', async () => {
    const fixture = await createFixture();
    const [visibleRow, cuttingRow, excludedRow] = await addRows(fixture, [
      { fseiban: fixture.fseiban, fhincd: `${fixture.prefix}-VISIBLE`, productNo: '1', resourceCd: '305', processOrder: '1', dueDate: '2026-09-20', rank: 3, alternateRank: 3 },
      { fseiban: fixture.fseiban, fhincd: `${fixture.prefix}-CUTTING`, productNo: '2', resourceCd: '1', processOrder: '2', dueDate: '2026-09-20' },
      { fseiban: fixture.fseiban, fhincd: `${fixture.prefix}-EXCLUDED`, productNo: '3', resourceCd: '10', processOrder: '3', dueDate: '2026-09-20', completed: true, externallyCompleted: true }
    ]);
    const sourceBefore = await captureSource(fixture);
    const initial = await getDueDetail(fixture.devices[0]!, fixture.fseiban);
    const otherSiteInitial = await getDueDetail(fixture.devices[1]!, fixture.fseiban);
    expect(initial.original.dueDate).toBeNull();
    expect(otherSiteInitial.alternate.parts).toHaveLength(initial.alternate.parts.length);

    await putDueScope(fixture.devices[0]!, fixture.fseiban, initial, { kind: 'seiban' }, '2026-09-25');
    const after = await getDueDetail(fixture.devices[0]!, fixture.fseiban);
    expect(after.alternate.dueDate).toBe('2026-09-25');
    expect(after.sourceGenerationToken).toBeTruthy();
    const overrideRows = await db().productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: fixture.devices[0]!.siteKey }, select: { itemKey: true, overrideDueDate: true } });
    expect(overrideRows.filter((row) => row.overrideDueDate?.toISOString().startsWith('2026-09-25'))).toHaveLength(3);
    expect(await db().productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: fixture.devices[1]!.siteKey } })).toBe(0);
    expect((await getDueDetail(fixture.devices[1]!, fixture.fseiban)).alternate.dueDate).toBeNull();

    const board = await getMainBoard(fixture.devices[0]!);
    expect(itemFor(board, (item) => item.sourceRowId === visibleRow).effectiveDueDate).toBe('2026-09-25');
    expect(board.items.some((item) => item.sourceRowId === cuttingRow || item.sourceRowId === excludedRow)).toBe(false);
    expect(await captureSource(fixture)).toEqual(sourceBefore);
  });

  it('protects original processing dues, falls back from a cleared processing scope to planning seiban, and releases all planning processing on seiban clear', async () => {
    const fixture = await createFixture({ originalSeibanDue: '2026-09-20', originalProcessing: { P1: '2026-09-21' } });
    const [processingRow, secondProcessingRow, ordinaryRow] = await addRows(fixture, [
      // Match the existing due-management writeback state: an original P1
      // processing due of 2026-09-21 is reflected in the row note as well.
      { fseiban: fixture.fseiban, fhincd: `${fixture.prefix}-P1`, productNo: '1', resourceCd: '305', processOrder: '1', processingType: 'P1', dueDate: '2026-09-21' },
      { fseiban: fixture.fseiban, fhincd: `${fixture.prefix}-P2`, productNo: '2', resourceCd: '305', processOrder: '2', processingType: 'P2', dueDate: '2026-09-20' },
      { fseiban: fixture.fseiban, fhincd: `${fixture.prefix}-ORDINARY`, productNo: '3', resourceCd: '305', processOrder: '3', dueDate: '2026-09-20' }
    ]);
    const device = fixture.devices[0]!;
    const original = await getDueDetail(device, fixture.fseiban);
    const legacyOriginal = await getLegacyDueDetail(device, fixture.fseiban);
    expect(normalizeWireDates(original.original)).toEqual(normalizeWireDates(legacyOriginal));
    expect(original.original.processingTypeDueDates).toEqual(expect.arrayContaining([
      { processingType: 'P1', dueDate: '2026-09-21' },
      { processingType: 'P2', dueDate: null }
    ]));

    await putDueScope(device, fixture.fseiban, original, { kind: 'seiban' }, '2026-10-05');
    const afterSeiban = await getDueDetail(device, fixture.fseiban);
    await putDueScope(device, fixture.fseiban, afterSeiban, { kind: 'processing', processingType: 'P1' }, '2026-10-01');
    const processingSet = await getDueDetail(device, fixture.fseiban);
    expect(partFor(processingSet.alternate, `${fixture.prefix}-P1`).effectiveDueDate).toBe('2026-10-01');
    expect(partFor(processingSet.alternate, `${fixture.prefix}-P2`).effectiveDueDate).toBe('2026-10-05');
    expect(partFor(processingSet.alternate, `${fixture.prefix}-ORDINARY`).effectiveDueDate).toBe('2026-10-05');

    await putDueScope(device, fixture.fseiban, processingSet, { kind: 'processing', processingType: 'P2' }, '2026-10-02');
    const processingBoth = await getDueDetail(device, fixture.fseiban);
    expect(partFor(processingBoth.alternate, `${fixture.prefix}-P2`).effectiveDueDate).toBe('2026-10-02');

    await putDueScope(device, fixture.fseiban, processingBoth, { kind: 'seiban' }, '2026-10-06');
    const processingProtected = await getDueDetail(device, fixture.fseiban);
    expect(partFor(processingProtected.alternate, `${fixture.prefix}-P1`).effectiveDueDate).toBe('2026-10-01');
    expect(partFor(processingProtected.alternate, `${fixture.prefix}-P2`).effectiveDueDate).toBe('2026-10-02');
    expect(partFor(processingProtected.alternate, `${fixture.prefix}-ORDINARY`).effectiveDueDate).toBe('2026-10-06');

    await putDueScope(device, fixture.fseiban, processingProtected, { kind: 'processing', processingType: 'P1' }, '');
    const processingCleared = await getDueDetail(device, fixture.fseiban);
    expect(partFor(processingCleared.alternate, `${fixture.prefix}-P1`).effectiveDueDate).toBe('2026-10-06');
    expect((processingCleared.alternate.processingTypeDueDates ?? []).find((entry) => entry.processingType === 'P1')?.dueDate).toBe('2026-10-06');

    // A single processing clear explicitly releases the original processing
    // protection for the next planning-seiban set; P2 remains protected by
    // its active planning processing scope.
    await putDueScope(device, fixture.fseiban, processingCleared, { kind: 'seiban' }, '2026-10-07');
    const singleClearReseeded = await getDueDetail(device, fixture.fseiban);
    expect(partFor(singleClearReseeded.alternate, `${fixture.prefix}-P1`).effectiveDueDate).toBe('2026-10-07');
    expect(partFor(singleClearReseeded.alternate, `${fixture.prefix}-P2`).effectiveDueDate).toBe('2026-10-02');
    expect(partFor(singleClearReseeded.alternate, `${fixture.prefix}-ORDINARY`).effectiveDueDate).toBe('2026-10-07');

    await putDueScope(device, fixture.fseiban, singleClearReseeded, { kind: 'processing', processingType: 'P2' }, '');
    const allProcessingCleared = await getDueDetail(device, fixture.fseiban);
    expect(partFor(allProcessingCleared.alternate, `${fixture.prefix}-P2`).effectiveDueDate).toBe('2026-10-07');

    await putDueScope(device, fixture.fseiban, allProcessingCleared, { kind: 'seiban' }, '');
    const fullyCleared = await getDueDetail(device, fixture.fseiban);
    expect(partFor(fullyCleared.alternate, `${fixture.prefix}-P1`).effectiveDueDate).toBe('2026-09-21');
    expect(partFor(fullyCleared.alternate, `${fixture.prefix}-P2`).effectiveDueDate).toBe('2026-09-20');
    expect(partFor(fullyCleared.alternate, `${fixture.prefix}-ORDINARY`).effectiveDueDate).toBe('2026-09-20');
    expect((fullyCleared.alternate.processingTypeDueDates ?? []).find((entry) => entry.processingType === 'P1')?.dueDate).toBe('2026-09-21');
    expect((await db().productionScheduleSeibanProcessingDueDate.findUnique({ where: { csvDashboardId_fseiban_processingType: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: fixture.fseiban, processingType: 'P1' } } }))?.dueDate.toISOString().slice(0, 10)).toBe('2026-09-21');

    // A null processing tombstone must not disable the original processing
    // protection when a planning seiban value is set again.
    await putDueScope(device, fixture.fseiban, fullyCleared, { kind: 'seiban' }, '2026-10-10');
    const reseeded = await getDueDetail(device, fixture.fseiban);
    expect(partFor(reseeded.alternate, `${fixture.prefix}-P1`).effectiveDueDate).toBe('2026-09-21');
    expect(partFor(reseeded.alternate, `${fixture.prefix}-P2`).effectiveDueDate).toBe('2026-10-10');
    await putDueScope(device, fixture.fseiban, reseeded, { kind: 'seiban' }, '');
    const releasedAgain = await getDueDetail(device, fixture.fseiban);

    const processingScopes = await db().productionScheduleGrindingPlanningBoardDueScope.findMany({ where: { siteKey: device.siteKey, fseiban: fixture.fseiban, scopeKind: 'processing' }, select: { scopeKey: true, dueDate: true } });
    expect(processingScopes).toHaveLength(0);
    const processingRows = await db().csvDashboardRow.findMany({ where: { id: { in: [processingRow, secondProcessingRow, ordinaryRow] } }, select: { id: true, rowData: true } });
    const processingItemKeys = processingRows.map((row) => buildGrindingPlanningBoardRowItemId(row.rowData as Record<string, unknown>));
    const processingOverrides = await db().productionScheduleGrindingPlanningBoardOverride.findMany({ where: { siteKey: device.siteKey, itemKey: { in: processingItemKeys } }, select: { itemKey: true, overrideDueDate: true } });
    for (const itemKey of processingItemKeys) {
      expect(processingOverrides.find((row) => row.itemKey === itemKey)?.overrideDueDate ?? null).toBeNull();
    }

    // Once the planning overlays are released, later original-data changes
    // must be visible without another planning write.
    await db().productionScheduleSeibanProcessingDueDate.update({ where: { csvDashboardId_fseiban_processingType: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: fixture.fseiban, processingType: 'P1' } }, data: { dueDate: date('2026-09-22')! } });
    await db().productionScheduleRowNote.update({ where: { csvDashboardRowId: processingRow }, data: { dueDate: date('2026-09-22') } });
    await db().productionScheduleRowNote.update({ where: { csvDashboardRowId: secondProcessingRow }, data: { dueDate: date('2026-09-24') } });
    await db().productionScheduleRowNote.update({ where: { csvDashboardRowId: ordinaryRow }, data: { dueDate: date('2026-09-24') } });
    const followedOriginal = await getDueDetail(device, fixture.fseiban);
    expect(partFor(followedOriginal.alternate, `${fixture.prefix}-P1`).effectiveDueDate).toBe('2026-09-22');
    const followedBoard = await getMainBoard(device);
    expect(itemFor(followedBoard, (item) => item.sourceRowId === processingRow).effectiveDueDate).toBe('2026-09-22');
    expect(itemFor(followedBoard, (item) => item.sourceRowId === secondProcessingRow).effectiveDueDate).toBe('2026-09-24');
    expect(itemFor(followedBoard, (item) => item.sourceRowId === ordinaryRow).effectiveDueDate).toBe('2026-09-24');
    expect(releasedAgain.scopeRevision).not.toBe(reseeded.scopeRevision);
  });

  it('clears a processing scope to the CSV planned end date without mutating original dues, and leaves an unset CSV date unset', async () => {
    const fixture = await createFixture({ originalProcessing: { P1: '2026-09-21' } });
    const [rowId] = await addRows(fixture, [{
      fseiban: fixture.fseiban,
      fhincd: `${fixture.prefix}-CSV-FALLBACK`,
      productNo: '1',
      resourceCd: '305',
      processOrder: '1',
      processingType: 'P1',
      dueDate: '2026-09-21',
      plannedEndDate: '2026-09-30',
      alternateRank: 5
    }]);
    const device = fixture.devices[0]!;
    const originalSource = await captureSource(fixture);
    const initial = await getDueDetail(device, fixture.fseiban);
    expect(initial.original.processingTypeDueDates).toEqual([{ processingType: 'P1', dueDate: '2026-09-21' }]);

    await putDueScope(device, fixture.fseiban, initial, { kind: 'processing', processingType: 'P1' }, '2026-10-01');
    const setBoard = await getMainBoard(device);
    const setItem = itemFor(setBoard, (item) => item.sourceRowId === rowId);
    expect(setItem.effectiveDueDate).toBe('2026-10-01');
    await db().productionScheduleGrindingPlanningBoardOverride.update({
      where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: device.siteKey, itemKey: setItem.itemId } },
      data: { alternateRank: 5 }
    });

    const beforeClear = await getDueDetail(device, fixture.fseiban);
    await putDueScope(device, fixture.fseiban, beforeClear, { kind: 'processing', processingType: 'P1' }, '');
    const cleared = await getDueDetail(device, fixture.fseiban);
    const clearedBoard = await getMainBoard(device);
    expect(partFor(cleared.alternate, `${fixture.prefix}-CSV-FALLBACK`).effectiveDueDate).toBe('2026-09-30');
    expect(itemFor(clearedBoard, (item) => item.sourceRowId === rowId).effectiveDueDate).toBe('2026-09-30');
    expect(itemFor(clearedBoard, (item) => item.sourceRowId === rowId).alternateRank).toBeNull();
    expect(cleared.original.processingTypeDueDates).toEqual([{ processingType: 'P1', dueDate: '2026-09-21' }]);

    await putPlanningRank(device, clearedBoard, itemFor(clearedBoard, (item) => item.sourceRowId === rowId), 7);
    const rankOnlyBoard = await getMainBoard(device);
    expect(itemFor(rankOnlyBoard, (item) => item.sourceRowId === rowId)).toMatchObject({ effectiveDueDate: '2026-09-30', alternateRank: 7 });
    await putPlanningResource(device, rankOnlyBoard, itemFor(rankOnlyBoard, (item) => item.sourceRowId === rowId), '581');
    const resourceOnlyBoard = await getMainBoard(device);
    expect(itemFor(resourceOnlyBoard, (item) => item.sourceRowId === rowId)).toMatchObject({ effectiveDueDate: '2026-09-30', effectiveResourceCd: '581', alternateRank: null });
    await putPlanningRank(device, resourceOnlyBoard, itemFor(resourceOnlyBoard, (item) => item.sourceRowId === rowId), 9);
    const rankReseatedBoard = await getMainBoard(device);
    expect(itemFor(rankReseatedBoard, (item) => item.sourceRowId === rowId)).toMatchObject({ effectiveDueDate: '2026-09-30', effectiveResourceCd: '581', alternateRank: 9 });

    await putPlanningOverride(device, rankReseatedBoard, itemFor(rankReseatedBoard, (item) => item.sourceRowId === rowId), { kind: 'restore' });
    const restored = await getDueDetail(device, fixture.fseiban);
    const restoredBoard = await getMainBoard(device);
    expect(partFor(restored.alternate, `${fixture.prefix}-CSV-FALLBACK`).effectiveDueDate).toBe('2026-09-21');
    expect(itemFor(restoredBoard, (item) => item.sourceRowId === rowId)).toMatchObject({ effectiveDueDate: '2026-09-21', effectiveResourceCd: '581', alternateRank: null });
    expect(await captureSource(fixture)).toEqual(originalSource);

    const unsetFixture = await createFixture({ originalProcessing: { P1: '2026-09-21' } });
    const [unsetRowId] = await addRows(unsetFixture, [{
      fseiban: unsetFixture.fseiban,
      fhincd: `${unsetFixture.prefix}-CSV-UNSET`,
      productNo: '1',
      resourceCd: '305',
      processOrder: '1',
      processingType: 'P1',
      dueDate: '2026-09-21',
      plannedEndDate: null,
      splits: [{ dueDate: null, rank: 6, alternateRank: 5 }]
    }]);
    const unsetDevice = unsetFixture.devices[0]!;
    const unsetSplitId = unsetFixture.splitIds[0]!;
    expect((await db().productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: unsetRowId }, select: { plannedEndDate: true } })).plannedEndDate).toBeNull();
    const unsetSource = await captureSource(unsetFixture);
    const unsetInitial = await getDueDetail(unsetDevice, unsetFixture.fseiban);
    await putDueScope(unsetDevice, unsetFixture.fseiban, unsetInitial, { kind: 'processing', processingType: 'P1' }, '2026-10-01');
    const unsetBeforeClear = await getDueDetail(unsetDevice, unsetFixture.fseiban);
    await putDueScope(unsetDevice, unsetFixture.fseiban, unsetBeforeClear, { kind: 'processing', processingType: 'P1' }, '');
    const unsetCleared = await getDueDetail(unsetDevice, unsetFixture.fseiban);
    const unsetBoard = await getMainBoard(unsetDevice);
    expect(partFor(unsetCleared.alternate, `${unsetFixture.prefix}-CSV-UNSET`).effectiveDueDate).toBeNull();
    expect(itemFor(unsetBoard, (item) => item.sourceRowId === unsetRowId).effectiveDueDate).toBeNull();
    const unsetSplit = itemFor(unsetBoard, (item) => item.itemId === `split:${unsetSplitId}`);
    expect(unsetSplit.effectiveDueDate).toBeNull();
    await putPlanningRank(unsetDevice, unsetBoard, unsetSplit, 5);
    const unsetRankedBoard = await getMainBoard(unsetDevice);
    expect(itemFor(unsetRankedBoard, (item) => item.itemId === `split:${unsetSplitId}`)).toMatchObject({ effectiveDueDate: null, alternateRank: 5 });
    await putPlanningOverride(unsetDevice, unsetRankedBoard, itemFor(unsetRankedBoard, (item) => item.itemId === `split:${unsetSplitId}`), { kind: 'restore' });
    const unsetRestoredBoard = await getMainBoard(unsetDevice);
    expect(itemFor(unsetRestoredBoard, (item) => item.itemId === `split:${unsetSplitId}`)).toMatchObject({ effectiveDueDate: null, alternateRank: 5 });
    expect(await captureSource(unsetFixture)).toEqual(unsetSource);
  });

  it('keeps explicit split due and override while inherited split follows the parent through two changes', async () => {
    const fixture = await createFixture();
    const [rowId] = await addRows(fixture, [{ fseiban: fixture.fseiban, fhincd: `${fixture.prefix}-SPLIT`, productNo: '1', resourceCd: '305', processOrder: '1', dueDate: '2026-09-20', rank: 3, alternateRank: 3, splits: [{ dueDate: '2026-09-21', rank: 4, alternateRank: 4 }, { dueDate: null, rank: 6, alternateRank: 7, overrideDueDate: '2026-09-23' }, { dueDate: null, rank: 5, alternateRank: 5 }] }]);
    const explicitDueSplitId = fixture.splitIds[0]!;
    const explicitOverrideSplitId = fixture.splitIds[1]!;
    const inheritedSplitId = fixture.splitIds[2]!;
    const device = fixture.devices[0]!;
    const initialBoard = await getMainBoard(device, 'category=grinding&view=seiban&completionFilter=all&pageSize=160');
    const explicitDueSplit = itemFor(initialBoard, (item) => item.itemId === `split:${explicitDueSplitId}`);
    const explicitOverrideSplit = itemFor(initialBoard, (item) => item.itemId === `split:${explicitOverrideSplitId}`);
    const inheritedSplit = itemFor(initialBoard, (item) => item.itemId === `split:${inheritedSplitId}`);
    expect((await db().productionScheduleOrderSplitAssignment.findUnique({ where: { splitId_location: { splitId: explicitDueSplitId, location: device.siteKey } }, select: { orderNumber: true } }))?.orderNumber).toBe(4);
    expect((await db().productionScheduleOrderSplitAssignment.findUnique({ where: { splitId_location: { splitId: inheritedSplitId, location: device.siteKey } }, select: { orderNumber: true } }))?.orderNumber).toBe(5);

    const initial = await getDueDetail(device, fixture.fseiban);
    await putDueScope(device, fixture.fseiban, initial, { kind: 'seiban' }, '2026-09-20');
    const sameDateBoard = await getMainBoard(device, 'category=grinding&view=seiban&completionFilter=all&pageSize=160');
    expect(itemFor(sameDateBoard, (item) => item.itemId === inheritedSplit.itemId).effectiveDueDate).toBe('2026-09-20');
    expect(itemFor(sameDateBoard, (item) => item.itemId === inheritedSplit.itemId).alternateRank).toBe(5);

    const changedFromSameDate = await getDueDetail(device, fixture.fseiban);
    await putDueScope(device, fixture.fseiban, changedFromSameDate, { kind: 'seiban' }, '2026-09-25');
    const firstBoard = await getMainBoard(device, 'category=grinding&view=seiban&completionFilter=all&pageSize=160');
    expect(itemFor(firstBoard, (item) => item.itemId === explicitDueSplit.itemId).effectiveDueDate).toBe('2026-09-21');
    expect(itemFor(firstBoard, (item) => item.itemId === explicitDueSplit.itemId).alternateRank).toBe(4);
    expect(itemFor(firstBoard, (item) => item.itemId === explicitOverrideSplit.itemId).effectiveDueDate).toBe('2026-09-23');
    expect(itemFor(firstBoard, (item) => item.itemId === explicitOverrideSplit.itemId).alternateRank).toBe(7);
    expect(itemFor(firstBoard, (item) => item.itemId === inheritedSplit.itemId).effectiveDueDate).toBe('2026-09-25');
    expect(itemFor(firstBoard, (item) => item.itemId === inheritedSplit.itemId).alternateRank).toBeNull();
    const parentData = await db().csvDashboardRow.findUniqueOrThrow({ where: { id: rowId }, select: { rowData: true } });
    const parentOverride = await db().productionScheduleGrindingPlanningBoardOverride.findUnique({ where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: device.siteKey, itemKey: buildGrindingPlanningBoardRowItemId(parentData.rowData as Record<string, unknown>) } }, select: { overrideDueDate: true, alternateRank: true } });
    expect(parentOverride).toMatchObject({ overrideDueDate: date('2026-09-25'), alternateRank: null });

    const second = await getDueDetail(device, fixture.fseiban);
    await putDueScope(device, fixture.fseiban, second, { kind: 'seiban' }, '2026-09-26');
    const secondBoard = await getMainBoard(device, 'category=grinding&view=seiban&completionFilter=all&pageSize=160');
    expect(itemFor(secondBoard, (item) => item.itemId === inheritedSplit.itemId).effectiveDueDate).toBe('2026-09-26');
    expect(itemFor(secondBoard, (item) => item.itemId === explicitDueSplit.itemId).effectiveDueDate).toBe('2026-09-21');
    expect(itemFor(secondBoard, (item) => item.itemId === explicitOverrideSplit.itemId).effectiveDueDate).toBe('2026-09-23');

    const restoreSnapshot = await getDueDetail(device, fixture.fseiban);
    await putDueScope(device, fixture.fseiban, restoreSnapshot, { kind: 'seiban' }, '');
    const restoredBoard = await getMainBoard(device, 'category=grinding&view=seiban&completionFilter=all&pageSize=160');
    expect(itemFor(restoredBoard, (item) => item.itemId === inheritedSplit.itemId).effectiveDueDate).toBe('2026-09-20');
    expect(itemFor(restoredBoard, (item) => item.itemId === inheritedSplit.itemId).alternateRank).toBeNull();
  });

  it('preserves rank for same effective due dates, including plannedEndDate, and clears it only on an effective change', async () => {
    const fixture = await createFixture();
    const [plannedEndRow, ordinaryRow] = await addRows(fixture, [
      { fseiban: fixture.fseiban, fhincd: `${fixture.prefix}-PLANNED-END`, productNo: '1', resourceCd: '305', processOrder: '1', noteDueDate: null, plannedEndDate: '2026-09-20', rank: 3, alternateRank: 3 },
      { fseiban: fixture.fseiban, fhincd: `${fixture.prefix}-NOTE`, productNo: '2', resourceCd: '305', processOrder: '2', dueDate: '2026-09-20', rank: 4, alternateRank: 4 }
    ]);
    const device = fixture.devices[0]!;
    const initialBoard = await getMainBoard(device);
    const plannedEndItem = itemFor(initialBoard, (item) => item.sourceRowId === plannedEndRow);
    const ordinaryItem = itemFor(initialBoard, (item) => item.sourceRowId === ordinaryRow);
    const initial = await getDueDetail(device, fixture.fseiban);
    await putDueScope(device, fixture.fseiban, initial, { kind: 'seiban' }, '2026-09-20');
    const sameDateBoard = await getMainBoard(device);
    expect(itemFor(sameDateBoard, (item) => item.itemId === plannedEndItem.itemId).effectiveDueDate).toBe('2026-09-20');
    expect(itemFor(sameDateBoard, (item) => item.itemId === plannedEndItem.itemId).alternateRank).toBe(3);
    expect(itemFor(sameDateBoard, (item) => item.itemId === ordinaryItem.itemId).alternateRank).toBe(4);

    const changed = await getDueDetail(device, fixture.fseiban);
    await putDueScope(device, fixture.fseiban, changed, { kind: 'seiban' }, '2026-09-21');
    const changedBoard = await getMainBoard(device);
    expect(itemFor(changedBoard, (item) => item.itemId === plannedEndItem.itemId).alternateRank).toBeNull();
    expect(itemFor(changedBoard, (item) => item.itemId === ordinaryItem.itemId).alternateRank).toBeNull();
  });

  it('restores inherited and explicit split overrides without clearing rank when effective due remains equal, and rejects a stale split rank write', async () => {
    const fixture = await createFixture();
    await addRows(fixture, [{
      fseiban: fixture.fseiban,
      fhincd: `${fixture.prefix}-RESTORE-SPLIT`,
      productNo: '1',
      resourceCd: '305',
      processOrder: '1',
      dueDate: '2026-09-20',
      splits: [
        { dueDate: null, rank: 6, alternateRank: 5 },
        { dueDate: null, rank: 7, alternateRank: 5, overrideDueDate: '2026-09-25' }
      ]
    }]);
    const device = fixture.devices[0]!;
    const initialDue = await getDueDetail(device, fixture.fseiban);
    await putDueScope(device, fixture.fseiban, initialDue, { kind: 'seiban' }, '2026-09-25');

    const inheritedSplitId = fixture.splitIds[0]!;
    const explicitSplitId = fixture.splitIds[1]!;
    const inheritedItemKey = `split:${inheritedSplitId}`;
    await db().productionScheduleGrindingPlanningBoardOverride.update({
      where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: device.siteKey, itemKey: inheritedItemKey } },
      data: { alternateRank: 5 }
    });

    let board = await getMainBoard(device, 'category=grinding&view=seiban&completionFilter=all&pageSize=160');
    let inherited = itemFor(board, (item) => item.itemId === inheritedItemKey);
    let explicit = itemFor(board, (item) => item.itemId === `split:${explicitSplitId}`);
    expect(inherited.effectiveDueDate).toBe('2026-09-25');
    expect(inherited.alternateRank).toBe(5);
    expect(explicit.effectiveDueDate).toBe('2026-09-25');
    expect(explicit.alternateRank).toBe(5);

    await putPlanningOverride(device, board, inherited, { kind: 'restore' });
    board = await getMainBoard(device, 'category=grinding&view=seiban&completionFilter=all&pageSize=160');
    inherited = itemFor(board, (item) => item.itemId === inheritedItemKey);
    expect(inherited.effectiveDueDate).toBe('2026-09-25');
    expect(inherited.alternateRank).toBe(5);

    await putPlanningOverride(device, board, explicit, { kind: 'restore' });
    board = await getMainBoard(device, 'category=grinding&view=seiban&completionFilter=all&pageSize=160');
    explicit = itemFor(board, (item) => item.itemId === `split:${explicitSplitId}`);
    expect(explicit.effectiveDueDate).toBe('2026-09-25');
    expect(explicit.alternateRank).toBe(5);
    expect((await db().productionScheduleGrindingPlanningBoardOverride.findUnique({ where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: device.siteKey, itemKey: explicit.itemId } }, select: { overrideDueDate: true } }))?.overrideDueDate).toBeNull();

    const staleBoard = await getMainBoard(device, 'category=grinding&view=seiban&completionFilter=all&pageSize=160');
    const staleInherited = itemFor(staleBoard, (item) => item.itemId === inheritedItemKey);
    const changedDueSnapshot = await getDueDetail(device, fixture.fseiban);
    await putDueScope(device, fixture.fseiban, changedDueSnapshot, { kind: 'seiban' }, '2026-09-26');
    await putPlanningRankExpectConflict(device, staleBoard, staleInherited, 5);
    const changedBoard = await getMainBoard(device, 'category=grinding&view=seiban&completionFilter=all&pageSize=160');
    expect(itemFor(changedBoard, (item) => item.itemId === inheritedItemKey).effectiveDueDate).toBe('2026-09-26');
  });

  it('returns 409 and leaves no partial writes for stale target, source row, added split, and deleted split snapshots', async () => {
    const staleFixture = await createFixture();
    await addRows(staleFixture, [{ fseiban: staleFixture.fseiban, fhincd: `${staleFixture.prefix}-STALE`, productNo: '1', resourceCd: '305', processOrder: '1', dueDate: '2026-09-20' }]);
    const staleDevice = staleFixture.devices[0]!;
    const staleSnapshot = await getDueDetail(staleDevice, staleFixture.fseiban);
    await putDueScope(staleDevice, staleFixture.fseiban, staleSnapshot, { kind: 'seiban' }, '2026-09-25');
    await putDueScopeExpectConflict(staleDevice, staleFixture.fseiban, staleSnapshot, { kind: 'seiban' }, '2026-09-26');
    expect(await db().productionScheduleGrindingPlanningBoardDueScope.count({ where: { siteKey: staleDevice.siteKey, fseiban: staleFixture.fseiban, dueDate: date('2026-09-25') } })).toBe(1);

    const rawFixture = await createFixture();
    const [rawRow] = await addRows(rawFixture, [{ fseiban: rawFixture.fseiban, fhincd: `${rawFixture.prefix}-RAW`, productNo: '1', resourceCd: '305', processOrder: '1', dueDate: '2026-09-20' }]);
    const rawDevice = rawFixture.devices[0]!;
    const rawSnapshot = await getDueDetail(rawDevice, rawFixture.fseiban);
    const rawBefore = await db().csvDashboardRow.findUniqueOrThrow({ where: { id: rawRow }, select: { rowData: true } });
    await db().csvDashboardRow.update({ where: { id: rawRow }, data: { rowData: { ...(rawBefore.rowData as Record<string, unknown>), FHINMEI: 'changed source' } } });
    await putDueScopeExpectConflict(rawDevice, rawFixture.fseiban, rawSnapshot, { kind: 'seiban' }, '2026-09-25');
    expect(await db().productionScheduleGrindingPlanningBoardDueScope.count({ where: { siteKey: rawDevice.siteKey, fseiban: rawFixture.fseiban } })).toBe(0);
    expect(await db().productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: rawDevice.siteKey } })).toBe(0);

    const fingerprintFixture = await createFixture({ originalSeibanDue: '2026-09-20' });
    const [fingerprintRow] = await addRows(fingerprintFixture, [{ fseiban: fingerprintFixture.fseiban, fhincd: `${fingerprintFixture.prefix}-FINGERPRINT`, productNo: '1', resourceCd: '305', processOrder: '1', processingType: 'P1', dueDate: '2026-09-20' }]);
    const fingerprintDevice = fingerprintFixture.devices[0]!;
    const noteBefore = await db().productionScheduleRowNote.findUniqueOrThrow({ where: { csvDashboardRowId: fingerprintRow }, select: { updatedAt: true } });
    const supplementBefore = await db().productionScheduleOrderSupplement.findUniqueOrThrow({ where: { csvDashboardRowId: fingerprintRow }, select: { updatedAt: true } });
    const processingBefore = await db().productionSchedulePartProcessingType.findUniqueOrThrow({ where: { csvDashboardId_fhincd: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fhincd: `${fingerprintFixture.prefix}-FINGERPRINT` } }, select: { updatedAt: true } });
    const originalSeibanBefore = await db().productionScheduleSeibanDueDate.findUniqueOrThrow({ where: { csvDashboardId_fseiban: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: fingerprintFixture.fseiban } }, select: { updatedAt: true } });
    const progressBaseline = await db().productionScheduleProgress.create({
      data: {
        csvDashboardRowId: fingerprintRow,
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        isCompleted: false,
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
        updatedAt: new Date('2026-09-01T00:00:00.000Z')
      },
      select: { updatedAt: true }
    });
    const fingerprintSnapshot = await getDueDetail(fingerprintDevice, fingerprintFixture.fseiban);
    let latestFingerprintSnapshot = fingerprintSnapshot;
    const expectFingerprintConflict = async (staleSnapshot: DueSnapshot): Promise<void> => {
      const currentSnapshot = await getDueDetail(fingerprintDevice, fingerprintFixture.fseiban);
      expect(currentSnapshot.sourceGenerationToken).toBe(fingerprintSnapshot.sourceGenerationToken);
      expect(currentSnapshot.scopeRevision).not.toBe(staleSnapshot.scopeRevision);
      await putDueScopeExpectConflict(fingerprintDevice, fingerprintFixture.fseiban, staleSnapshot, { kind: 'seiban' }, '2026-09-25');
      expect(await db().productionScheduleGrindingPlanningBoardDueScope.count({ where: { siteKey: fingerprintDevice.siteKey, fseiban: fingerprintFixture.fseiban } })).toBe(0);
      expect(await db().productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: fingerprintDevice.siteKey } })).toBe(0);
      latestFingerprintSnapshot = currentSnapshot;
    };

    await db().productionScheduleRowNote.update({ where: { csvDashboardRowId: fingerprintRow }, data: { dueDate: date('2026-09-22'), updatedAt: noteBefore.updatedAt } });
    await expectFingerprintConflict(latestFingerprintSnapshot);

    await db().productionScheduleOrderSupplement.update({ where: { csvDashboardRowId: fingerprintRow }, data: { plannedEndDate: date('2026-09-22'), updatedAt: supplementBefore.updatedAt } });
    await expectFingerprintConflict(latestFingerprintSnapshot);

    await db().productionSchedulePartProcessingType.update({ where: { csvDashboardId_fhincd: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fhincd: `${fingerprintFixture.prefix}-FINGERPRINT` } }, data: { processingType: 'P2', updatedAt: processingBefore.updatedAt } });
    await expectFingerprintConflict(latestFingerprintSnapshot);

    await db().productionScheduleProgress.update({ where: { csvDashboardRowId: fingerprintRow }, data: { isCompleted: true, updatedAt: progressBaseline.updatedAt } });
    await expectFingerprintConflict(latestFingerprintSnapshot);

    await db().productionScheduleSeibanDueDate.update({ where: { csvDashboardId_fseiban: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: fingerprintFixture.fseiban } }, data: { dueDate: date('2026-09-22')!, updatedAt: originalSeibanBefore.updatedAt } });
    await expectFingerprintConflict(latestFingerprintSnapshot);

    const addedFixture = await createFixture();
    const [addedRow] = await addRows(addedFixture, [{ fseiban: addedFixture.fseiban, fhincd: `${addedFixture.prefix}-ADD`, productNo: '1', resourceCd: '305', processOrder: '1', dueDate: '2026-09-20' }]);
    const addedDevice = addedFixture.devices[0]!;
    const addedSnapshot = await getDueDetail(addedDevice, addedFixture.fseiban);
    const addedSplit = await db().productionScheduleOrderSplit.create({ data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, parentCsvDashboardRowId: addedRow, splitNo: 1, splitQuantity: 1 }, select: { id: true } });
    addedFixture.splitIds.push(addedSplit.id);
    await putDueScopeExpectConflict(addedDevice, addedFixture.fseiban, addedSnapshot, { kind: 'seiban' }, '2026-09-25');
    expect(await db().productionScheduleGrindingPlanningBoardDueScope.count({ where: { siteKey: addedDevice.siteKey, fseiban: addedFixture.fseiban } })).toBe(0);
    expect(await db().productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: addedDevice.siteKey } })).toBe(0);

    const deletedFixture = await createFixture();
    const [deletedRow] = await addRows(deletedFixture, [{ fseiban: deletedFixture.fseiban, fhincd: `${deletedFixture.prefix}-DELETE`, productNo: '1', resourceCd: '305', processOrder: '1', dueDate: '2026-09-20', splits: [{}] }]);
    const deletedDevice = deletedFixture.devices[0]!;
    const deletedSnapshot = await getDueDetail(deletedDevice, deletedFixture.fseiban);
    const deletedSplitId = deletedFixture.splitIds[0]!;
    await db().productionScheduleOrderSplit.delete({ where: { id: deletedSplitId } });
    await putDueScopeExpectConflict(deletedDevice, deletedFixture.fseiban, deletedSnapshot, { kind: 'seiban' }, '2026-09-25');
    expect(await db().productionScheduleGrindingPlanningBoardDueScope.count({ where: { siteKey: deletedDevice.siteKey, fseiban: deletedFixture.fseiban } })).toBe(0);
    expect(await db().productionScheduleGrindingPlanningBoardOverride.count({ where: { siteKey: deletedDevice.siteKey } })).toBe(0);
    expect(deletedRow).toBeTruthy();
  });
});
