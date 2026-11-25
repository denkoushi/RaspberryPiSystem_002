import { randomUUID } from 'node:crypto';
import { verifySlipMatch } from '@raspi-system/slip-match-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import {
  listScheduleRowsByFseiban,
  listScheduleRowsByProductNo,
} from '../../production-schedule/production-schedule-lookup.service.js';

const prefix = `slip-two-orders-${randomUUID()}`;
const seiban = `${prefix}-FS`;
const rowIds: string[] = [];
const createdDashboardIds: string[] = [];
const occurredAt = new Date('2026-11-01T00:00:00Z');

async function seed(suffix: string, productNo: string, fhincd: string, fhinmei: string) {
  const id = `${prefix}-${suffix}`;
  await prisma.csvDashboardRow.create({
    data: {
      id,
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt,
      rowData: { ProductNo: productNo, FSEIBAN: seiban, FHINCD: fhincd, FHINMEI: fhinmei, FSIGENCD: 'MC01', FKOJUN: '10' },
    },
  });
  rowIds.push(id);
}

const purchaseRow = {
  seiban,
  purchasePartCodeMatchKey: 'BRACKET-A',
  purchasePartCodeRaw: 'BRACKET-A',
  purchasePartName: 'ブラケットA',
};
const source = {
  listScheduleRowsByProductNo,
  listScheduleRowsByFseiban,
  findPurchaseOrderLookupRows: async (no: string) => (no === '0006073893' ? [purchaseRow] : []),
};

describe('slip match with two live orders on one 4-column key (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!(await prisma.csvDashboard.findUnique({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID } }))) {
      await prisma.csvDashboard.create({
        data: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: prefix, columnDefinitions: [], templateConfig: {} },
      });
      createdDashboardIds.push(PRODUCTION_SCHEDULE_DASHBOARD_ID);
    }
    await seed('a1', '0004146538', 'BRACKET-A', 'ブラケットA');
    await seed('a2', '0004146555', 'BRACKET-A', 'ブラケットA');
    await seed('b', '0004189911', 'SUPPORT-B', '支持ブラケット');
  });

  afterAll(async () => {
    await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
    await prisma.csvDashboard.deleteMany({ where: { id: { in: createdDashboardIds } } });
    await prisma.$disconnect();
  });

  it('resolves each of the two orders on the same key to its own row', async () => {
    expect((await listScheduleRowsByProductNo('0004146538')).map((r) => r.rowId)).toEqual([`${prefix}-a1`]);
    expect((await listScheduleRowsByProductNo('0004146555')).map((r) => r.rowId)).toEqual([`${prefix}-a2`]);
  });

  it('matches the move slip 0004146538 with the purchase slip 0006073893', async () => {
    await expect(
      verifySlipMatch({ transferOrderBarcodeRaw: '0004146538', actualOrderBarcodeRaw: '0006073893', actualFseibanRaw: '' }, source),
    ).resolves.toMatchObject({ ok: true, reason: 'match', actualResolvedBy: 'purchaseOrder' });
    await expect(
      verifySlipMatch({ transferOrderBarcodeRaw: '0004146555', actualOrderBarcodeRaw: '0006073893', actualFseibanRaw: '' }, source),
    ).resolves.toMatchObject({ ok: true, reason: 'match' });
  });

  it('keeps 0004189911 and 0004146538 as different parts', async () => {
    await expect(
      verifySlipMatch({ transferOrderBarcodeRaw: '0004146538', actualOrderBarcodeRaw: '0004189911', actualFseibanRaw: '' }, source),
    ).resolves.toMatchObject({ ok: false, reason: 'different_part' });
    await expect(
      verifySlipMatch({ transferOrderBarcodeRaw: '0004189911', actualOrderBarcodeRaw: '0006073893', actualFseibanRaw: '' }, source),
    ).resolves.toMatchObject({ ok: false, reason: 'different_part' });
  });
});
