import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  findProductionSchedulePalletSnapshot,
  findProductionSchedulePlacementSnapshot,
} from '../production-schedule-snapshot.service.js';
import { extractOutsideDimensionsDisplay, normalizeOutsideDimensionsDisplay } from '../production-schedule-snapshot-fields.js';
import * as legacyDisplayFields from '../../pallet-visualization/pallet-visualization-display-fields.js';

const dashboardId = randomUUID();
const rowIds: string[] = [];

async function seed(rowData: Prisma.InputJsonValue | null) {
  const row = await prisma.csvDashboardRow.create({ data: {
    csvDashboardId: dashboardId,
    occurredAt: new Date('2026-09-01T00:00:00Z'),
    rowData: rowData ?? Prisma.JsonNull,
  } });
  rowIds.push(row.id);
  return row.id;
}

async function supplement(rowId: string, scope: string, plannedQuantity: number, plannedStartDate: Date) {
  return prisma.productionScheduleOrderSupplement.create({ data: {
    csvDashboardRowId: rowId, csvDashboardId: scope, sourceCsvDashboardId: dashboardId,
    productNo: rowId.slice(0, 20), resourceCd: 'MC01', processOrder: '10', plannedQuantity, plannedStartDate,
  } });
}

describe('production schedule snapshot contract (PostgreSQL)', () => {
  beforeAll(async () => {
    await prisma.csvDashboard.create({ data: {
      id: dashboardId, name: 'Snapshot contract fixture', columnDefinitions: [], templateConfig: {},
    } });
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
    await prisma.csvDashboard.deleteMany({ where: { id: dashboardId } });
    await prisma.$disconnect();
  });

  it.each([
    {
      raw: { ProductNo: ' 100 ', FSEIBAN: ' S ', FHINCD: ' P ', FHINMEI: ' Name ', FSIGENCD: ' MC01 ', FGAISUN: ' 10  x  20 ' },
      expected: { manufacturingOrderNo: ' 100 ', seiban: ' S ', partCode: ' P ', partName: ' Name ' },
      resourceCode: ' MC01 ', outsideDimensionsDisplay: '10 x 20',
    },
    {
      raw: { ProductNo: 0, FSEIBAN: false, FHINCD: ['P'], FHINMEI: { name: 'Name' }, FSIGENCD: '', FGAISUN: ' ', FSUNPO: 0, FGAISUNPO: 'later' },
      expected: { manufacturingOrderNo: 0, seiban: false, partCode: ['P'], partName: { name: 'Name' } },
      resourceCode: '', outsideDimensionsDisplay: '0',
    },
    {
      raw: { ProductNo: null, FSEIBAN: '', FHINCD: null },
      expected: { manufacturingOrderNo: null, seiban: '', partCode: null, partName: null },
      resourceCode: null, outsideDimensionsDisplay: null,
    },
    {
      raw: null,
      expected: { manufacturingOrderNo: null, seiban: null, partCode: null, partName: null },
      resourceCode: null, outsideDimensionsDisplay: null,
    },
    {
      raw: 'unexpected non-object row',
      expected: { manufacturingOrderNo: null, seiban: null, partCode: null, partName: null },
      resourceCode: null, outsideDimensionsDisplay: null,
    },
  ])('preserves persisted values and reads by ID without an added dashboard restriction ($raw)', async ({ raw, expected, resourceCode, outsideDimensionsDisplay }) => {
    const rowId = await seed(raw);
    const read = vi.spyOn(prisma.csvDashboardRow, 'findFirst');
    await expect(findProductionSchedulePlacementSnapshot(rowId)).resolves.toEqual({ rowId, ...expected });
    expect(read).toHaveBeenCalledTimes(1);
    await expect(findProductionSchedulePalletSnapshot(rowId)).resolves.toEqual({
      rowId, ...expected, resourceCode, outsideDimensionsDisplay, plannedQuantity: null, plannedStartDate: null,
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('returns null for missing IDs without adding a fallback query', async () => {
    const read = vi.spyOn(prisma.csvDashboardRow, 'findFirst');
    await expect(findProductionSchedulePlacementSnapshot(randomUUID())).resolves.toBeNull();
    await expect(findProductionSchedulePalletSnapshot(randomUUID())).resolves.toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('reads zero quantity and the PostgreSQL date from the production supplement', async () => {
    const rowId = await seed({ ProductNo: '100', FHINCD: 'P' });
    await supplement(rowId, PRODUCTION_SCHEDULE_DASHBOARD_ID, 0, new Date('2026-09-02T00:00:00Z'));
    await expect(findProductionSchedulePalletSnapshot(rowId)).resolves.toMatchObject({
      rowId, plannedQuantity: 0, plannedStartDate: new Date('2026-09-02T00:00:00Z'),
    });
  });

  it('keeps the row while ignoring a supplement with another dashboard scope', async () => {
    const rowId = await seed({ ProductNo: '100', FSEIBAN: 'S' });
    await supplement(rowId, dashboardId, 9, new Date('2026-09-03T00:00:00Z'));
    await expect(findProductionSchedulePalletSnapshot(rowId)).resolves.toMatchObject({
      rowId, manufacturingOrderNo: '100', seiban: 'S', plannedQuantity: null, plannedStartDate: null,
    });
  });

  it('keeps the old pallet dimension exports as the same functions', () => {
    expect(legacyDisplayFields.extractOutsideDimensionsDisplay).toBe(extractOutsideDimensionsDisplay);
    expect(legacyDisplayFields.normalizeOutsideDimensionsDisplay).toBe(normalizeOutsideDimensionsDisplay);
  });
});
