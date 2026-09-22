import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import {
  listScheduleRowsByFseiban,
  listScheduleRowsByProductNo,
  resolveMachineNameForSeiban,
} from '../production-schedule-lookup.service.js';
import * as legacyLookup from '../../part-measurement/part-measurement-schedule-lookup.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

const fixturePrefix = `schedule-lookup-${randomUUID()}`;
const rowIds: string[] = [];
const createdDashboardIds: string[] = [];
const otherDashboardId = randomUUID();
const occurredAt = new Date('2026-09-01T00:00:00Z');

async function seed(
  suffix: string,
  rowData: Prisma.InputJsonObject,
  options: { createdAt?: Date; dashboardId?: string } = {},
) {
  const id = `${fixturePrefix}-${suffix}`;
  await prisma.csvDashboardRow.create({
    data: {
      id,
      csvDashboardId: options.dashboardId ?? PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt,
      createdAt: options.createdAt ?? occurredAt,
      rowData,
    },
  });
  rowIds.push(id);
  return id;
}

function scheduleRow(suffix: string, overrides: Prisma.InputJsonObject = {}): Prisma.InputJsonObject {
  return {
    ProductNo: `${fixturePrefix}-${suffix}`,
    FSEIBAN: `${fixturePrefix}-${suffix}`,
    FHINCD: 'PART-A',
    FHINMEI: 'Part A',
    FSIGENCD: 'MC01',
    FKOJUN: '10',
    ...overrides,
  };
}

describe('production schedule lookup compatibility (PostgreSQL)', () => {
  it('keeps legacy imports as the same functions without a second implementation', () => {
    expect(legacyLookup.listScheduleRowsByProductNo).toBe(listScheduleRowsByProductNo);
    expect(legacyLookup.listScheduleRowsByFseiban).toBe(listScheduleRowsByFseiban);
    expect(legacyLookup.resolveMachineNameForSeiban).toBe(resolveMachineNameForSeiban);
  });

  beforeAll(async () => {
    for (const id of [PRODUCTION_SCHEDULE_DASHBOARD_ID, otherDashboardId]) {
      if (await prisma.csvDashboard.findUnique({ where: { id } })) continue;
      await prisma.csvDashboard.create({
        data: { id, name: fixturePrefix, columnDefinitions: [], templateConfig: {} },
      });
      createdDashboardIds.push(id);
    }
  });

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
    await prisma.csvDashboard.deleteMany({ where: { id: { in: createdDashboardIds } } });
    await prisma.$disconnect();
  });

  it('returns empty results without querying for blank inputs', async () => {
    const query = vi.spyOn(prisma, '$queryRaw');
    await expect(listScheduleRowsByProductNo(' \t ')).resolves.toEqual([]);
    await expect(listScheduleRowsByFseiban(' \n ')).resolves.toEqual([]);
    await expect(resolveMachineNameForSeiban(' ')).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('selects the numeric maximum ProductNo before filtering and scopes winners to the dashboard', async () => {
    const seiban = `${fixturePrefix}-winner`;
    const data = scheduleRow('winner', { FSEIBAN: seiban });
    await seed('old', { ...data, ProductNo: '970000008' });
    const winnerId = await seed('winner', { ...data, ProductNo: '970000010' });
    await seed('other-dashboard', { ...data, ProductNo: '970000099' }, { dashboardId: otherDashboardId });
    await expect(listScheduleRowsByProductNo('970000008')).resolves.toEqual([]);
    expect((await listScheduleRowsByProductNo('970000010')).map((row) => row.rowId)).toEqual([winnerId]);
    expect((await listScheduleRowsByFseiban(seiban)).map((row) => row.rowId)).toEqual([winnerId]);
    await expect(listScheduleRowsByProductNo('970000099')).resolves.toEqual([]);
  });

  it('uses createdAt descending then id descending to break winner ties', async () => {
    const data = scheduleRow('ties');
    await seed('ties-zz-old', data, { createdAt: new Date('2026-08-01T00:00:00Z') });
    await seed('ties-a', data);
    const winnerId = await seed('ties-z', data);
    expect((await listScheduleRowsByProductNo(String(data.ProductNo))).map((row) => row.rowId)).toEqual([winnerId]);
  });

  it('preserves all seven fields, integer/null conversion, filtering and candidate order', async () => {
    const data = scheduleRow('ordering');
    const nullId = await seed('order-null', { ...data, FHINCD: 'PART-C', FKOJUN: ' 10 ' });
    const twentyId = await seed('order-20', { ...data, FHINCD: 'PART-A', FKOJUN: '20' });
    const tenBId = await seed('order-10-b', { ...data, FHINCD: 'PART-B', FKOJUN: '10' });
    const tenAId = await seed('order-10-a', { ...data, FHINCD: ' PART-A ', FHINMEI: ' Part A ', FSIGENCD: ' MC01 ', FKOJUN: '10' });
    const invalidId = await seed('order-invalid', { ...data, FHINCD: 'PART-D', FKOJUN: 'invalid' });
    await seed('empty-seiban', { ...data, FSEIBAN: ' ' });
    await seed('empty-part', { ...data, FHINCD: null });
    await seed('empty-resource', { ...data, FSIGENCD: '' });
    const query = vi.spyOn(prisma, '$queryRaw');
    const rows = await listScheduleRowsByProductNo(String(data.ProductNo));
    expect(query).toHaveBeenCalledTimes(1);
    expect(rows).toEqual([
      { rowId: tenAId, fseiban: data.FSEIBAN, productNo: data.ProductNo, fhincd: 'PART-A', fhinmei: 'Part A', fsigencd: 'MC01', fkojun: 10 },
      { rowId: tenBId, fseiban: data.FSEIBAN, productNo: data.ProductNo, fhincd: 'PART-B', fhinmei: 'Part A', fsigencd: 'MC01', fkojun: 10 },
      { rowId: twentyId, fseiban: data.FSEIBAN, productNo: data.ProductNo, fhincd: 'PART-A', fhinmei: 'Part A', fsigencd: 'MC01', fkojun: 20 },
      { rowId: nullId, fseiban: data.FSEIBAN, productNo: data.ProductNo, fhincd: 'PART-C', fhinmei: 'Part A', fsigencd: 'MC01', fkojun: null },
      { rowId: invalidId, fseiban: data.FSEIBAN, productNo: data.ProductNo, fhincd: 'PART-D', fhinmei: 'Part A', fsigencd: 'MC01', fkojun: null },
    ]);
    expect(await listScheduleRowsByFseiban(String(data.FSEIBAN))).toEqual(rows);
  });

  it('trims input and output but keeps exact case-sensitive matching', async () => {
    const productNo = `${fixturePrefix}-AbC`;
    const seiban = `${fixturePrefix}-Seiban`;
    const id = await seed('trim', scheduleRow('trim', { ProductNo: ` ${productNo} `, FSEIBAN: ` ${seiban} `, FHINMEI: null }));
    const rows = await listScheduleRowsByProductNo(` ${productNo}\t`);
    expect(rows).toEqual([{ rowId: id, fseiban: seiban, productNo, fhincd: 'PART-A', fhinmei: '', fsigencd: 'MC01', fkojun: 10 }]);
    expect(await listScheduleRowsByFseiban(` ${seiban} `)).toEqual(rows);
    await expect(listScheduleRowsByProductNo(productNo.toLowerCase())).resolves.toEqual([]);
    await expect(listScheduleRowsByFseiban(seiban.toLowerCase())).resolves.toEqual([]);
    await expect(listScheduleRowsByProductNo(`${productNo}-missing`)).resolves.toEqual([]);
  });

  it.each(['MH', 'SH'])('retains the %s machine-name aggregation and input trimming', async (prefix) => {
    const seiban = `${fixturePrefix}-machine-${prefix}`;
    await seed(`machine-${prefix}`, scheduleRow(`machine-${prefix}`, {
      FSEIBAN: seiban, FHINCD: `${prefix}001`, FHINMEI: ' Model A ',
    }));
    const query = vi.spyOn(prisma, '$queryRaw');
    await expect(resolveMachineNameForSeiban(` ${seiban} `)).resolves.toBe('Model A');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('returns null when there is no machine row or no matching seiban', async () => {
    const data = scheduleRow('no-machine');
    await seed('no-machine', data);
    await expect(resolveMachineNameForSeiban(String(data.FSEIBAN))).resolves.toBeNull();
    await expect(resolveMachineNameForSeiban(`${fixturePrefix}-missing`)).resolves.toBeNull();
  });

  it.each([
    ['ProductNo', listScheduleRowsByProductNo],
    ['FSEIBAN', listScheduleRowsByFseiban],
    ['machine name', resolveMachineNameForSeiban],
  ])('propagates database failures from %s lookup', async (_name, lookup) => {
    const failure = new Error('database unavailable');
    const query = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(failure);
    await expect(lookup('nonblank')).rejects.toBe(failure);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
