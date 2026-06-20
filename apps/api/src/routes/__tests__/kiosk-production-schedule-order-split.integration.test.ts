vi.hoisted(() => {
  process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = 'true';
});

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../services/production-schedule/constants.js';

const DASHBOARD_ID = PRODUCTION_SCHEDULE_DASHBOARD_ID;
const ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID = '8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31';
const CLIENT_KEY = 'client-split-route-key';
const MAC_CLIENT_KEY = 'client-split-route-mac-key';
const TARGET_DEVICE_SCOPE_KEY = 'SplitRouteSite - Pi1';
const RESOURCE_CD = '305';

async function findSplitRouteFixtureRowIds(): Promise<string[]> {
  const rows = await prisma.csvDashboardRow.findMany({
    where: { csvDashboardId: DASHBOARD_ID, dataHash: { startsWith: 'split-route-' } },
    select: { id: true }
  });
  return rows.map((row) => row.id);
}

async function cleanupSplitRouteFixtures(): Promise<void> {
  const rowIds = await findSplitRouteFixtureRowIds();
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
    where: { csvDashboardId: DASHBOARD_ID, dataHash: { startsWith: 'split-route-' } }
  });
}

describe('Kiosk Production Schedule Order Split API (integration)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let parentRowId: string;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await cleanupSplitRouteFixtures();
    await app.close();
  });

  beforeEach(async () => {
    await cleanupSplitRouteFixtures();

    await prisma.clientDevice.upsert({
      where: { apiKey: CLIENT_KEY },
      update: { name: 'Split Route Client', location: 'SplitRouteTest', defaultMode: 'TAG' },
      create: { apiKey: CLIENT_KEY, name: 'Split Route Client', location: 'SplitRouteTest', defaultMode: 'TAG' }
    });
    await prisma.clientDevice.upsert({
      where: { apiKey: MAC_CLIENT_KEY },
      update: { name: 'Split Route Mac Client', location: 'Mac', defaultMode: 'TAG' },
      create: { apiKey: MAC_CLIENT_KEY, name: 'Split Route Mac Client', location: 'Mac', defaultMode: 'TAG' }
    });
    await prisma.clientDevice.upsert({
      where: { apiKey: 'client-split-route-target-key' },
      update: { name: 'Split Route Target Client', location: TARGET_DEVICE_SCOPE_KEY, defaultMode: 'TAG' },
      create: {
        apiKey: 'client-split-route-target-key',
        name: 'Split Route Target Client',
        location: TARGET_DEVICE_SCOPE_KEY,
        defaultMode: 'TAG'
      }
    });

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
        dataHash: `split-route-${Date.now()}`,
        rowData: {
          ProductNo: '9000200001',
          FSEIBAN: 'SPLIT-RT',
          FHINCD: 'PA-RT',
          FSIGENCD: RESOURCE_CD,
          FKOJUN: '10'
        }
      }
    });
    parentRowId = row.id;

    await prisma.productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: row.id,
        sourceCsvDashboardId: ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID,
        productNo: '9000200001',
        resourceCd: RESOURCE_CD,
        processOrder: '10',
        plannedQuantity: 6
      }
    });
  });

  it('PUT/GET splits で置換と一覧ができる', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        resourceCd: RESOURCE_CD,
        items: [
          { splitNo: 1, splitQuantity: 2, orderNumber: 1 },
          { splitNo: 2, splitQuantity: 4, orderNumber: 2 }
        ]
      }
    });
    expect(putRes.statusCode).toBe(200);
    const putBody = putRes.json() as { splits: Array<{ id: string; splitQuantity: number }> };
    expect(putBody.splits).toHaveLength(2);

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits`,
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(getRes.statusCode).toBe(200);
    const getBody = getRes.json() as { plannedQuantity: number; splits: unknown[] };
    expect(getBody.plannedQuantity).toBe(6);
    expect(getBody.splits).toHaveLength(2);
  });

  it('数量合計不一致は 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        resourceCd: RESOURCE_CD,
        items: [
          { splitNo: 1, splitQuantity: 2 },
          { splitNo: 2, splitQuantity: 2 }
        ]
      }
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { errorCode?: string };
    expect(body.errorCode).toBe('SPLIT_QUANTITY_SUM_MISMATCH');
  });

  it('split order / due-date / delete ルートが動作する', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        resourceCd: RESOURCE_CD,
        items: [
          { splitNo: 1, splitQuantity: 3, orderNumber: 1 },
          { splitNo: 2, splitQuantity: 3 }
        ]
      }
    });
    const splitId = (putRes.json() as { splits: Array<{ id: string }> }).splits[0]!.id;

    const orderRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/splits/${splitId}/order`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { resourceCd: RESOURCE_CD, orderNumber: 2 }
    });
    expect(orderRes.statusCode).toBe(200);

    const dueRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/splits/${splitId}/due-date`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-09-01' }
    });
    expect(dueRes.statusCode).toBe(200);
    expect((dueRes.json() as { dueDate?: string }).dueDate).toBe('2026-09-01');

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits`,
      headers: { 'x-client-key': CLIENT_KEY }
    });
    expect(deleteRes.statusCode).toBe(200);

    const remaining = await prisma.productionScheduleOrderSplit.count({
      where: { parentCsvDashboardRowId: parentRowId }
    });
    expect(remaining).toBe(0);
  });

  it('split replace / due-date ルートは不正な日付を 400 にする', async () => {
    const invalidReplaceRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        resourceCd: RESOURCE_CD,
        items: [{ splitNo: 1, splitQuantity: 6, dueDate: '2026-02-31' }]
      }
    });
    expect(invalidReplaceRes.statusCode).toBe(400);

    const timestampReplaceRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        resourceCd: RESOURCE_CD,
        items: [{ splitNo: 1, splitQuantity: 6, dueDate: '2026-09-01T00:00:00Z' }]
      }
    });
    expect(timestampReplaceRes.statusCode).toBe(400);

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        resourceCd: RESOURCE_CD,
        items: [{ splitNo: 1, splitQuantity: 6 }]
      }
    });
    expect(putRes.statusCode).toBe(200);
    const splitId = (putRes.json() as { splits: Array<{ id: string }> }).splits[0]!.id;

    const invalidDueDateRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/splits/${splitId}/due-date`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-02-31' }
    });
    expect(invalidDueDateRes.statusCode).toBe(400);

    const timestampDueDateRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/splits/${splitId}/due-date`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: { dueDate: '2026-09-01T00:00:00Z' }
    });
    expect(timestampDueDateRes.statusCode).toBe(400);
  });

  it('Mac proxy の split delete は targetDeviceScopeKey 必須で監査 target を記録する', async () => {
    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits`,
      headers: { 'x-client-key': CLIENT_KEY },
      payload: {
        resourceCd: RESOURCE_CD,
        items: [{ splitNo: 1, splitQuantity: 6, orderNumber: 1 }]
      }
    });
    expect(putRes.statusCode).toBe(200);

    const missingTargetRes = await app.inject({
      method: 'DELETE',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits`,
      headers: { 'x-client-key': MAC_CLIENT_KEY }
    });
    expect(missingTargetRes.statusCode).toBe(400);
    expect((missingTargetRes.json() as { errorCode?: string }).errorCode).toBe('TARGET_DEVICE_SCOPE_KEY_REQUIRED');

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/kiosk/production-schedule/${parentRowId}/splits?targetDeviceScopeKey=${encodeURIComponent(
        TARGET_DEVICE_SCOPE_KEY
      )}`,
      headers: { 'x-client-key': MAC_CLIENT_KEY }
    });
    expect(deleteRes.statusCode).toBe(200);

    const remaining = await prisma.productionScheduleOrderSplit.count({
      where: { parentCsvDashboardRowId: parentRowId }
    });
    expect(remaining).toBe(0);

    const audit = await prisma.productionScheduleOrderSplitAuditLog.findFirst({
      where: {
        parentCsvDashboardRowId: parentRowId,
        actionType: 'delete_splits'
      },
      orderBy: { createdAt: 'desc' }
    });
    expect(audit?.actorLocation).toBe('Mac');
    expect(audit?.targetLocation).toBe('SplitRouteSite');
    expect(audit?.siteKey).toBe('SplitRouteSite');
  });
});
