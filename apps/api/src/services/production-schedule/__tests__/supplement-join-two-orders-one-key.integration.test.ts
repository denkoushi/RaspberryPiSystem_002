import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID, PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID } from '../constants.js';
import { buildBoardDueDateExistsSql } from '../d-schedule-minutes/board-due.sql.js';

const prefix = `supp-join-${randomUUID()}`;
const rowIds: string[] = [];
const createdDashboardIds: string[] = [];
const rowData = (productNo: string) => ({
  ProductNo: productNo, FSEIBAN: `${prefix}-FS`, FHINCD: 'PART', FSIGENCD: '305', FKOJUN: '10'
});

describe('supplement join with two ProductNos on one 4-column key (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!(await prisma.csvDashboard.findUnique({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID } }))) {
      await prisma.csvDashboard.create({
        data: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: prefix, columnDefinitions: [], templateConfig: {} }
      });
      createdDashboardIds.push(PRODUCTION_SCHEDULE_DASHBOARD_ID);
    }
    for (const productNo of ['0004146538', '0004146555']) {
      const id = `${prefix}-${productNo}`;
      await prisma.csvDashboardRow.create({
        data: { id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, occurredAt: new Date('2026-11-01T00:00:00Z'), rowData: rowData(productNo) }
      });
      rowIds.push(id);
    }
    // Only the first order has a supplement (planned end date).
    await prisma.productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID, csvDashboardRowId: `${prefix}-0004146538`,
        productNo: '0004146538', resourceCd: '305', processOrder: '10', plannedEndDate: new Date('2026-11-20T00:00:00Z')
      }
    });
  });

  afterAll(async () => {
    await prisma.productionScheduleOrderSupplement.deleteMany({ where: { csvDashboardRowId: { in: rowIds } } });
    await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
    await prisma.csvDashboard.deleteMany({ where: { id: { in: createdDashboardIds } } });
    await prisma.$disconnect();
  });

  it('gives the planned end date only to the row of its own ProductNo', async () => {
    const found = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "CsvDashboardRow"."id" FROM "CsvDashboardRow"
      WHERE "CsvDashboardRow"."id" = ANY(${rowIds}::text[])
        AND ${buildBoardDueDateExistsSql()}
    `);
    expect(found.map((row) => row.id)).toEqual([`${prefix}-0004146538`]);
  });
});
