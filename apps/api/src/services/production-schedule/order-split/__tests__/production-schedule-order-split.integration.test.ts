vi.hoisted(() => {
  process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = 'true';
});

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';
import { ApiError } from '../../../../lib/errors.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../constants.js';
import {
  deleteProductionScheduleOrderSplits,
  listProductionScheduleOrderSplitsForParent,
  replaceProductionScheduleOrderSplits,
  upsertProductionScheduleSplitDueDate,
  upsertProductionScheduleSplitOrder
} from '../production-schedule-order-split.service.js';

const DASHBOARD_ID = PRODUCTION_SCHEDULE_DASHBOARD_ID;
const ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID = '8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31';
const LOCATION_KEY = 'SplitServiceTest';
const RESOURCE_CD = '305';

async function findSplitServiceFixtureRowIds(): Promise<string[]> {
  const rows = await prisma.csvDashboardRow.findMany({
    where: { csvDashboardId: DASHBOARD_ID, dataHash: { startsWith: 'split-service-' } },
    select: { id: true }
  });
  return rows.map((row) => row.id);
}

async function cleanupSplitFixtures(): Promise<void> {
  const rowIds = await findSplitServiceFixtureRowIds();
  if (rowIds.length > 0) {
    await prisma.productionScheduleOrderSplitAuditLog.deleteMany({
      where: { csvDashboardId: DASHBOARD_ID, parentCsvDashboardRowId: { in: rowIds } }
    });
    await prisma.productionScheduleOrderSplitAssignment.deleteMany({
      where: {
        split: {
          csvDashboardId: DASHBOARD_ID,
          parentCsvDashboardRowId: { in: rowIds }
        }
      }
    });
    await prisma.productionScheduleOrderSplit.deleteMany({
      where: { csvDashboardId: DASHBOARD_ID, parentCsvDashboardRowId: { in: rowIds } }
    });
    await prisma.productionScheduleOrderAssignment.deleteMany({
      where: { csvDashboardId: DASHBOARD_ID, csvDashboardRowId: { in: rowIds } }
    });
    await prisma.productionScheduleOrderSupplement.deleteMany({
      where: { csvDashboardId: DASHBOARD_ID, csvDashboardRowId: { in: rowIds } }
    });
  }
  await prisma.csvDashboardRow.deleteMany({
    where: { csvDashboardId: DASHBOARD_ID, dataHash: { startsWith: 'split-service-' } }
  });
}

async function seedSplittableParentRow(plannedQuantity: number): Promise<{ id: string }> {
  await prisma.csvDashboard.upsert({
    where: { id: DASHBOARD_ID },
    update: {},
    create: {
      id: DASHBOARD_ID,
      name: 'ProductionSchedule_Mishima_Grinding',
      columnDefinitions: [],
      templateType: 'CARD_GRID',
      templateConfig: {},
      ingestMode: 'DEDUP',
      dedupKeyColumns: ['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'],
      dateColumnName: 'registeredAt',
      enabled: true
    }
  });

  const row = await prisma.csvDashboardRow.create({
    data: {
      csvDashboardId: DASHBOARD_ID,
      occurredAt: new Date(),
      dataHash: `split-service-${Date.now()}-${Math.random()}`,
      rowData: {
        ProductNo: '9000100001',
        FSEIBAN: 'SPLIT-SVC',
        FHINCD: 'PA-SPLIT',
        FSIGENCD: RESOURCE_CD,
        FKOJUN: '10'
      }
    }
  });

  await prisma.productionScheduleOrderSupplement.create({
    data: {
      csvDashboardId: DASHBOARD_ID,
      csvDashboardRowId: row.id,
      sourceCsvDashboardId: ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID,
      productNo: '9000100001',
      resourceCd: RESOURCE_CD,
      processOrder: '10',
      plannedQuantity
    }
  });

  return row;
}

describe('production-schedule-order-split.service (integration)', () => {
  beforeAll(async () => {
    await cleanupSplitFixtures();
  });

  afterAll(async () => {
    await cleanupSplitFixtures();
  });

  beforeEach(async () => {
    await cleanupSplitFixtures();
  });

  it('replace → list → order → due-date → clear order → delete のライフサイクル', async () => {
    const parent = await seedSplittableParentRow(5);

    const replaced = await replaceProductionScheduleOrderSplits({
      parentCsvDashboardRowId: parent.id,
      locationKey: LOCATION_KEY,
      resourceCd: RESOURCE_CD,
      items: [
        { splitNo: 1, splitQuantity: 2, orderNumber: 1 },
        { splitNo: 2, splitQuantity: 3, orderNumber: 2, dueDate: '2026-07-01' }
      ],
      audit: { actorLocation: LOCATION_KEY, requestId: 'req-split-lifecycle' }
    });

    expect(replaced.splits).toHaveLength(2);
    expect(replaced.splits.map((s) => s.splitQuantity)).toEqual([2, 3]);
    expect(replaced.splits[0]?.orderNumber).toBe(1);

    const listed = await listProductionScheduleOrderSplitsForParent(parent.id, LOCATION_KEY);
    expect(listed.plannedQuantity).toBe(5);
    expect(listed.splits).toHaveLength(2);

    const splitId = replaced.splits[0]!.id;
    await upsertProductionScheduleSplitOrder({
      splitId,
      resourceCd: ` ${RESOURCE_CD} `,
      orderNumber: 3,
      locationKey: LOCATION_KEY,
      audit: { actorLocation: LOCATION_KEY, requestId: 'req-split-order' }
    });

    const dueDateResult = await upsertProductionScheduleSplitDueDate({
      splitId,
      dueDateText: '2026-08-15',
      audit: { actorLocation: LOCATION_KEY, requestId: 'req-split-due' }
    });
    expect(dueDateResult.dueDate).toBe('2026-08-15');

    const afterDue = await listProductionScheduleOrderSplitsForParent(parent.id, LOCATION_KEY);
    expect(afterDue.splits[0]?.dueDate).toBe('2026-08-15');
    expect(afterDue.splits[0]?.orderNumber).toBe(3);

    await upsertProductionScheduleSplitOrder({
      splitId,
      resourceCd: RESOURCE_CD,
      orderNumber: null,
      locationKey: LOCATION_KEY
    });

    const afterClear = await listProductionScheduleOrderSplitsForParent(parent.id, LOCATION_KEY);
    expect(afterClear.splits[0]?.orderNumber).toBeNull();

    await deleteProductionScheduleOrderSplits({
      parentCsvDashboardRowId: parent.id,
      audit: { actorLocation: LOCATION_KEY, requestId: 'req-split-delete' }
    });

    const afterDelete = await prisma.productionScheduleOrderSplit.count({
      where: { parentCsvDashboardRowId: parent.id }
    });
    expect(afterDelete).toBe(0);

    const auditCount = await prisma.productionScheduleOrderSplitAuditLog.count({
      where: { parentCsvDashboardRowId: parent.id }
    });
    expect(auditCount).toBeGreaterThanOrEqual(3);
  });

  it('分割数量合計不一致は 400 SPLIT_QUANTITY_SUM_MISMATCH', async () => {
    const parent = await seedSplittableParentRow(5);

    await expect(
      replaceProductionScheduleOrderSplits({
        parentCsvDashboardRowId: parent.id,
        locationKey: LOCATION_KEY,
        resourceCd: RESOURCE_CD,
        items: [
          { splitNo: 1, splitQuantity: 2 },
          { splitNo: 2, splitQuantity: 2 }
        ]
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'SPLIT_QUANTITY_SUM_MISMATCH'
    } satisfies Partial<ApiError>);
  });

  it('同一 replace 内の orderNumber 重複は 409 ORDER_NUMBER_CONFLICT', async () => {
    const parent = await seedSplittableParentRow(4);

    await expect(
      replaceProductionScheduleOrderSplits({
        parentCsvDashboardRowId: parent.id,
        locationKey: LOCATION_KEY,
        resourceCd: RESOURCE_CD,
        items: [
          { splitNo: 1, splitQuantity: 2, orderNumber: 1 },
          { splitNo: 2, splitQuantity: 2, orderNumber: 1 }
        ]
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'ORDER_NUMBER_CONFLICT'
    } satisfies Partial<ApiError>);
  });

  it('存在しない日付は 400', async () => {
    const parent = await seedSplittableParentRow(2);

    await expect(
      replaceProductionScheduleOrderSplits({
        parentCsvDashboardRowId: parent.id,
        locationKey: LOCATION_KEY,
        resourceCd: RESOURCE_CD,
        items: [{ splitNo: 1, splitQuantity: 2, dueDate: '2026-02-31' }]
      })
    ).rejects.toMatchObject({
      statusCode: 400
    } satisfies Partial<ApiError>);

    const replaced = await replaceProductionScheduleOrderSplits({
      parentCsvDashboardRowId: parent.id,
      locationKey: LOCATION_KEY,
      resourceCd: RESOURCE_CD,
      items: [{ splitNo: 1, splitQuantity: 2 }]
    });

    await expect(
      upsertProductionScheduleSplitDueDate({
        splitId: replaced.splits[0]!.id,
        dueDateText: '2026-02-31'
      })
    ).rejects.toMatchObject({
      statusCode: 400
    } satisfies Partial<ApiError>);
  });

  it('日付はYYYY-MM-DD完全一致のみ受け付ける', async () => {
    const parent = await seedSplittableParentRow(2);

    await expect(
      replaceProductionScheduleOrderSplits({
        parentCsvDashboardRowId: parent.id,
        locationKey: LOCATION_KEY,
        resourceCd: RESOURCE_CD,
        items: [{ splitNo: 1, splitQuantity: 2, dueDate: '2026-09-01T00:00:00Z' }]
      })
    ).rejects.toMatchObject({
      statusCode: 400
    } satisfies Partial<ApiError>);

    const replaced = await replaceProductionScheduleOrderSplits({
      parentCsvDashboardRowId: parent.id,
      locationKey: LOCATION_KEY,
      resourceCd: RESOURCE_CD,
      items: [{ splitNo: 1, splitQuantity: 2 }]
    });

    await expect(
      upsertProductionScheduleSplitDueDate({
        splitId: replaced.splits[0]!.id,
        dueDateText: '2026-09-01T00:00:00Z'
      })
    ).rejects.toMatchObject({
      statusCode: 400
    } satisfies Partial<ApiError>);
  });

  it('replace 時に親行 assignment を削除する', async () => {
    const parent = await seedSplittableParentRow(3);

    await prisma.productionScheduleOrderAssignment.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: parent.id,
        location: LOCATION_KEY,
        siteKey: LOCATION_KEY,
        resourceCd: RESOURCE_CD,
        orderNumber: 5
      }
    });

    await replaceProductionScheduleOrderSplits({
      parentCsvDashboardRowId: parent.id,
      locationKey: LOCATION_KEY,
      resourceCd: RESOURCE_CD,
      items: [{ splitNo: 1, splitQuantity: 3, orderNumber: 1 }]
    });

    const parentAssignments = await prisma.productionScheduleOrderAssignment.count({
      where: { csvDashboardRowId: parent.id }
    });
    expect(parentAssignments).toBe(0);
  });
});
