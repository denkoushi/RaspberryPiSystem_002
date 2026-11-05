import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
} from '../constants.js';

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
type SupplementService = typeof import('../order-supplement-sync.service.js');
let dbClient: PrismaClient | undefined;
let supplementService: SupplementService | undefined;
if (hasDedicatedDatabase) {
  process.env.DATABASE_URL = testDatabaseUrl;
  ({ prisma: dbClient } = await import('../../../lib/prisma.js'));
  supplementService = await import('../order-supplement-sync.service.js');
}
const describeIntegration = hasDedicatedDatabase ? describe : describe.skip;
function db(): PrismaClient {
  if (!dbClient) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return dbClient;
}
function service(): InstanceType<SupplementService['ProductionScheduleOrderSupplementSyncService']> {
  if (!supplementService) throw new Error('TEST_DATABASE_URL must point to a dedicated database');
  return new supplementService.ProductionScheduleOrderSupplementSyncService();
}

const MAIN_DASHBOARD_ID = PRODUCTION_SCHEDULE_DASHBOARD_ID;
const SUPPLEMENT_DASHBOARD_ID = PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID;
const DATA_HASH_PREFIX = 'order-supplement-split-sync';

async function cleanupFixtures(): Promise<void> {
  const rows = await db().csvDashboardRow.findMany({
    where: {
      dataHash: { startsWith: DATA_HASH_PREFIX },
    },
    select: { id: true },
  });
  const rowIds = rows.map((row) => row.id);
  if (rowIds.length === 0) return;

  await db().productionScheduleOrderSplitAssignment.deleteMany({
    where: {
      split: {
        parentCsvDashboardRowId: { in: rowIds },
      },
    },
  });
  await db().productionScheduleOrderSplit.deleteMany({
    where: {
      parentCsvDashboardRowId: { in: rowIds },
    },
  });
  await db().productionScheduleOrderSupplement.deleteMany({
    where: {
      csvDashboardRowId: { in: rowIds },
    },
  });
  await db().csvDashboardRow.deleteMany({
    where: {
      id: { in: rowIds },
    },
  });
}

describeIntegration('order-supplement-sync.service (integration)', () => {
  beforeAll(async () => {
    await db().csvDashboard.upsert({
      where: { id: MAIN_DASHBOARD_ID },
      update: {},
      create: {
        id: MAIN_DASHBOARD_ID,
        name: 'ProductionSchedule_Mishima_Grinding',
        columnDefinitions: [],
        templateType: 'CARD_GRID',
        templateConfig: {},
        ingestMode: 'DEDUP',
        dedupKeyColumns: ['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'],
        dateColumnName: 'registeredAt',
        enabled: true,
      },
    });
    await db().csvDashboard.upsert({
      where: { id: SUPPLEMENT_DASHBOARD_ID },
      update: {},
      create: {
        id: SUPPLEMENT_DASHBOARD_ID,
        name: 'ProductionSchedule_OrderSupplement',
        columnDefinitions: [],
        templateType: 'TABLE',
        templateConfig: {},
        ingestMode: 'DEDUP',
        dedupKeyColumns: ['ProductNo', 'FSIGENCD', 'FKOJUN'],
        dateColumnName: 'registeredAt',
        enabled: true,
      },
    });
  });

  beforeEach(async () => {
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await dbClient?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('旧片が残っていても親の plannedQuantity のみ更新する', async () => {
    const parent = await db().csvDashboardRow.create({
      data: {
        csvDashboardId: MAIN_DASHBOARD_ID,
        occurredAt: new Date('2026-06-20T00:00:00.000Z'),
        dataHash: `${DATA_HASH_PREFIX}-main`,
        rowData: {
          ProductNo: '0003712732',
          FSEIBAN: 'SYNC-SPLIT',
          FHINCD: 'PART-1',
          FSIGENCD: '503',
          FKOJUN: '200',
        },
      },
      select: { id: true },
    });
    await db().csvDashboardRow.create({
      data: {
        csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
        occurredAt: new Date('2026-06-20T00:00:00.000Z'),
        dataHash: `${DATA_HASH_PREFIX}-source`,
        rowData: {
          ProductNo: '0003712732',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '10',
        },
      },
    });
    await db().productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: MAIN_DASHBOARD_ID,
        csvDashboardRowId: parent.id,
        sourceCsvDashboardId: SUPPLEMENT_DASHBOARD_ID,
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
        plannedQuantity: 5,
      },
    });
    await db().productionScheduleOrderSplit.createMany({
      data: [
        {
          csvDashboardId: MAIN_DASHBOARD_ID,
          parentCsvDashboardRowId: parent.id,
          splitNo: 1,
          splitQuantity: 2,
        },
        {
          csvDashboardId: MAIN_DASHBOARD_ID,
          parentCsvDashboardRowId: parent.id,
          splitNo: 2,
          splitQuantity: 3,
        },
      ],
    });

    const result = await service().syncFromSupplementDashboard();

    expect(result.upserted).toBeGreaterThanOrEqual(1);
    const supplement = await db().productionScheduleOrderSupplement.findUnique({
      where: { csvDashboardRowId: parent.id },
      select: { plannedQuantity: true },
    });
    const splits = await db().productionScheduleOrderSplit.findMany({
      where: { parentCsvDashboardRowId: parent.id },
      orderBy: { splitNo: 'asc' },
      select: { splitQuantity: true },
    });
    expect(supplement?.plannedQuantity).toBe(10);
    expect(splits.map((split) => split.splitQuantity)).toEqual([2, 3]);
    expect(splits.reduce((sum, split) => sum + split.splitQuantity, 0)).toBe(5);
  });

  it('既存行ありで補助CSVの plannedQuantity が空なら既存数量と split を維持する', async () => {
    const parent = await db().csvDashboardRow.create({
      data: {
        csvDashboardId: MAIN_DASHBOARD_ID,
        occurredAt: new Date('2026-06-20T00:00:00.000Z'),
        dataHash: `${DATA_HASH_PREFIX}-blank-quantity-main`,
        rowData: {
          ProductNo: '9999999901',
          FSEIBAN: 'SYNC-SPLIT-BLANK',
          FHINCD: 'PART-BLANK',
          FSIGENCD: '503',
          FKOJUN: '200',
        },
      },
      select: { id: true },
    });
    await db().csvDashboardRow.create({
      data: {
        csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
        occurredAt: new Date('2026-06-20T00:00:00.000Z'),
        dataHash: `${DATA_HASH_PREFIX}-blank-quantity-source`,
        rowData: {
          ProductNo: '9999999901',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '',
        },
      },
    });
    await db().productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: MAIN_DASHBOARD_ID,
        csvDashboardRowId: parent.id,
        sourceCsvDashboardId: SUPPLEMENT_DASHBOARD_ID,
        productNo: '9999999901',
        resourceCd: '503',
        processOrder: '200',
        plannedQuantity: 5,
      },
    });
    await db().productionScheduleOrderSplit.createMany({
      data: [
        {
          csvDashboardId: MAIN_DASHBOARD_ID,
          parentCsvDashboardRowId: parent.id,
          splitNo: 1,
          splitQuantity: 2,
        },
        {
          csvDashboardId: MAIN_DASHBOARD_ID,
          parentCsvDashboardRowId: parent.id,
          splitNo: 2,
          splitQuantity: 3,
        },
      ],
    });

    const result = await service().syncFromSupplementDashboard();

    expect(result.upserted).toBeGreaterThanOrEqual(1);
    const supplement = await db().productionScheduleOrderSupplement.findUnique({
      where: { csvDashboardRowId: parent.id },
      select: { plannedQuantity: true },
    });
    const splits = await db().productionScheduleOrderSplit.findMany({
      where: { parentCsvDashboardRowId: parent.id },
      orderBy: { splitNo: 'asc' },
      select: { splitQuantity: true },
    });
    expect(supplement?.plannedQuantity).toBe(5);
    expect(splits.map((split) => split.splitQuantity)).toEqual([2, 3]);
    expect(splits.reduce((sum, split) => sum + split.splitQuantity, 0)).toBe(5);
  });

  it('同一論理キーでは最大ProductNoのwinnerだけを補助行へ照合する', async () => {
    const mainRows = await Promise.all(
      [
        { suffix: 'low', productNo: '1000000001' },
        { suffix: 'high', productNo: '1000000002' },
      ].map(({ suffix, productNo }) =>
        db().csvDashboardRow.create({
          data: {
            csvDashboardId: MAIN_DASHBOARD_ID,
            occurredAt: new Date('2026-06-20T00:00:00.000Z'),
            dataHash: `${DATA_HASH_PREFIX}-winner-${suffix}-main`,
            rowData: {
              ProductNo: productNo,
              FSEIBAN: 'SYNC-WINNER',
              FHINCD: 'PART-WINNER',
              FSIGENCD: '503',
              FKOJUN: '200',
            },
          },
          select: { id: true },
        })
      )
    );

    await db().csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
          occurredAt: new Date('2026-06-20T00:00:00.000Z'),
          dataHash: `${DATA_HASH_PREFIX}-winner-low-source`,
          rowData: {
            ProductNo: '1000000001',
            FSIGENCD: '503',
            FKOJUN: '200',
            plannedQuantity: '1',
          },
        },
        {
          csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
          occurredAt: new Date('2026-06-20T00:00:00.000Z'),
          dataHash: `${DATA_HASH_PREFIX}-winner-high-source`,
          rowData: {
            ProductNo: '1000000002',
            FSIGENCD: '503',
            FKOJUN: '200',
            plannedQuantity: '2',
          },
        },
      ],
    });

    const result = await service().syncFromSupplementDashboard();
    const supplements = await db().productionScheduleOrderSupplement.findMany({
      where: {
        csvDashboardRowId: { in: mainRows.map((row) => row.id) },
      },
      select: {
        csvDashboardRowId: true,
        productNo: true,
        plannedQuantity: true,
      },
    });

    expect(result).toEqual({
      scanned: 2,
      normalized: 2,
      matched: 1,
      unmatched: 1,
      upserted: 1,
      pruned: 0,
    });
    expect(supplements).toEqual([
      {
        csvDashboardRowId: mainRows[1]?.id,
        productNo: '1000000002',
        plannedQuantity: 2,
      },
    ]);
  });

  it('1年超のsource行は未照合だけ削除し、現行日程に残る長期案件は保持する', async () => {
    await db().csvDashboardRow.create({
      data: {
        csvDashboardId: MAIN_DASHBOARD_ID,
        occurredAt: new Date('2026-07-20T00:00:00.000Z'),
        dataHash: `${DATA_HASH_PREFIX}-retention-current-main`,
        rowData: {
          ProductNo: '1000000010',
          FSEIBAN: 'SYNC-RETENTION',
          FHINCD: 'PART-RETENTION',
          FSIGENCD: '503',
          FKOJUN: '200',
        },
      },
    });
    const sourceRows = await Promise.all(
      [
        { suffix: 'current', productNo: '1000000010' },
        { suffix: 'unmatched', productNo: '1000000011' },
      ].map(({ suffix, productNo }) =>
        db().csvDashboardRow.create({
          data: {
            csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
            occurredAt: new Date('2026-07-20T00:00:00.000Z'),
            dataHash: `${DATA_HASH_PREFIX}-retention-${suffix}-source`,
            rowData: {
              ProductNo: productNo,
              FSIGENCD: '503',
              FKOJUN: '200',
              plannedQuantity: '1',
              plannedStartDate: '2024-01-01',
              plannedEndDate: '2024-12-31',
            },
          },
          select: { id: true },
        })
      )
    );

    await service().syncFromSupplementDashboard();

    const retainedRows = await db().csvDashboardRow.findMany({
      where: { id: { in: sourceRows.map((row) => row.id) } },
      select: { id: true },
    });
    expect(retainedRows.map((row) => row.id)).toEqual([sourceRows[0]?.id]);
  });
});
