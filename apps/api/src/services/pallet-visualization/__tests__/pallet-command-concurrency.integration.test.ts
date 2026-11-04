import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { commandAddPalletItem, commandReplacePalletItem } from '../pallet-visualization-command.service.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

const RESOURCE_CD = 'PLOCK';
const PRODUCT_NO = 'PALLET-LOCK-ORDER';
let clientId: string;
let rowId: string;

async function cleanup(): Promise<void> {
  await prisma.machinePalletEvent.deleteMany({ where: { resourceCd: RESOURCE_CD } });
  await prisma.machinePalletItem.deleteMany({ where: { resourceCd: RESOURCE_CD } });
  await prisma.csvDashboardRow.deleteMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      rowData: { path: ['ProductNo'], equals: PRODUCT_NO },
    },
  });
  await prisma.productionScheduleResourceMaster.deleteMany({ where: { resourceCd: RESOURCE_CD } });
  await prisma.clientDevice.deleteMany({ where: { apiKey: 'pallet-lock-test-key' } });
}

describe('pallet command concurrency', () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      create: {
        id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        name: 'Pallet concurrency test',
        columnDefinitions: [],
        templateConfig: {},
      },
      update: {},
    });
    const [client, row] = await Promise.all([
      prisma.clientDevice.create({ data: { name: 'Pallet lock test', apiKey: 'pallet-lock-test-key' } }),
      prisma.csvDashboardRow.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date(),
          rowData: {
            ProductNo: PRODUCT_NO,
            FSEIBAN: 'PALLET-LOCK-SEIBAN',
            FHINCD: 'PALLET-LOCK-PART',
            FHINMEI: 'Pallet lock part',
            FSIGENCD: RESOURCE_CD,
            FKOJUN: '10',
          },
        },
      }),
    ]);
    await prisma.productionScheduleResourceMaster.create({
      data: {
        resourceCd: RESOURCE_CD,
        resourceName: 'Pallet lock machine',
        resourceClassCd: 'TEST',
        resourceGroupCd: 'TEST',
      },
    });

    clientId = client.id;
    rowId = row.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('同一パレットへの同時追加でdisplayOrderが重複しない', async () => {
    await Promise.all(Array.from({ length: 8 }, () => commandAddPalletItem({
      clientDeviceId: clientId,
      machineCd: RESOURCE_CD,
      palletNo: 1,
      manufacturingOrderBarcodeRaw: PRODUCT_NO,
    })));

    const items = await prisma.machinePalletItem.findMany({
      where: { resourceCd: RESOURCE_CD, palletNo: 1 },
      orderBy: { displayOrder: 'asc' },
    });
    expect(items.map((item) => item.displayOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(items.map((item) => item.displayOrder)).size).toBe(8);
    expect(items.every((item) => item.csvDashboardRowId === rowId)).toBe(true);
    expect(await prisma.machinePalletEvent.count({
      where: { resourceCd: RESOURCE_CD, palletNo: 1, actionType: 'SET_ITEM' },
    })).toBe(8);
  });
  it('deduplicates concurrent add/replace, conflicts on changed bodies, and replays deleted targets', async () => {
    const input = { clientDeviceId: clientId, machineCd: RESOURCE_CD, palletNo: 2,
      manufacturingOrderBarcodeRaw: PRODUCT_NO, eventKey: randomUUID(), readAt: new Date() };
    const results = await Promise.all(Array.from({ length: 4 }, () => commandAddPalletItem(input)));
    expect(results.every(result => result.id === results[0].id)).toBe(true);
    expect(await commandAddPalletItem(input)).toEqual(results[0]);
    expect(await prisma.machinePalletItem.count({ where: { resourceCd: RESOURCE_CD, palletNo: 2 } })).toBe(1);
    await expect(commandAddPalletItem({ ...input, manufacturingOrderBarcodeRaw: 'DIFFERENT' })).rejects.toMatchObject({ statusCode: 409 });
    const replacement = { clientDeviceId: clientId, itemId: results[0].id,
      manufacturingOrderBarcodeRaw: PRODUCT_NO, eventKey: randomUUID(), readAt: new Date() };
    expect(await Promise.all([commandReplacePalletItem(replacement), commandReplacePalletItem(replacement)])).toEqual([results[0], results[0]]);
    await expect(commandReplacePalletItem({ ...replacement, itemId: randomUUID() })).rejects.toMatchObject({ statusCode: 409 });
    await prisma.machinePalletItem.delete({ where: { id: results[0].id } });
    expect(await commandAddPalletItem(input)).toEqual(results[0]);
    expect(await commandReplacePalletItem(replacement)).toEqual(results[0]);
    expect(await prisma.machinePalletEvent.count({ where: { clientDeviceId: clientId, eventKey: { in: [input.eventKey, replacement.eventKey] } } })).toBe(2);
  });

});
