import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { GrindingPlanningBoardProjectionOverride, GrindingPlanningBoardProjectionRow, GrindingPlanningBoardProjectionRowDetail } from '../grinding-planning-board-projection.js';
import { buildGrindingPlanningBoardRowItemId, projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
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
      splitEnabled: true,
      isResourceInCategory: (resourceCd: string, category: 'grinding' | 'cutting') => category === 'grinding' && resourceCd.startsWith('G-')
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
      splitEnabled: false,
      leaderboardMaterializedBaseWhere: buildProductionScheduleDashboardBaseWhereWithMaterializedMaxProductNoWinners(
        PRODUCTION_SCHEDULE_DASHBOARD_ID,
        fixture.rowIds
      )
    });
    const fallbackSummaryWithoutSplits = await summaryReader()({
      ...summaryParams,
      splitEnabled: false,
      winnerRowIds: fixture.rowIds
    });
    expect(summaryWithoutSplits).toEqual(fallbackSummaryWithoutSplits);
    const full = projectGrindingPlanningBoard({
      ...projectionInput(fixture),
      ranks: { rows: new Map(), splits: new Map() },
      category: 'grinding',
      splitEnabled: true,
      seibanOrder: fixture.rows.map((row) => String(row.data.FSEIBAN)),
      isResourceInCategory: (resourceCd, category) => category === 'grinding' && resourceCd.startsWith('G-')
    });

    expect(summary.load).toEqual(full.load);
    expect(summary.unknownRequiredMinutesCount).toBe(full.unknownRequiredMinutesCount);
    expect(summary.load.find((entry) => entry.resourceCd === 'G-01')).toMatchObject({
      originalItemCount: 10,
      alternateItemCount: 6,
      originalRequiredMinutes: 213,
      alternateRequiredMinutes: 61
    });
    expect(summary.load.find((entry) => entry.resourceCd === 'G-02')).toMatchObject({
      originalItemCount: 1,
      alternateItemCount: 4,
      originalRequiredMinutes: 40,
      alternateRequiredMinutes: 192
    });
    expect(summary.unknownRequiredMinutesCount).toBe(4);
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
      splitEnabled: true,
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
      splitEnabled: true,
      isResourceInCategory: (resourceCd: string, category: 'grinding' | 'cutting') => category === 'grinding' && resourceCd.startsWith('G-')
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
