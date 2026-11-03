import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { countActivePlacementsOnShelf, filterActivePlacements } from '../placement-completion.service.js';

const token = randomUUID().replaceAll('-', '');
const prefix = `placement-completion-${token}`;
const seiban = `PC${token.slice(0, 12)}`;
const productPrefix = BigInt(`0x${token.slice(0, 12)}`).toString().padStart(15, '0');
const productNo = (suffix: string) => `${productPrefix}${suffix}`;
const shelf = `${prefix}-shelf`;
const partCode = `PC${token.slice(0, 10)}`;
const partName = `${prefix}-part`;
let createdDashboard = false;

async function cleanup() {
  await prisma.orderPlacementBranchState.deleteMany({ where: { id: { in: [`${prefix}-completed`, `${prefix}-active`] } } });
  await prisma.mobilePlacementShelf.deleteMany({ where: { id: `${prefix}-shelf` } });
  // Progress, external completion and supplements are deleted by the row's cascade relations.
  await prisma.csvDashboardRow.deleteMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, dataHash: { startsWith: prefix } },
  });
  if (createdDashboard) {
    await prisma.csvDashboard.deleteMany({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, rows: { none: {} } },
    });
    createdDashboard = false;
  }
}

async function createProcess(order: string, processOrder: string, completed: boolean, purchase = false) {
  const id = `${prefix}-${order}-${processOrder}`;
  await prisma.csvDashboardRow.create({
    data: {
      id,
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      dataHash: id,
      rowData: {
        ProductNo: order, FKOJUN: processOrder, FSIGENCD: 'TEST', FSEIBAN: seiban,
        FHINCD: purchase ? partCode : `${partCode}-${order}`, FHINMEI: purchase ? partName : order,
      },
      productionScheduleProgress: {
        create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, isCompleted: completed },
      },
    },
  });
  if (purchase) {
    await prisma.productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: id,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        productNo: order, resourceCd: 'TEST', processOrder,
        plannedStartDate: new Date('2026-01-02T00:00:00Z'),
      },
    });
  }
  return id;
}

describe('placement completion (real PostgreSQL)', () => {
  beforeAll(async () => {
    await cleanup();
    const dashboard = await prisma.csvDashboard.findUnique({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID } });
    if (!dashboard) {
      await prisma.csvDashboard.create({
        data: {
          id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          name: 'Test Production Schedule', columnDefinitions: [], templateConfig: {},
        },
      });
      createdDashboard = true;
    }
  });

  afterAll(cleanup);

  it.each([
    { name: 'both processes manually completed', suffix: '01', manual: [true, true], external: false, hidden: true },
    { name: 'one process incomplete', suffix: '02', manual: [true, false], external: false, hidden: false },
    { name: 'second process externally completed', suffix: '03', manual: [true, false], external: true, hidden: true },
  ])('filters manufacturing orders with $name, including padded barcodes', async ({ suffix, manual, external, hidden }) => {
    const order = productNo(suffix);
    await createProcess(order, '1', manual[0]);
    const secondRowId = await createProcess(order, '2', manual[1]);
    if (external) {
      await prisma.productionScheduleExternalCompletion.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          csvDashboardRowId: secondRowId, isExternallyCompleted: true,
        },
      });
    }
    const placements = [order, `  ${order}  `].map(manufacturingOrderBarcodeRaw => ({
      slipKind: 'manufacturing_order', manufacturingOrderBarcodeRaw, scheduleSnapshot: null,
    }));
    expect(await filterActivePlacements(placements, prisma)).toEqual(hidden ? [] : placements);
  });

  it('keeps manufacturing orders without schedule rows', async () => {
    const placements = [{ manufacturingOrderBarcodeRaw: productNo('04'), scheduleSnapshot: null }];
    expect(await filterActivePlacements(placements, prisma)).toEqual(placements);
  });

  it('filters matched purchase slips by completion and keeps unmatched parts', async () => {
    const rowId = await createProcess(productNo('05'), '1', true, true);
    const matched = {
      slipKind: 'purchase_order',
      manufacturingOrderBarcodeRaw: `${prefix}-purchase`,
      scheduleSnapshot: { FSEIBAN: seiban, FHINCD: partCode, FHINMEI: partName, PurchaseOrderNo: `${prefix}-po` },
    };
    const unmatched = {
      ...matched,
      scheduleSnapshot: { ...matched.scheduleSnapshot, FHINCD: `${partCode}UNKNOWN`, FHINMEI: `${partName} unknown` },
    };
    expect(await filterActivePlacements([matched, unmatched], prisma)).toEqual([unmatched]);
    await prisma.productionScheduleProgress.update({ where: { csvDashboardRowId: rowId }, data: { isCompleted: false } });
    expect(await filterActivePlacements([matched, unmatched], prisma)).toEqual([matched, unmatched]);
  });

  it('counts only active branch placements on the shelf', async () => {
    const completed = productNo('06');
    const active = productNo('07');
    await createProcess(completed, '1', true);
    await createProcess(active, '1', false);
    await prisma.mobilePlacementShelf.create({ data: { id: `${prefix}-shelf`, shelfCodeRaw: shelf } });
    await prisma.orderPlacementBranchState.createMany({
      data: [
        { id: `${prefix}-completed`, manufacturingOrderBarcodeRaw: completed, branchNo: 1, shelfCodeRaw: shelf },
        { id: `${prefix}-active`, manufacturingOrderBarcodeRaw: active, branchNo: 1, shelfCodeRaw: shelf },
      ],
    });
    expect(await countActivePlacementsOnShelf(prisma, shelf)).toBe(1);
  });
});
