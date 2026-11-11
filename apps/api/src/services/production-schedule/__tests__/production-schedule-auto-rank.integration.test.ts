import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { autoRankProductionScheduleOrder } from '../production-schedule-auto-rank.service.js';
import { upsertProductionScheduleOrder } from '../production-schedule-command.service.js';

const locationKey = 'AUTO-RANK-TEST';
const resourceCd = 'ARTEST';
let rowIds: string[] = [];
let createdDashboard = false;

async function rows(count = 3) {
  const created = await Promise.all(Array.from({ length: count }, () => prisma.csvDashboardRow.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date(),
      rowData: { FSEIBAN: 'AR-TEST', FSIGENCD: resourceCd, progress: '未完了' }
    }
  })));
  const ids = created.map(row => row.id).sort((a, b) => a.localeCompare(b));
  rowIds.push(...ids);
  return ids.map((rowId, index) => ({ rowId, orderNumber: index + 1 }));
}

const saved = () => prisma.productionScheduleOrderAssignment.findMany({
  where: { csvDashboardRowId: { in: rowIds } },
  orderBy: { orderNumber: 'asc' },
  select: { csvDashboardRowId: true, orderNumber: true, location: true }
});
const batch = (assignments: { rowId: string; orderNumber: number }[]) =>
  autoRankProductionScheduleOrder({ locationKey, resourceCd, assignments });

async function seed(rowId: string, location = locationKey) {
  await prisma.productionScheduleOrderAssignment.create({ data: {
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
    csvDashboardRowId: rowId, location, siteKey: locationKey, resourceCd, orderNumber: 8
  } });
}

beforeAll(async () => {
  const existing = await prisma.csvDashboard.findUnique({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID } });
  if (!existing) {
    await prisma.csvDashboard.create({
      data: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: 'Auto rank test', columnDefinitions: [], templateConfig: {} }
    });
    createdDashboard = true;
  }
});
afterEach(async () => {
  await prisma.dueManagementOutcomeEvent.deleteMany({ where: { csvDashboardRowId: { in: rowIds } } });
  await prisma.productionScheduleOrderAssignment.deleteMany({ where: { csvDashboardRowId: { in: rowIds } } });
  await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
  rowIds = [];
});
afterAll(async () => {
  try {
    if (createdDashboard) {
      await prisma.csvDashboard.delete({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID } });
    }
  } finally {
    await prisma.$disconnect();
  }
});

describe('atomic auto rank with PostgreSQL', () => {
  it.each([locationKey, `${locationKey} - kioskA`])('rolls back earlier rows and events for an assigned middle row at %s', async (location) => {
    const assignments = await rows();
    await seed(assignments[1]!.rowId, location);
    const before = await saved();
    await expect(batch(assignments)).rejects.toMatchObject({ statusCode: 409, code: 'AUTO_RANK_ROW_ALREADY_ASSIGNED' });
    expect(await saved()).toEqual(before);
    expect(await prisma.dueManagementOutcomeEvent.count({ where: { csvDashboardRowId: { in: rowIds } } })).toBe(0);
  });

  it.each([false, true])('serializes a batch and a single write on the same row without deadlock (single first=%s)', async (singleFirst) => {
    const assignments = await rows();
    const single = () => upsertProductionScheduleOrder({ ...assignments[1]!, locationKey, resourceCd });
    const operations = singleFirst ? [single, () => batch(assignments)] : [() => batch(assignments), single];
    const results = await Promise.allSettled(operations.map(run => run()));
    const singleResult = results[singleFirst ? 0 : 1]!;
    const batchResult = results[singleFirst ? 1 : 0]!;
    expect(singleResult.status).toBe('fulfilled');
    if (batchResult.status === 'fulfilled') {
      expect(await saved()).toEqual(assignments.map(({ rowId, orderNumber }) => ({ csvDashboardRowId: rowId, orderNumber, location: locationKey })));
    } else {
      expect(batchResult.reason).toMatchObject({ statusCode: 409, code: 'AUTO_RANK_ROW_ALREADY_ASSIGNED' });
      expect(await saved()).toEqual([{ csvDashboardRowId: assignments[1]!.rowId, orderNumber: 2, location: locationKey }]);
    }
  });

  it('serializes a batch and a same-row rank clear without deadlock in either start order', async () => {
    for (const clearFirst of [false, true]) {
      const assignments = await rows();
      const clear = () => upsertProductionScheduleOrder({
        rowId: assignments[1]!.rowId, orderNumber: null, locationKey, resourceCd
      });
      const operations = clearFirst ? [clear, () => batch(assignments)] : [() => batch(assignments), clear];
      const results = await Promise.allSettled(operations.map(run => run()));
      expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
      const actual = await saved();
      const allAssigned = assignments.map(({ rowId, orderNumber }) => ({
        csvDashboardRowId: rowId, orderNumber, location: locationKey
      }));
      expect([allAssigned, allAssigned.filter(row => row.csvDashboardRowId !== assignments[1]!.rowId)])
        .toContainEqual(actual);
      const events = await prisma.dueManagementOutcomeEvent.findMany({
        where: { csvDashboardRowId: assignments[1]!.rowId },
        select: { payload: true }
      });
      expect(events).toHaveLength(2);
      const clearEvent = events.find(event => (event.payload as { nextOrderNumber: number | null }).nextOrderNumber === null);
      expect(clearEvent?.payload).toMatchObject({
        previousOrderNumber: actual.length === assignments.length ? null : 2
      });
      // Free this iteration's slots without losing the IDs used by afterEach cleanup.
      await prisma.productionScheduleOrderAssignment.deleteMany({
        where: { csvDashboardRowId: { in: assignments.map(({ rowId }) => rowId) } }
      });
    }
  });

  it('serializes two overlapping slot plans and commits only one complete batch', async () => {
    const first = await rows();
    const second = await rows();
    const results = await Promise.allSettled([batch([...first].reverse()), batch(second)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const loser = results.find(result => result.status === 'rejected');
    expect(loser?.status === 'rejected' && loser.reason).toMatchObject({ statusCode: 409, code: 'ORDER_NUMBER_CONFLICT' });
    const winner = results[0]!.status === 'fulfilled' ? first : second;
    const actual = await saved();
    expect(actual).toEqual(winner.map(({ rowId, orderNumber }) => ({ csvDashboardRowId: rowId, orderNumber, location: locationKey })));
    expect(new Set(actual.map(row => row.orderNumber)).size).toBe(actual.length);
  });
});
