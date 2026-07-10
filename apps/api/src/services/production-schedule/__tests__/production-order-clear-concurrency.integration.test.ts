import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { upsertProductionScheduleOrder } from '../production-schedule-command.service.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

const LOCATION = 'ORDER-CLEAR-LOCK';
const RESOURCE_CD = 'OCLOCK';
let rowId: string | null = null;

async function cleanup(): Promise<void> {
  if (!rowId) return;
  await prisma.dueManagementOutcomeEvent.deleteMany({ where: { csvDashboardRowId: rowId } });
  await prisma.productionScheduleOrderAssignment.deleteMany({ where: { csvDashboardRowId: rowId } });
  await prisma.csvDashboardRow.deleteMany({ where: { id: rowId } });
  rowId = null;
}

describe('production order clear concurrency', () => {
  beforeAll(async () => {
    await prisma.csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      create: {
        id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        name: 'Order clear concurrency test',
        columnDefinitions: [],
        templateConfig: {},
      },
      update: {},
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('同一行の設定とクリアで割当と学習イベントの順序が一致する', async () => {
    const row = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        rowData: { FSEIBAN: 'ORDER-CLEAR-SEIBAN', FSIGENCD: RESOURCE_CD, progress: '未完了' },
      },
    });
    rowId = row.id;
    await prisma.productionScheduleOrderAssignment.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id,
        location: LOCATION,
        siteKey: LOCATION,
        resourceCd: RESOURCE_CD,
        orderNumber: 5,
      },
    });

    await Promise.all([
      upsertProductionScheduleOrder({
        rowId: row.id,
        resourceCd: RESOURCE_CD,
        orderNumber: 1,
        locationKey: LOCATION,
      }),
      upsertProductionScheduleOrder({
        rowId: row.id,
        resourceCd: RESOURCE_CD,
        orderNumber: null,
        locationKey: LOCATION,
      }),
    ]);

    const events = await prisma.dueManagementOutcomeEvent.findMany({
      where: { csvDashboardRowId: row.id, eventType: 'manual_order_update' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(events).toHaveLength(2);
    const first = events[0]!.payload as Record<string, unknown>;
    const second = events[1]!.payload as Record<string, unknown>;
    expect(first.previousOrderNumber).toBe(5);
    expect(second.previousOrderNumber).toBe(first.nextOrderNumber);

    const finalAssignment = await prisma.productionScheduleOrderAssignment.findUnique({
      where: { csvDashboardRowId_location: { csvDashboardRowId: row.id, location: LOCATION } },
    });
    expect(finalAssignment?.orderNumber ?? null).toBe(second.nextOrderNumber ?? null);
  });
});

