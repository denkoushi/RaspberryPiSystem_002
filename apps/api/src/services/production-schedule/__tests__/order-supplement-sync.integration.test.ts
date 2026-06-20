import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
} from '../constants.js';
import { ProductionScheduleOrderSupplementSyncService } from '../order-supplement-sync.service.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

const MAIN_DASHBOARD_ID = PRODUCTION_SCHEDULE_DASHBOARD_ID;
const SUPPLEMENT_DASHBOARD_ID = PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID;
const DATA_HASH_PREFIX = 'order-supplement-split-sync';

async function cleanupFixtures(): Promise<void> {
  const rows = await prisma.csvDashboardRow.findMany({
    where: {
      dataHash: { startsWith: DATA_HASH_PREFIX },
    },
    select: { id: true },
  });
  const rowIds = rows.map((row) => row.id);
  if (rowIds.length === 0) return;

  await prisma.productionScheduleOrderSplitAssignment.deleteMany({
    where: {
      split: {
        parentCsvDashboardRowId: { in: rowIds },
      },
    },
  });
  await prisma.productionScheduleOrderSplit.deleteMany({
    where: {
      parentCsvDashboardRowId: { in: rowIds },
    },
  });
  await prisma.productionScheduleOrderSupplement.deleteMany({
    where: {
      csvDashboardRowId: { in: rowIds },
    },
  });
  await prisma.csvDashboardRow.deleteMany({
    where: {
      id: { in: rowIds },
    },
  });
}

describe('order-supplement-sync.service (integration)', () => {
  beforeAll(async () => {
    await prisma.csvDashboard.upsert({
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
    await prisma.csvDashboard.upsert({
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
    await prisma.$disconnect();
  });

  it('plannedQuantity 変更時に split 数量合計を同じ transaction で再配分する', async () => {
    const parent = await prisma.csvDashboardRow.create({
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
    await prisma.csvDashboardRow.create({
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
    await prisma.productionScheduleOrderSupplement.create({
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
    await prisma.productionScheduleOrderSplit.createMany({
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

    const result = await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();

    expect(result.upserted).toBeGreaterThanOrEqual(1);
    const supplement = await prisma.productionScheduleOrderSupplement.findUnique({
      where: { csvDashboardRowId: parent.id },
      select: { plannedQuantity: true },
    });
    const splits = await prisma.productionScheduleOrderSplit.findMany({
      where: { parentCsvDashboardRowId: parent.id },
      orderBy: { splitNo: 'asc' },
      select: { splitQuantity: true },
    });
    expect(supplement?.plannedQuantity).toBe(10);
    expect(splits.map((split) => split.splitQuantity)).toEqual([4, 6]);
    expect(splits.reduce((sum, split) => sum + split.splitQuantity, 0)).toBe(10);
  });
});
