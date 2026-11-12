import type { GrindingPlanningBoardCategory } from '@raspi-system/shared-types';
import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { GrindingPlanningBoardProjectionOverride, GrindingPlanningBoardProjectionRow, GrindingPlanningBoardProjectionRowDetail } from '../grinding-planning-board-projection.js';
import { buildGrindingPlanningBoardRowItemId, projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
import { readSessakuPieceSets } from '../sessaku-pieces/piece-key.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners } from '../row-resolver/max-product-no-winner-materialization.js';

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
type ReadSummary = typeof import('../grinding-planning-board-load-summary.js').readGrindingPlanningBoardLoadSummary;
type SummaryRow = {
  id: string;
  data: Record<string, string | null>;
  plannedQuantity: number;
  completed: boolean;
  externallyCompleted: boolean;
  splitQuantities: number[];
};

let dbClient: PrismaClient | undefined;
let readSummary: ReadSummary | undefined;

if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  ({ prisma: dbClient } = await import('../../../lib/prisma.js'));
  ({ readGrindingPlanningBoardLoadSummary: readSummary } = await import('../grinding-planning-board-load-summary.js'));
}

const describeIntegration = hasDedicatedDatabase ? describe : describe.skip;

function db(): PrismaClient {
  if (!dbClient) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return dbClient;
}

function summaryReader(): ReadSummary {
  if (!readSummary) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return readSummary;
}

const fixtures: Array<{ siteKey: string; rowIds: string[]; splitIds: string[] }> = [];

async function ensureDashboard(): Promise<void> {
  await db().csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    create: {
      id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      name: 'grinding-planning-board-load-summary-integration',
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

async function createFixture(): Promise<{
  siteKey: string;
  rows: SummaryRow[];
  rowIds: string[];
  splitIds: string[];
  splitIdsByParentRow: Map<string, string[]>;
}> {
  // Keep fixture identifiers within the production VARCHAR column limits.
  const prefix = `it-${randomUUID().slice(0, 6)}`;
  const siteKey = `${prefix}-site`;
  const specs = [
    { suffix: 'A', resourceCd: 'G-01', processOrder: '1', seibanSuffix: 'A', requiredMinutes: '100', plannedQuantity: 5, completed: false, externallyCompleted: false, splitQuantities: [] },
    { suffix: 'B', resourceCd: 'G-01', processOrder: '2', seibanSuffix: 'B', requiredMinutes: '50', plannedQuantity: 5, completed: false, externallyCompleted: true, splitQuantities: [] },
    { suffix: 'C', resourceCd: 'G-02', processOrder: '3', seibanSuffix: 'C', requiredMinutes: '40', plannedQuantity: 4, completed: false, externallyCompleted: false, splitQuantities: [] },
    { suffix: 'D', resourceCd: 'G-01', processOrder: '4', seibanSuffix: 'D', requiredMinutes: '100', plannedQuantity: 5, completed: false, externallyCompleted: false, splitQuantities: [2, 3] },
    { suffix: 'E', resourceCd: 'G-01', processOrder: '5', seibanSuffix: 'E', requiredMinutes: 'unknown', plannedQuantity: 5, completed: false, externallyCompleted: false, splitQuantities: [] },
    // Same seiban/resource/process as A, but a different FHINCD. This catches
    // accidental ProductNo-based or FHINCD-omitting logical-key collisions.
    { suffix: 'F', resourceCd: 'G-01', processOrder: '1', seibanSuffix: 'A', requiredMinutes: '-5', plannedQuantity: 5, completed: false, externallyCompleted: false, splitQuantities: [] },
    { suffix: 'G', resourceCd: 'G-01', processOrder: '6', seibanSuffix: 'G', requiredMinutes: '1.5', plannedQuantity: 3, completed: false, externallyCompleted: false, splitQuantities: [1] },
    { suffix: 'H', resourceCd: 'G-01', processOrder: '7', seibanSuffix: 'H', requiredMinutes: '0', plannedQuantity: 3, completed: false, externallyCompleted: false, splitQuantities: [1] },
    { suffix: 'I', resourceCd: 'G-01', processOrder: '8', seibanSuffix: 'I', requiredMinutes: null, plannedQuantity: 3, completed: false, externallyCompleted: false, splitQuantities: [1] },
    { suffix: 'J', resourceCd: 'G-01', processOrder: '9', seibanSuffix: 'J', requiredMinutes: '10.5', plannedQuantity: 0, completed: false, externallyCompleted: false, splitQuantities: [1] },
    { suffix: 'K', resourceCd: 'G-01', processOrder: ' 10 ', seibanSuffix: "Q ' 空  ", requiredMinutes: '12', plannedQuantity: 2, completed: false, externallyCompleted: false, splitQuantities: [] }
  ];
  const rows: SummaryRow[] = [];
  for (const spec of specs) {
    const data = {
      FSEIBAN: `${prefix}-${spec.seibanSuffix}`,
      FHINCD: `${prefix}-PART-${spec.suffix}`,
      FSIGENCD: spec.resourceCd,
      FKOJUN: spec.processOrder,
      ProductNo: `${prefix}-P-${spec.suffix}`,
      FHINMEI: 'load summary fixture',
      FSIGENSHOYORYO: spec.requiredMinutes
    };
    const created = await db().csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date('2026-09-09T00:00:00.000Z'),
        dataHash: `${prefix}-${spec.suffix}-${randomUUID()}`,
        rowData: data
      },
      select: { id: true }
    });
    await db().productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: created.id,
        sourceCsvDashboardId: prefix,
        productNo: data.ProductNo,
        resourceCd: data.FSIGENCD,
        processOrder: data.FKOJUN,
        plannedQuantity: spec.plannedQuantity
      }
    });
    if (spec.completed) {
      await db().productionScheduleProgress.create({
        data: { csvDashboardRowId: created.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, isCompleted: true }
      });
    }
    if (spec.externallyCompleted) {
      await db().productionScheduleExternalCompletion.create({
        data: { csvDashboardRowId: created.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, isExternallyCompleted: true }
      });
    }
    rows.push({
      id: created.id,
      data,
      plannedQuantity: spec.plannedQuantity,
      completed: spec.completed,
      externallyCompleted: spec.externallyCompleted,
      splitQuantities: spec.splitQuantities
    });
  }
  const splitIds: string[] = [];
  const splitIdsByParentRow = new Map<string, string[]>();
  for (const row of rows) {
    const rowSplitIds: string[] = [];
    for (const [index, splitQuantity] of row.splitQuantities.entries()) {
      const split = await db().productionScheduleOrderSplit.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          parentCsvDashboardRowId: row.id,
          splitNo: index + 1,
          splitQuantity
        },
        select: { id: true }
      });
      splitIds.push(split.id);
      rowSplitIds.push(split.id);
    }
    splitIdsByParentRow.set(row.id, rowSplitIds);
  }
  const fixture = { siteKey, rows, rowIds: rows.map((row) => row.id), splitIds, splitIdsByParentRow };
  fixtures.push({ siteKey, rowIds: fixture.rowIds, splitIds });
  return fixture;
}

async function cleanupFixture(fixture: { siteKey: string; rowIds: string[]; splitIds: string[] }): Promise<void> {
  await db().productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { siteKey: fixture.siteKey } });
  await db().productionScheduleGrindingPlanningBoardResourceMinutesSource.deleteMany({ where: { siteKey: fixture.siteKey } });
  await db().productionScheduleGrindingPlanningBoardResourcePartMinutes.deleteMany({ where: { siteKey: fixture.siteKey } });
  if (fixture.splitIds.length > 0) {
    await db().productionScheduleOrderSplitAssignment.deleteMany({ where: { splitId: { in: fixture.splitIds } } });
    await db().productionScheduleOrderSplit.deleteMany({ where: { id: { in: fixture.splitIds } } });
  }
  await db().productionScheduleProgress.deleteMany({ where: { csvDashboardRowId: { in: fixture.rowIds } } });
  await db().productionScheduleExternalCompletion.deleteMany({ where: { csvDashboardRowId: { in: fixture.rowIds } } });
  await db().productionScheduleOrderSupplement.deleteMany({ where: { csvDashboardRowId: { in: fixture.rowIds } } });
  await db().csvDashboardRow.deleteMany({ where: { id: { in: fixture.rowIds } } });
}

function projectionInput(fixture: { rows: SummaryRow[]; splitIdsByParentRow: Map<string, string[]> }): {
  rows: GrindingPlanningBoardProjectionRow[];
  details: Map<string, GrindingPlanningBoardProjectionRowDetail>;
  overrides: Map<string, GrindingPlanningBoardProjectionOverride>;
} {
  const splitUpdatedAt = new Date('2026-09-09T00:00:00.000Z');
  const rows = fixture.rows.map((row) => ({
    id: row.id,
    updatedAt: splitUpdatedAt,
    rowData: row.data
  }));
  const details = new Map(fixture.rows.map((row) => [row.id, {
    updatedAt: splitUpdatedAt,
    rowNotes: [{ dueDate: null }],
    orderSupplements: [{ plannedQuantity: row.plannedQuantity, plannedEndDate: null }],
    productionScheduleProgress: { isCompleted: row.completed, updatedAt: splitUpdatedAt },
    productionScheduleExternalCompletion: { isExternallyCompleted: row.externallyCompleted, updatedAt: splitUpdatedAt },
    orderSplits: (fixture.splitIdsByParentRow.get(row.id) ?? []).map((id, index) => ({
      id,
      splitQuantity: row.splitQuantities[index]!,
      dueDate: null,
      updatedAt: splitUpdatedAt
    }))
  }] as [string, GrindingPlanningBoardProjectionRowDetail]));
  const movedParent = fixture.rows.find((row) => String(row.data.FSEIBAN).endsWith('-A'))!;
  const movedSplitId = fixture.splitIds[0]!;
  const emptyOverrideRow = fixture.rows.find((row) => row.data.FSEIBAN?.endsWith('-E'))!;
  const quotedKeyRow = fixture.rows.find((row) => row.data.FSEIBAN?.includes("Q '"))!;
  const overrides = new Map<string, GrindingPlanningBoardProjectionOverride>([
    [buildGrindingPlanningBoardRowItemId(movedParent.data), { overrideResourceCd: 'G-02', overrideDueDate: null, alternateRank: null, version: 1 }],
    [`split:${movedSplitId}`, { overrideResourceCd: 'G-02', overrideDueDate: null, alternateRank: null, version: 1 }],
    [buildGrindingPlanningBoardRowItemId(emptyOverrideRow.data), { overrideResourceCd: '', overrideDueDate: null, alternateRank: null, version: 1 }],
    [buildGrindingPlanningBoardRowItemId(quotedKeyRow.data), { overrideResourceCd: 'G-02', overrideDueDate: null, alternateRank: null, version: 1 }]
  ]);
  return { rows, details, overrides };
}

describeIntegration('grinding planning board lightweight load summary integration', () => {
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

  it('disables JIT on the aggregate connection and restores it after the root transaction', async () => {
    const fixture = await createFixture();
    const { createPrismaClient } = await import('../../../lib/prisma-client.js');
    const singleUrl = new URL(testDatabaseUrl);
    singleUrl.searchParams.set('connection_limit', '1');
    const single = createPrismaClient(singleUrl.toString());
    const settings = async (client: Prisma.TransactionClient) =>
      (await client.$queryRaw<Array<{ pid: number; jit: string }>>`SELECT pg_backend_pid() AS pid, current_setting('jit') AS jit`)[0]!;
    const transaction = single.$transaction.bind(single);
    let during: { pid: number; jit: string } | undefined;
    const spy = vi.spyOn(single, '$transaction').mockImplementationOnce(((read: (tx: Prisma.TransactionClient) => Promise<unknown>, options: object) =>
      transaction(async (tx) => {
        const query = tx.$queryRaw.bind(tx);
        const querySpy = vi.spyOn(tx, '$queryRaw').mockImplementation((async (...args: Parameters<typeof tx.$queryRaw>) => {
          if ('sql' in args[0] && args[0].sql.includes('effectiveItems')) during = await settings(tx);
          return query(...args);
        }) as typeof tx.$queryRaw);
        try { return await read(tx); } finally { querySpy.mockRestore(); }
      }, options)) as typeof single.$transaction);
    try {
      await single.$executeRaw`SET jit = on`;
      const before = await settings(single);
      expect(before.jit).toBe('on');
      await summaryReader()({ client: single, siteKey: fixture.siteKey, category: 'grinding',
        resourceMinutes: { ownSourceResourceCds: [], values: [] },
        leaderboardMaterializedBaseWhere: Prisma.sql`"CsvDashboardRow"."id" = ANY(${fixture.rowIds}::text[])`,
        isResourceInCategory: () => true });
      expect(during).toEqual({ pid: before.pid, jit: 'off' });
      expect(await settings(single)).toEqual(before);
    } finally { spy.mockRestore(); await single.$disconnect(); }
  });

  it('matches the former direct-query aggregate and full response with identical data', async () => {
    const fixture = await createFixture();
    const params = { siteKey: fixture.siteKey, category: 'grinding' as const,
      resourceMinutes: { ownSourceResourceCds: [], values: [] },
      leaderboardMaterializedBaseWhere: Prisma.sql`"CsvDashboardRow"."id" = ANY(${fixture.rowIds}::text[])`,
      isResourceInCategory: () => true };
    let aggregateSql: Prisma.Sql | undefined;
    let directRows: unknown;
    // Reproduce the former execution: no transaction and a direct $queryRaw.
    const directClient = {
      $executeRaw: (async () => 0) as PrismaClient['$executeRaw'],
      async $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<T> {
        const rows = await db().$queryRaw<T>(query, ...values);
        if ('sql' in query && query.sql.includes('effectiveItems')) { aggregateSql = query; directRows = rows; }
        return rows;
      }
    };
    const direct = await summaryReader()({ ...params, client: directClient });
    const current = await summaryReader()({ ...params, client: db() });
    expect(current).toEqual(direct);
    expect(current.load.length).toBeGreaterThan(0);
    expect(aggregateSql).toBeDefined();
    const transactionRows = await db().$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL jit = off`;
      return tx.$queryRaw(aggregateSql!);
    }, { timeout: 120_000, maxWait: 15_000 });
    // GROUP BY has no ordering contract; retain duplicate rows when comparing.
    const ordered = (rows: unknown[]) => rows.map((row) => JSON.stringify(row, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value)).sort();
    expect(ordered(transactionRows as unknown[])).toEqual(ordered(directRows as unknown[]));
  });

  it.each([
    { name: 'row match', fseiban: 'ORDER', productNo: 'P1', overrideProductNo: 'other', split: false, resources: ['G-02'], movedCount: 1 },
    { name: 'masked order product match', fseiban: '********', productNo: 'P1', overrideProductNo: 'P1', split: false, resources: ['G-02'], movedCount: 1 },
    { name: 'masked order product mismatch', fseiban: '********', productNo: 'P1', overrideProductNo: 'other', split: false, resources: ['G-02'], movedCount: 0 },
    { name: 'NULL order retains the product residual', fseiban: null, productNo: 'P1', overrideProductNo: 'P1', split: false, resources: ['G-02'], movedCount: 0 },
    { name: 'NULL order and NULL product retain the product residual', fseiban: null, productNo: null, overrideProductNo: '', split: false, resources: ['G-02'], movedCount: 0 },
    { name: 'empty order matches without a product', fseiban: '', productNo: 'P1', overrideProductNo: 'other', split: false, resources: ['G-02'], movedCount: 1 },
    { name: 'split match', fseiban: 'ORDER', productNo: 'P1', overrideProductNo: 'P1', split: true, resources: ['G-02'], movedCount: 0 },
    { name: 'two matching row overrides', fseiban: 'ORDER', productNo: 'P1', overrideProductNo: 'P1', split: false, resources: ['G-02', 'G-02'], movedCount: 2 },
    { name: 'two matching split overrides', fseiban: 'ORDER', productNo: 'P1', overrideProductNo: 'P1', split: true, resources: ['G-02', 'G-02'], movedCount: 0 },
    { name: 'NULL resource falls back to original', fseiban: 'ORDER', productNo: 'P1', overrideProductNo: 'P1', split: false, resources: [null], movedCount: 0 },
    { name: 'NULL split resource falls back to original', fseiban: 'ORDER', productNo: 'P1', overrideProductNo: 'P1', split: true, resources: [null], movedCount: 0 },
    { name: 'NULL resource preserves duplicate matches', fseiban: 'ORDER', productNo: 'P1', overrideProductNo: 'P1', split: false, resources: [null, 'G-02'], movedCount: 1 }
  ])('preserves override join semantics: $name', async (spec) => {
    const siteKey = `it-${randomUUID().slice(0, 8)}`;
    const rowData = {
      FSEIBAN: spec.fseiban, ProductNo: spec.productNo,
      FHINCD: 'PART', FSIGENCD: 'G-01', FKOJUN: '1', FSIGENSHOYORYO: '10'
    };
    const created = await db().csvDashboardRow.create({
      data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: new Date(),
        dataHash: randomUUID(), rowData },
      select: { id: true }
    });
    const fixture = { siteKey, rowIds: [created.id], splitIds: [] as string[] };
    fixtures.push(fixture);
    if (spec.split) {
      await db().productionScheduleOrderSupplement.create({
        data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: created.id,
          sourceCsvDashboardId: siteKey, productNo: 'P1', resourceCd: 'G-01', processOrder: '1', plannedQuantity: 1 }
      });
      const split = await db().productionScheduleOrderSplit.create({
        data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, parentCsvDashboardRowId: created.id,
          splitNo: 1, splitQuantity: 1 },
        select: { id: true }
      });
      fixture.splitIds.push(split.id);
    }
    const rowItemKey = buildGrindingPlanningBoardRowItemId({ ...rowData, ProductNo: spec.overrideProductNo });
    const splitItemKey = `split:${fixture.splitIds[0] ?? 'unmatched'}`;
    // Supply duplicate bindings at the reader boundary: persisted item keys are unique.
    // Both kinds are present to catch accidental cross-kind matches; the aggregate SQL runs in Postgres.
    const overrideRows = [
      ...spec.resources.map((overrideResourceCd) => ({
        itemKey: spec.split ? splitItemKey : rowItemKey, overrideResourceCd
      })),
      { itemKey: spec.split ? rowItemKey : splitItemKey, overrideResourceCd: spec.split ? null : 'G-99' }
    ];
    const client = {
      $executeRaw: db().$executeRaw.bind(db()),
      $transaction: db().$transaction.bind(db()),
      async $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<T> {
        if ('sql' in query && !query.sql.includes('"effectiveItems"')) return overrideRows as T;
        return db().$queryRaw<T>(query, ...values);
      }
    };
    const summary = await summaryReader()({
      client, siteKey, category: 'grinding',
      leaderboardMaterializedBaseWhere: Prisma.sql`"CsvDashboardRow"."id" = ${created.id}`,
      isResourceInCategory: (resourceCd, category) => category === 'grinding' && resourceCd.startsWith('G-')
    });
    const itemCount = spec.split ? 1 : spec.resources.length;
    expect(summary.load.find((entry) => entry.resourceCd === 'G-01')).toMatchObject({
      originalItemCount: itemCount, originalRequiredMinutes: 10 * itemCount,
      alternateItemCount: itemCount - spec.movedCount, alternateRequiredMinutes: 10 * (itemCount - spec.movedCount)
    });
    if (spec.movedCount > 0) {
      expect(summary.load.find((entry) => entry.resourceCd === 'G-02')).toMatchObject({
        originalItemCount: 0, originalRequiredMinutes: 0,
        alternateItemCount: spec.movedCount, alternateRequiredMinutes: 10 * spec.movedCount
      });
    }
    expect(summary.load.map((entry) => entry.resourceCd)).toEqual(spec.movedCount > 0 ? ['G-01', 'G-02'] : ['G-01']);
    expect(summary.unknownRequiredMinutesCount).toBe(0);
  });

  it('counts separate unassigned orders and applies only the matching order override', async () => {
    const siteKey = `it-${randomUUID().slice(0, 8)}`;
    const base = { FSEIBAN: '********', FHINCD: 'MASKED-PART', FSIGENCD: 'G-01', FKOJUN: '230' };
    const first = await db().csvDashboardRow.create({
      data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: new Date(),
        dataHash: randomUUID(), rowData: { ...base, ProductNo: '0003729969', FSIGENSHOYORYO: '10' } }
    });
    const second = await db().csvDashboardRow.create({
      data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: new Date(),
        dataHash: randomUUID(), rowData: { ...base, ProductNo: '0004104427', FSIGENSHOYORYO: '20' } }
    });
    fixtures.push({ siteKey, rowIds: [first.id, second.id], splitIds: [] });
    await db().productionScheduleGrindingPlanningBoardOverride.create({
      data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey,
        itemKey: buildGrindingPlanningBoardRowItemId(first.rowData), overrideResourceCd: 'G-02' }
    });
    const params = { client: db(), siteKey, category: 'grinding' as const,
      isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) =>
        category === 'grinding' && resourceCd.startsWith('G-') };
    const aggregate = await summaryReader()({ ...params,
      leaderboardMaterializedBaseWhere: Prisma.sql`
        "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "CsvDashboardRow"."id" IN (${first.id}, ${second.id})` });
    const fallback = await summaryReader()({ ...params, winnerRowIds: [first.id, second.id] });

    expect(aggregate).toEqual(fallback);
    expect(aggregate.load.find((entry) => entry.resourceCd === 'G-01')).toMatchObject({
      originalItemCount: 2, originalRequiredMinutes: 30, alternateItemCount: 1, alternateRequiredMinutes: 20
    });
    expect(aggregate.load.find((entry) => entry.resourceCd === 'G-02')).toMatchObject({
      alternateItemCount: 1, alternateRequiredMinutes: 10
    });
  });

  it('resolves stored own values identically in SQL, fallback and projection, including split setup and unknown CSV', async () => {
    const fixture = await createFixture();
    const rows = fixture.rows.filter((row) => /-PART-[DE]$/.test(row.data.FHINCD!));
    const splitRow = rows.find((row) => row.splitQuantities.length > 0)!;
    const pieceSet = await db().productionScheduleSessakuPieceSet.create({ data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: splitRow.data.FSEIBAN!, fhincd: splitRow.data.FHINCD!,
      fsigencd: splitRow.data.FSIGENCD!, fkojun: splitRow.data.FKOJUN!, plannedQuantity: 5,
      pieces: { create: [2, 3].map((quantity, position) => ({ quantity, position })) }
    } });
    try {
      const scope = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: fixture.siteKey };
      await db().productionScheduleGrindingPlanningBoardResourceMinutesSource.create({ data: { ...scope, resourceCd: 'G-02', source: 'own' } });
      for (const row of rows) {
        await db().productionScheduleGrindingPlanningBoardResourcePartMinutes.create({ data: {
          ...scope, resourceCd: 'G-02', fhincd: row.data.FHINCD!, perUnitMinutes: 10, setupMinutes: 30
        } });
        await db().productionScheduleGrindingPlanningBoardOverride.create({ data: {
          ...scope, itemKey: buildGrindingPlanningBoardRowItemId(row.data), overrideResourceCd: 'G-02'
        } });
      }
      const params = { client: db(), siteKey: fixture.siteKey, category: 'grinding' as const, isResourceInCategory: () => true };
      const ids = rows.map((row) => row.id);
      const fallback = await summaryReader()({ ...params, winnerRowIds: ids });
      const aggregate = await summaryReader()({ ...params, leaderboardMaterializedBaseWhere: Prisma.sql`
        "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "CsvDashboardRow"."id" IN (${Prisma.join(ids)})` });
      expect(aggregate).toEqual(fallback);
      expect(aggregate.unknownRequiredMinutesCount).toBe(0);
      expect(aggregate.load.find((entry) => entry.resourceCd === 'G-02')).toMatchObject({ requiredMinutes: 190, unfinishedItemCount: 3 });
      const { getGrindingPlanningBoardResourceMinutes } = await import('../grinding-planning-board-resource-minutes.service.js');
      const input = projectionInput({ ...fixture, rows });
      for (const row of rows) input.overrides.set(buildGrindingPlanningBoardRowItemId(row.data), {
        overrideResourceCd: 'G-02', overrideDueDate: null, alternateRank: null, version: 1
      });
      const projection = projectGrindingPlanningBoard({ ...input, category: 'grinding', seibanOrder: [], ranks: { rows: new Map() },
        includePieces: true, pieceSets: await readSessakuPieceSets(db(), input.rows),
        resourceMinutes: await getGrindingPlanningBoardResourceMinutes({ siteKey: fixture.siteKey }) });
      expect(projection.load).toEqual(aggregate.load);
      const otherSite = await summaryReader()({ ...params, siteKey: `${fixture.siteKey}-other`, winnerRowIds: ids });
      expect(otherSite.unknownRequiredMinutesCount).toBe(1);
      expect(otherSite.load[0]?.requiredMinutes).toBe(100);
    } finally {
      await db().productionScheduleSessakuPieceSet.delete({ where: { id: pieceSet.id } });
    }
  });

  it('reads minimal source columns, applies override/split/completion rules, and equals full projection load', async () => {
    const fixture = await createFixture();
    const movedParent = fixture.rows.find((row) => String(row.data.FSEIBAN).endsWith('-A'))!;
    await db().productionScheduleGrindingPlanningBoardOverride.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey: fixture.siteKey,
        itemKey: buildGrindingPlanningBoardRowItemId(movedParent.data),
        overrideResourceCd: 'G-02'
      }
    });
    await db().productionScheduleGrindingPlanningBoardOverride.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey: fixture.siteKey,
        itemKey: `split:${fixture.splitIds[0]}`,
        overrideResourceCd: 'G-02'
      }
    });
    const emptyOverrideRow = fixture.rows.find((row) => row.data.FSEIBAN?.endsWith('-E'))!;
    const quotedKeyRow = fixture.rows.find((row) => row.data.FSEIBAN?.includes("Q '"))!;
    const nonCanonicalOverrideKey = `${buildGrindingPlanningBoardRowItemId(quotedKeyRow.data)}=`;
    await db().productionScheduleGrindingPlanningBoardOverride.createMany({
      data: [
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          siteKey: fixture.siteKey,
          itemKey: buildGrindingPlanningBoardRowItemId(emptyOverrideRow.data),
          overrideResourceCd: ''
        },
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          siteKey: fixture.siteKey,
          itemKey: buildGrindingPlanningBoardRowItemId(quotedKeyRow.data),
          overrideResourceCd: 'G-02'
        },
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          siteKey: `${fixture.siteKey}-other`,
          itemKey: buildGrindingPlanningBoardRowItemId(quotedKeyRow.data),
          overrideResourceCd: 'G-03'
        },
        {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          siteKey: fixture.siteKey,
          itemKey: nonCanonicalOverrideKey,
          overrideResourceCd: 'G-03'
        }
      ]
    });

    const summaryParams = {
      client: db(),
      siteKey: fixture.siteKey,
      category: 'grinding' as const,
      isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => category === 'grinding' && resourceCd.startsWith('G-')
    };
    const summary = await summaryReader()({
      ...summaryParams,
      leaderboardMaterializedBaseWhere: buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(
        PRODUCTION_SCHEDULE_DASHBOARD_ID,
        fixture.rowIds
      )
    });
    const fallbackSummary = await summaryReader()({
      ...summaryParams,
      winnerRowIds: fixture.rowIds
    });
    expect(summary).toEqual(fallbackSummary);

    const summaryWithoutSplits = await summaryReader()({
      ...summaryParams,
      leaderboardMaterializedBaseWhere: buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(
        PRODUCTION_SCHEDULE_DASHBOARD_ID,
        fixture.rowIds
      )
    });
    const fallbackSummaryWithoutSplits = await summaryReader()({
      ...summaryParams,
      winnerRowIds: fixture.rowIds
    });
    expect(summaryWithoutSplits).toEqual(fallbackSummaryWithoutSplits);
    const full = projectGrindingPlanningBoard({
      ...projectionInput(fixture),
      ranks: { rows: new Map() },
      category: 'grinding',
      seibanOrder: fixture.rows.map((row) => String(row.data.FSEIBAN)),
      isResourceInCategory: (resourceCd, category) => category === 'grinding' && resourceCd.startsWith('G-')
    });

    expect(summary.load).toEqual(full.load);
    expect(summary.unknownRequiredMinutesCount).toBe(full.unknownRequiredMinutesCount);
    expect(summary.load.find((entry) => entry.resourceCd === 'G-01')).toMatchObject({
      originalItemCount: 9,
      alternateItemCount: 6,
      originalRequiredMinutes: 224,
      alternateRequiredMinutes: 112
    });
    expect(summary.load.find((entry) => entry.resourceCd === 'G-02')).toMatchObject({
      originalItemCount: 1,
      alternateItemCount: 3,
      originalRequiredMinutes: 40,
      alternateRequiredMinutes: 152
    });
    expect(summary.unknownRequiredMinutesCount).toBe(3);
  });

  it('keeps global load rows outside the registered winner ids', async () => {
    const fixture = await createFixture();
    const globalOnly = await db().csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date('2026-09-09T00:00:00.000Z'),
        dataHash: `${fixture.siteKey}-global-${randomUUID()}`,
        rowData: {
          FSEIBAN: `${fixture.siteKey}-unregistered`,
          FHINCD: `${fixture.siteKey}-GLOBAL-PART`,
          FSIGENCD: 'G-03',
          FKOJUN: '99',
          ProductNo: `${fixture.siteKey}-GLOBAL-PRODUCT`,
          FSIGENSHOYORYO: '7'
        }
      },
      select: { id: true }
    });
    fixture.rowIds.push(globalOnly.id);

    const summary = await summaryReader()({
      client: db(),
      siteKey: fixture.siteKey,
      category: 'grinding',
      leaderboardMaterializedBaseWhere: Prisma.sql`
        "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      `,
      isResourceInCategory: (resourceCd, category) => category === 'grinding' && resourceCd.startsWith('G-')
    });

    expect(summary.load.find((entry) => entry.resourceCd === 'G-03')).toMatchObject({
      originalItemCount: 1,
      alternateItemCount: 1,
      originalRequiredMinutes: 7,
      alternateRequiredMinutes: 7
    });
  });

  it.each(['0', null])('matches SQL, TypeScript and projection for pieces of a %s-minute parent', async (minutes) => {
    const fixture = await createFixture();
    const row = fixture.rows.find((entry) => String(entry.data.FSEIBAN).endsWith('-D'))!;
    row.data = { ...row.data, FSIGENSHOYORYO: minutes };
    await db().csvDashboardRow.update({ where: { id: row.id }, data: { rowData: row.data } });
    const pieceSet = await db().productionScheduleSessakuPieceSet.create({ data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      fseiban: row.data.FSEIBAN!, fhincd: row.data.FHINCD!, fsigencd: row.data.FSIGENCD!, fkojun: row.data.FKOJUN!,
      plannedQuantity: 5, nextPosition: 3,
      pieces: { create: [2, 3].map((quantity, index) => ({ quantity, position: index + 1 })) }
    } });
    try {
      const params = { client: db(), siteKey: fixture.siteKey, category: 'grinding' as const,
        isResourceInCategory: (resourceCd: string) => resourceCd.startsWith('G-') };
      const sql = await summaryReader()({ ...params,
        leaderboardMaterializedBaseWhere: buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(
          PRODUCTION_SCHEDULE_DASHBOARD_ID, [row.id]) });
      const enumeration = await summaryReader()({ ...params, winnerRowIds: [row.id] });
      const input = projectionInput(fixture); input.rows = input.rows.filter((entry) => entry.id === row.id); input.overrides = new Map();
      const projection = projectGrindingPlanningBoard({ ...input, includePieces: true,
        pieceSets: await readSessakuPieceSets(db(), input.rows), ranks: { rows: new Map() },
        category: 'grinding', seibanOrder: [row.data.FSEIBAN!], isResourceInCategory: params.isResourceInCategory });
      expect(projection.items).toHaveLength(2);
      for (const item of projection.items) expect(item).toMatchObject({ kind: 'piece', requiredMinutes: null, requiredMinutesKnown: false });
      expect(sql).toEqual(enumeration);
      expect(sql.load).toEqual(projection.load);
      expect(sql.unknownRequiredMinutesCount).toBe(2);
      expect(sql.load[0]).toMatchObject({ originalItemCount: 2, alternateItemCount: 2, requiredMinutes: null, unknownItemCount: 2 });
    } finally {
      await db().productionScheduleSessakuPieceSet.delete({ where: { id: pieceSet.id } });
    }
  });

  it('sums three fractional sibling pieces in the same stable order in SQL and TypeScript', async () => {
    const fixture = await createFixture();
    const row = fixture.rows.find((entry) => String(entry.data.FSEIBAN).endsWith('-D'))!;
    await db().csvDashboardRow.update({ where: { id: row.id }, data: { rowData: { ...row.data, FSIGENSHOYORYO: '1' } } });
    await db().productionScheduleOrderSupplement.updateMany({ where: { csvDashboardRowId: row.id }, data: { plannedQuantity: 7 } });
    const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
    const pieceSet = await db().productionScheduleSessakuPieceSet.create({ data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      fseiban: row.data.FSEIBAN!, fhincd: row.data.FHINCD!, fsigencd: row.data.FSIGENCD!, fkojun: row.data.FKOJUN!,
      plannedQuantity: 7, nextPosition: 4,
      pieces: { create: [1, 2, 4].map((quantity, index) => ({ id: ids[index], quantity, position: index + 1 })).reverse() }
    } });
    try {
      const params = { client: db(), siteKey: fixture.siteKey, category: 'grinding' as const,
        isResourceInCategory: (resourceCd: string) => resourceCd.startsWith('G-') };
      const sql = await summaryReader()({ ...params,
        leaderboardMaterializedBaseWhere: buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(
          PRODUCTION_SCHEDULE_DASHBOARD_ID, [row.id]) });
      const typescript = await summaryReader()({ ...params, winnerRowIds: [row.id] });
      expect(sql).toEqual(typescript);
      expect(sql.load).toHaveLength(1);
      expect(sql.load[0]).toMatchObject({ originalItemCount: 3, alternateItemCount: 3, requiredMinutes: 1 / 7 + 2 / 7 + 4 / 7 });
    } finally {
      await db().productionScheduleSessakuPieceSet.delete({ where: { id: pieceSet.id } });
    }
  });

  it('matches op-bar source durations and range completion across both load paths', async () => {
    const fixture = await createFixture();
    const row = fixture.rows[0]!;
    const pieceId = randomUUID();
    const pieceSet = await db().productionScheduleSessakuPieceSet.create({ data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      fseiban: row.data.FSEIBAN!, fhincd: row.data.FHINCD!, fsigencd: row.data.FSIGENCD!, fkojun: row.data.FKOJUN!,
      plannedQuantity: 1, nextPosition: 2,
      pieces: { create: [{ id: pieceId, quantity: 1, position: 1,
        opSplits: { create: [{ fromOpNo: 2, sourceResourceCd: 'G-02', leadingSourceResourceCd: 'G-01' }] } }] }
    } });
    try {
      await db().productionScheduleGrindingPlanningBoardOverride.create({ data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: fixture.siteKey,
        itemKey: `pieceops:${pieceId}:2`, overrideResourceCd: 'G-03'
      } });
      const resourceMinutes = { ownSourceResourceCds: [], values: [
        { resourceCd: 'G-01', fhincd: row.data.FHINCD!, perUnitMinutes: 30, setupMinutes: 7,
          ops: [{ opNo: 1, minutes: 10, setupMinutes: 3 }, { opNo: 2, minutes: 20, setupMinutes: 4 }] },
        { resourceCd: 'G-02', fhincd: row.data.FHINCD!, perUnitMinutes: 70, setupMinutes: 11,
          ops: [{ opNo: 1, minutes: 30, setupMinutes: 5 }, { opNo: 2, minutes: 40, setupMinutes: 6 }] }
      ] };
      const params = { client: db(), siteKey: fixture.siteKey, category: 'grinding' as const, resourceMinutes,
        isResourceInCategory: (resourceCd: string) => resourceCd.startsWith('G-') };
      for (const tailCompleted of [false, true]) {
        if (tailCompleted) await db().productionScheduleSessakuPieceOpCompletion.create({ data: { pieceId, opNo: 2 } });
        const sql = await summaryReader()({ ...params,
          leaderboardMaterializedBaseWhere: buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(
            PRODUCTION_SCHEDULE_DASHBOARD_ID, [row.id]) });
        const enumeration = await summaryReader()({ ...params, winnerRowIds: [row.id] });
        expect(sql).toEqual(enumeration);
        expect(sql.load).toEqual([
          expect.objectContaining({ resourceCd: 'G-01', originalItemCount: tailCompleted ? 1 : 2, requiredMinutes: 13 }),
          ...(!tailCompleted ? [expect.objectContaining({ resourceCd: 'G-03', requiredMinutes: 46 })] : [])
        ]);
      }
    } finally {
      await db().productionScheduleSessakuPieceSet.delete({ where: { id: pieceSet.id } });
    }
  });

  it('matches SQL, row enumeration and projection for multiple rows of fractional pieces', async () => {
    const fixture = await createFixture();
    const rows = fixture.rows.filter((entry) => ['A', 'D'].some((suffix) => String(entry.data.FHINCD).endsWith(`-${suffix}`)))
      .sort((left, right) => left.id < right.id ? 1 : -1);
    const sets: string[] = [];
    try {
      for (const [rowIndex, row] of rows.entries()) {
        row.data = { ...row.data, FSIGENSHOYORYO: rowIndex === 0 ? '1' : '10' };
        row.plannedQuantity = 7;
        await db().csvDashboardRow.update({ where: { id: row.id }, data: { rowData: row.data } });
        await db().productionScheduleOrderSupplement.updateMany({ where: { csvDashboardRowId: row.id }, data: { plannedQuantity: 7 } });
        // Reverse piece insertion and positions as well as the source-row request order.
        const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
        const set = await db().productionScheduleSessakuPieceSet.create({ data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          fseiban: row.data.FSEIBAN!, fhincd: row.data.FHINCD!, fsigencd: row.data.FSIGENCD!, fkojun: row.data.FKOJUN!,
          plannedQuantity: 7, nextPosition: 4,
          pieces: { create: [1, 2, 4].map((quantity, index) => ({ id: ids[index], quantity, position: 3 - index })).reverse() }
        } });
        sets.push(set.id);
      }
      const rowIds = rows.map((row) => row.id);
      const params = { client: db(), siteKey: fixture.siteKey, category: 'grinding' as const,
        isResourceInCategory: (resourceCd: string) => resourceCd.startsWith('G-') };
      const sql = await summaryReader()({ ...params,
        leaderboardMaterializedBaseWhere: buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(
          PRODUCTION_SCHEDULE_DASHBOARD_ID, rowIds) });
      const enumeration = await summaryReader()({ ...params, winnerRowIds: rowIds });
      const input = projectionInput(fixture);
      input.rows = input.rows.filter((row) => rowIds.includes(row.id));
      input.overrides = new Map();
      const projection = projectGrindingPlanningBoard({ ...input, includePieces: true,
        pieceSets: await readSessakuPieceSets(db(), input.rows), ranks: { rows: new Map() },
        category: 'grinding', seibanOrder: rows.map((row) => String(row.data.FSEIBAN)),
        isResourceInCategory: params.isResourceInCategory });
      expect(sql).toEqual(enumeration);
      expect(sql.load).toEqual(projection.load);
      expect(sql.load[0]).toMatchObject({ originalItemCount: 6, alternateItemCount: 6 });
    } finally {
      await db().productionScheduleSessakuPieceSet.deleteMany({ where: { id: { in: sets } } });
    }
  });

  it('keeps logical first-winner order while merging normalized resources and category-external overrides', async () => {
    const prefix = `it-${randomUUID().slice(0, 6)}-dedup`;
    const siteKey = `${prefix}-site`;
    const rows = await Promise.all([
      db().csvDashboardRow.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date('2026-09-09T00:00:00.000Z'),
          dataHash: `${prefix}-duplicate-a`,
          rowData: { FSEIBAN: `${prefix}-same`, FHINCD: `${prefix}-part`, FSIGENCD: ' g-01 ', FKOJUN: '1', ProductNo: `${prefix}-p-a`, FSIGENSHOYORYO: '10' }
        },
        select: { id: true }
      }),
      db().csvDashboardRow.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date('2026-09-09T00:00:00.000Z'),
          dataHash: `${prefix}-duplicate-b`,
          rowData: { FSEIBAN: `${prefix}-same`, FHINCD: `${prefix}-part`, FSIGENCD: ' g-01 ', FKOJUN: '1', ProductNo: `${prefix}-p-b`, FSIGENSHOYORYO: '20' }
        },
        select: { id: true }
      }),
      db().csvDashboardRow.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date('2026-09-09T00:00:00.000Z'),
          dataHash: `${prefix}-normalized`,
          rowData: { FSEIBAN: `${prefix}-normalized`, FHINCD: `${prefix}-part-2`, FSIGENCD: ' g-01 ', FKOJUN: '2', ProductNo: `${prefix}-p-c`, FSIGENSHOYORYO: '3' }
        },
        select: { id: true }
      }),
      db().csvDashboardRow.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date('2026-09-09T00:00:00.000Z'),
          dataHash: `${prefix}-override`,
          rowData: { FSEIBAN: `${prefix}-override`, FHINCD: `${prefix}-part-3`, FSIGENCD: 'G-01', FKOJUN: '3', ProductNo: `${prefix}-p-d`, FSIGENSHOYORYO: '4' }
        },
        select: { id: true }
      })
    ]);
    const rowIds = rows.map((row) => row.id).sort();
    const duplicateRows = rows.slice(0, 2);
    for (const row of rows) {
      await db().productionScheduleOrderSupplement.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          csvDashboardRowId: row.id,
          sourceCsvDashboardId: prefix,
          productNo: `${prefix}-${rows.indexOf(row)}`,
          resourceCd: 'G-01',
          processOrder: '1',
          plannedQuantity: 1
        }
      });
    }
    const overrideRow = rows[3]!;
    await db().productionScheduleGrindingPlanningBoardOverride.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey,
        itemKey: buildGrindingPlanningBoardRowItemId({ FSEIBAN: `${prefix}-override`, FHINCD: `${prefix}-part-3`, FSIGENCD: 'G-01', FKOJUN: '3' }),
        overrideResourceCd: 'C-99'
      }
    });
    fixtures.push({ siteKey, rowIds, splitIds: [] });

    const summaryParams = {
      client: db(),
      siteKey,
      category: 'grinding' as const,
      isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => category === 'grinding' && resourceCd.startsWith('G-')
    };
    const materializedWhere = buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(
      PRODUCTION_SCHEDULE_DASHBOARD_ID,
      rowIds
    );
    const summary = await summaryReader()({ ...summaryParams, leaderboardMaterializedBaseWhere: materializedWhere });
    const fallbackSummary = await summaryReader()({ ...summaryParams, winnerRowIds: rowIds });
    expect(summary).toEqual(fallbackSummary);

    const firstDuplicateId = duplicateRows.map((row) => row.id).sort()[0]!;
    const firstDuplicateMinutes = firstDuplicateId === duplicateRows[0]!.id ? 10 : 20;
    expect(summary.load.find((entry) => entry.resourceCd === 'G-01')).toMatchObject({
      originalItemCount: 3,
      alternateItemCount: 2,
      originalRequiredMinutes: firstDuplicateMinutes + 3 + 4,
      alternateRequiredMinutes: firstDuplicateMinutes + 3
    });
    expect(summary.load.find((entry) => entry.resourceCd === 'C-99')).toMatchObject({
      originalItemCount: 0,
      alternateItemCount: 1,
      originalRequiredMinutes: 0,
      alternateRequiredMinutes: 4,
      requiredMinutes: 4
    });
  });
});
