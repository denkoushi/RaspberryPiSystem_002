import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { productionScheduleProductNoMatchSql } from '../production-schedule-product-no-match.js';

import type { Prisma } from '@prisma/client';

const token = randomUUID().replaceAll('-', '');
const prefix = `product-no-match-${token}`;
const order = (suffix: string) => `${token.slice(0, 8)}${suffix}`;
const otherDashboardId = `${prefix}-other`;
let createdDashboard = false;

// Values that a jsonb-equality match and a text match could disagree on.
const productNos: Prisma.InputJsonValue[] = [
  order('01'), order('01'), order('02'), ` ${order('02')}`, `${order('02')} `, Number(order('03').replace(/\D/g, '').slice(0, 9)),
  [order('04')], { v: order('04') }, true, order('05').toUpperCase(), order('06'), 'ｱｲｳ', 'ｱｲｳ '
];

async function cleanup() {
  await prisma.csvDashboardRow.deleteMany({ where: { dataHash: { startsWith: prefix } } });
  await prisma.csvDashboard.deleteMany({ where: { id: otherDashboardId } });
  if (createdDashboard) {
    await prisma.csvDashboard.deleteMany({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, rows: { none: {} } } });
    createdDashboard = false;
  }
}

async function createRow(id: string, csvDashboardId: string, rowData: Prisma.InputJsonValue) {
  await prisma.csvDashboardRow.create({
    data: { id: `${prefix}-${id}`, csvDashboardId, occurredAt: new Date('2026-01-01T00:00:00Z'), dataHash: `${prefix}-${id}`, rowData }
  });
}

describe('productionScheduleProductNoMatchSql', () => {
  beforeAll(async () => {
    await cleanup();
    if (!await prisma.csvDashboard.findUnique({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID } })) {
      await prisma.csvDashboard.create({ data: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: 'Test Production Schedule', columnDefinitions: [], templateConfig: {} } });
      createdDashboard = true;
    }
    await prisma.csvDashboard.create({ data: { id: otherDashboardId, name: otherDashboardId, columnDefinitions: [], templateConfig: {} } });
    // Insert in reverse id order so ORDER BY id is observable.
    for (const [index, value] of [...productNos.entries()].reverse()) {
      await createRow(`ps-${String(index).padStart(2, '0')}`, PRODUCTION_SCHEDULE_DASHBOARD_ID, { ProductNo: value, FKOJUN: String(index) });
    }
    await createRow('ps-missing', PRODUCTION_SCHEDULE_DASHBOARD_ID, { FKOJUN: 'none' });
    await createRow('ps-null', PRODUCTION_SCHEDULE_DASHBOARD_ID, { ProductNo: null });
    await createRow('other', otherDashboardId, { ProductNo: order('01') });
  });
  afterAll(cleanup);

  it.each([
    [[order('01')], 2],
    [[order('01'), order('02'), ` ${order('02')}`, order('05'), order('06'), 'ｱｲｳ', order('99')], 6],
    [[order('03').replace(/\D/g, '').slice(0, 9), '[]', 'true', 'null'], 0]
  ])('returns the same rows in the same order as Prisma JSON-path equality for %j', async (orders, minRows) => {
    const expected = await prisma.csvDashboardRow.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, dataHash: { startsWith: prefix },
        OR: orders.map(value => ({ rowData: { path: ['ProductNo'], equals: value } })) },
      select: { id: true, rowData: true }, orderBy: { id: 'asc' }
    });
    const actual = await prisma.$queryRaw<{ id: string; rowData: Prisma.JsonValue }[]>`
      SELECT "id", "rowData" FROM "CsvDashboardRow"
      WHERE ${productionScheduleProductNoMatchSql(orders)} AND "dataHash" LIKE ${`${prefix}%`} ORDER BY "id" ASC`;
    expect(expected.length).toBeGreaterThanOrEqual(minRows);
    expect(actual).toEqual(expected);
  });
});
