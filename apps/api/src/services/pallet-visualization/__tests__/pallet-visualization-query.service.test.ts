import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../../lib/prisma.js';
import {
  queryPalletVisualizationBoard,
  queryPalletVisualizationMachine,
  queryPalletVisualizationMachines,
} from '../pallet-visualization-query.service.js';

const resources = vi.hoisted(() => ({ registered: vi.fn(), names: vi.fn() }));
vi.mock('../pallet-visualization-resource.service.js', () => ({ listRegisteredMachineCds: resources.registered }));
vi.mock('../../production-schedule/resource-master.service.js', () => ({ getResourceNameMapByResourceCds: resources.names }));

const dashboardId = randomUUID();
const prefix = randomUUID().slice(0, 8).toUpperCase();
const machineA = `${prefix}A`;
const machineB = `${prefix}B`;
const rowIds: string[] = [];

async function schedule(rowData: Prisma.InputJsonValue | null, quantity?: number) {
  const row = await prisma.csvDashboardRow.create({ data: {
    csvDashboardId: dashboardId, occurredAt: new Date('2026-09-01T00:00:00Z'), rowData: rowData ?? Prisma.JsonNull,
  } });
  rowIds.push(row.id);
  if (quantity !== undefined) {
    await prisma.productionScheduleOrderSupplement.create({ data: {
      // The list accepts a supplement from a different dashboard scope than registration.
      csvDashboardId: dashboardId, sourceCsvDashboardId: dashboardId, csvDashboardRowId: row.id,
      productNo: row.id.slice(0, 20), resourceCd: machineA, processOrder: '10',
      plannedQuantity: quantity, plannedStartDate: new Date('2026-09-02T00:00:00Z'),
    } });
  }
  return row.id;
}

async function item(overrides: Partial<Prisma.MachinePalletItemUncheckedCreateInput> = {}) {
  return prisma.machinePalletItem.create({ data: {
    resourceCd: machineA, palletNo: 1, displayOrder: 1,
    fhincd: 'P', fhinmei: 'Part', fseiban: 'S', machineName: 'abc-extra', ...overrides,
  } });
}

function expectedItem(id: string, csvDashboardRowId: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id, machineCd: machineA, palletNo: 1, displayOrder: 1,
    fhincd: 'P', fhinmei: 'Part', fseiban: 'S', machineName: 'abc-extra', machineNameDisplay: 'ABC',
    csvDashboardRowId, plannedStartDateDisplay: null, plannedQuantity: null, outsideDimensionsDisplay: null,
    ...overrides,
  };
}

describe('pallet list schedule fallback contract (PostgreSQL)', () => {
  beforeAll(async () => {
    await prisma.csvDashboard.create({ data: {
      id: dashboardId, name: 'Pallet list contract fixture', columnDefinitions: [], templateConfig: {},
    } });
  });
  beforeEach(() => {
    resources.registered.mockResolvedValue([machineB, machineA]);
    resources.names.mockResolvedValue({ [machineA]: ['Machine A'], [machineB]: ['Machine B'] });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await prisma.machinePalletItem.deleteMany({ where: { resourceCd: { in: [machineA, machineB] } } });
    await prisma.palletMachineIllustration.deleteMany({ where: { resourceCd: { in: [machineA, machineB] } } });
    await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds.splice(0) } } });
  });
  afterAll(async () => {
    await prisma.csvDashboard.delete({ where: { id: dashboardId } });
    await prisma.$disconnect();
  });

  it('preserves registered/pallet/item order, metadata and one deduplicated, unscoped batch read', async () => {
    const rowA = await schedule({ FGAISUN: ' 10  x  20 ' }, 0);
    const rowB = await schedule({ FGAISUN: ' ', FSUNPO: 17 });
    const second = await item({ palletNo: 2, displayOrder: 2, csvDashboardRowId: rowA });
    const first = await item({ palletNo: 2, displayOrder: 1, csvDashboardRowId: rowA });
    const other = await item({ resourceCd: machineB, palletNo: 3, csvDashboardRowId: rowB });
    await prisma.palletMachineIllustration.create({ data: { resourceCd: machineA, palletCount: 2, imageRelativeUrl: '/a.png' } });
    await prisma.palletMachineIllustration.create({ data: { resourceCd: machineB, palletCount: 2, imageRelativeUrl: null } });
    const read = vi.spyOn(prisma.csvDashboardRow, 'findMany');
    await expect(queryPalletVisualizationBoard({ machineCds: [machineA.toLowerCase(), machineB, machineA, 'unknown'] })).resolves.toEqual({ machines: [
      { machineCd: machineB, machineName: 'Machine B', illustrationUrl: null, palletCount: 2, pallets: [
        { palletNo: 1, items: [] }, { palletNo: 2, items: [] },
        { palletNo: 3, items: [expectedItem(other.id, rowB, { machineCd: machineB, palletNo: 3, outsideDimensionsDisplay: '17' })] },
      ] },
      { machineCd: machineA, machineName: 'Machine A', illustrationUrl: '/a.png', palletCount: 2, pallets: [
        { palletNo: 1, items: [] },
        { palletNo: 2, items: [first, second].map((entry) => expectedItem(entry.id, rowA, {
          palletNo: 2, displayOrder: entry.displayOrder, plannedQuantity: 0,
          plannedStartDateDisplay: '2026-09-02', outsideDimensionsDisplay: '10 x 20',
        })) },
      ] },
    ] });
    expect(read).toHaveBeenCalledExactlyOnceWith({ where: { id: { in: [rowA, rowB] } }, select: {
      id: true, rowData: true, orderSupplements: { take: 1, select: { plannedQuantity: true, plannedStartDate: true } },
    } });
  });

  it('prefers saved snapshot values field by field, including zero, while filling invalid/missing values', async () => {
    const rowId = await schedule({ FGAISUN: ' current ' }, 9);
    const saved = await item({ csvDashboardRowId: rowId, scheduleSnapshot: {
      plannedQuantity: 0, plannedStartDateDisplay: ' saved-date ', outsideDimensionsDisplay: ' saved  size ',
    } });
    const partial = await item({ displayOrder: 2, csvDashboardRowId: rowId, scheduleSnapshot: {
      plannedQuantity: 'invalid', plannedStartDateDisplay: ' ', outsideDimensionsDisplay: ' retained ',
    } });
    const result = await queryPalletVisualizationMachine(` ${machineA.toLowerCase()} `);
    expect(result.machine.pallets[0]?.items).toEqual([
      expectedItem(saved.id, rowId, { plannedQuantity: 0, plannedStartDateDisplay: 'saved-date', outsideDimensionsDisplay: 'saved size' }),
      expectedItem(partial.id, rowId, { displayOrder: 2, plannedQuantity: 9, plannedStartDateDisplay: '2026-09-02', outsideDimensionsDisplay: 'retained' }),
    ]);
    expect(result.machine.palletCount).toBe(10);
  });

  it('preserves saved data when a referenced CSV row is gone and keeps missing fallbacks null', async () => {
    const missing = randomUUID();
    const saved = await item({ csvDashboardRowId: missing, scheduleSnapshot: { plannedQuantity: 0 } });
    const absent = await item({ displayOrder: 2, csvDashboardRowId: missing });
    const result = await queryPalletVisualizationMachine(machineA);
    expect(result.machine.pallets[0]?.items).toEqual([
      expectedItem(saved.id, missing, { plannedQuantity: 0 }), expectedItem(absent.id, missing, { displayOrder: 2 }),
    ]);
  });

  it.each([null, '', 0, false, ['unexpected'], {}])('keeps fallback null for rowData=%j with no supplement', async (raw) => {
    const rowId = await schedule(raw);
    const saved = await item({ csvDashboardRowId: rowId });
    const result = await queryPalletVisualizationMachine(machineA);
    expect(result.machine.pallets[0]?.items).toEqual([expectedItem(saved.id, rowId)]);
  });

  it('skips the schedule query when there are no referenced IDs, including null and empty IDs', async () => {
    const read = vi.spyOn(prisma.csvDashboardRow, 'findMany');
    const empty = await queryPalletVisualizationMachine(machineA);
    expect(empty.machine.pallets.every((pallet) => pallet.items.length === 0)).toBe(true);
    const nullId = await item();
    const emptyId = await item({ displayOrder: 2, csvDashboardRowId: '' });
    const result = await queryPalletVisualizationMachine(machineA);
    expect(result.machine.pallets[0]?.items).toEqual([
      expectedItem(nullId.id, null), expectedItem(emptyId.id, '', { displayOrder: 2 }),
    ]);
    expect(read).not.toHaveBeenCalled();
  });

  it('retains empty board and unknown-machine behavior without reading schedule rows', async () => {
    const read = vi.spyOn(prisma.csvDashboardRow, 'findMany');
    await expect(queryPalletVisualizationBoard({ machineCds: ['unknown'] })).resolves.toEqual({ machines: [] });
    await expect(queryPalletVisualizationMachine('unknown')).rejects.toMatchObject({
      statusCode: 404, code: 'PALLET_MACHINE_NOT_REGISTERED', message: '加工機（資源マスタ）が登録されていません',
    });
    resources.registered.mockResolvedValue([]);
    await expect(queryPalletVisualizationBoard()).resolves.toEqual({ machines: [] });
    expect(read).not.toHaveBeenCalled();
  });

  it('preserves the machine summary response and its single schedule read', async () => {
    const rowId = await schedule({ FSUNPO: 0 });
    await item({ csvDashboardRowId: rowId });
    const read = vi.spyOn(prisma.csvDashboardRow, 'findMany');
    await expect(queryPalletVisualizationMachines()).resolves.toEqual({ machines: [
      { machineCd: machineB, machineName: 'Machine B', illustrationUrl: null, palletCount: 10 },
      { machineCd: machineA, machineName: 'Machine A', illustrationUrl: null, palletCount: 10 },
    ] });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('propagates the original database error without retrying the schedule query', async () => {
    await item({ csvDashboardRowId: randomUUID() });
    const error = new Error('schedule read unavailable');
    const read = vi.spyOn(prisma.csvDashboardRow, 'findMany').mockRejectedValueOnce(error);
    await expect(queryPalletVisualizationBoard()).rejects.toBe(error);
    expect(read).toHaveBeenCalledTimes(1);
  });
});
