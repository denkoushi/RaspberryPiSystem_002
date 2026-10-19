import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { resolveFseibansMatchingMachineNameQuery } from '../../mobile-placement/part-search/part-search-machine-name-fseibans.service.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
} from '../constants.js';
import { getDueManagementSeibanDetail, listDueManagementSummaries } from '../due-management-query.service.js';
import { getProductionScheduleProgressOverview } from '../progress-overview-query.service.js';

const prefix = `MNSUP${randomUUID().slice(0, 8).toUpperCase()}`;
/** MH/SH 行が無く、補完テーブルにだけ機種名がある製番 */
const supplementOnlySeiban = `${prefix}-A`;
/** MH/SH 行に機種名があり、補完テーブルの名前は使われない製番 */
const machineRowSeiban = `${prefix}-B`;
const supplementMachineName = `${prefix} 補完機種`;
const machineRowName = `${prefix} 行の機種`;

const searchState = vi.hoisted(() => ({ history: [] as string[] }));
vi.mock('../production-schedule-search-state.service.js', () => ({
  getProductionScheduleSearchState: vi.fn(async () => ({
    state: { history: searchState.history },
    updatedAt: null,
    etag: 'test',
  })),
}));

const rowIds: string[] = [];
let createdDashboard = false;

async function seedRow(suffix: string, rowData: Prisma.InputJsonObject) {
  const row = await prisma.csvDashboardRow.create({
    data: {
      id: `${prefix}-${suffix}`,
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date('2026-09-01T00:00:00Z'),
      rowData,
    },
  });
  rowIds.push(row.id);
}

describe('製番の機種名: MH/SH 行が無いときの補完テーブル (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!(await prisma.csvDashboard.findUnique({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID } }))) {
      await prisma.csvDashboard.create({
        data: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: prefix, columnDefinitions: [], templateConfig: {} },
      });
      createdDashboard = true;
    }
    await seedRow('a-part', {
      ProductNo: `${prefix}01`, FSEIBAN: supplementOnlySeiban, FHINCD: 'P-001', FHINMEI: '部品A',
      FSIGENCD: 'MC01', FKOJUN: '10', FSIGENSHOYORYO: '5',
    });
    await seedRow('b-machine', {
      ProductNo: `${prefix}02`, FSEIBAN: machineRowSeiban, FHINCD: 'MH-001', FHINMEI: machineRowName,
      FSIGENCD: 'MC01', FKOJUN: '10', FSIGENSHOYORYO: '5',
    });
    await seedRow('b-part', {
      ProductNo: `${prefix}03`, FSEIBAN: machineRowSeiban, FHINCD: 'P-002', FHINMEI: '部品B',
      FSIGENCD: 'MC01', FKOJUN: '10', FSIGENSHOYORYO: '5',
    });
    await prisma.productionScheduleSeibanMachineNameSupplement.createMany({
      data: [
        { fseiban: supplementOnlySeiban, machineName: supplementMachineName },
        { fseiban: machineRowSeiban, machineName: `${prefix} 使われない補完` },
      ].map((row) => ({ ...row, sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID })),
    });
    searchState.history = [supplementOnlySeiban, machineRowSeiban];
  });

  afterAll(async () => {
    await prisma.productionScheduleSeibanMachineNameSupplement.deleteMany({
      where: { fseiban: { in: [supplementOnlySeiban, machineRowSeiban] } },
    });
    await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
    if (createdDashboard) {
      await prisma.csvDashboard.delete({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID } });
    }
    await prisma.$disconnect();
  });

  it('納期管理の一覧と詳細に補完テーブルの機種名が出る', async () => {
    const summaries = await listDueManagementSummaries('test-location');
    const byFseiban = new Map(summaries.map((summary) => [summary.fseiban, summary.machineName]));
    expect(byFseiban.get(supplementOnlySeiban)).toBe(supplementMachineName);
    expect(byFseiban.get(machineRowSeiban)).toBe(machineRowName);

    const detail = await getDueManagementSeibanDetail({ locationKey: 'test-location', fseiban: supplementOnlySeiban });
    expect(detail.machineName).toBe(supplementMachineName);
    const machineDetail = await getDueManagementSeibanDetail({ locationKey: 'test-location', fseiban: machineRowSeiban });
    expect(machineDetail.machineName).toBe(machineRowName);
  });

  it('進捗一覧（キオスク・サイネージ共通）に補完テーブルの機種名が出る', async () => {
    const overview = await getProductionScheduleProgressOverview('test-location');
    const items = [...overview.scheduled, ...overview.unscheduled];
    const byFseiban = new Map(items.map((item) => [item.fseiban, item.machineName]));
    expect(byFseiban.get(supplementOnlySeiban)).toBe(supplementMachineName);
    expect(byFseiban.get(machineRowSeiban)).toBe(machineRowName);
  });

  it('機種名検索が補完テーブルの機種名でも製番を拾い、MH/SH 行の名前を優先する', async () => {
    await expect(resolveFseibansMatchingMachineNameQuery(supplementMachineName)).resolves.toEqual(
      new Set([supplementOnlySeiban])
    );
    await expect(resolveFseibansMatchingMachineNameQuery(machineRowName)).resolves.toEqual(new Set([machineRowSeiban]));
    await expect(resolveFseibansMatchingMachineNameQuery(`${prefix} 使われない補完`)).resolves.toEqual(new Set());
  });
});
