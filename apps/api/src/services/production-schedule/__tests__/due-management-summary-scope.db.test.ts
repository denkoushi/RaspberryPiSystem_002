import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { listEarliestEffectiveDueDateBySeiban } from '../due-date-resolution.service.js';
import { listDueManagementSummaries } from '../due-management-query.service.js';
import { listDueManagementTriage } from '../due-management-triage.service.js';

const prefix = `DMSC${randomUUID().slice(0, 8).toUpperCase()}`;
const location = `${prefix}-loc`;
const seibanA = `${prefix}-A`;
const seibanB = `${prefix}-B`;
const seibanC = `${prefix}-C`;
const fhincdA = `${prefix}P1`;
const fhincdA2 = `${prefix}P2`;

const rowIds: string[] = [];
let createdDashboard = false;

async function seedRow(
  suffix: string,
  rowData: Prisma.InputJsonObject,
  note?: { dueDate: string | null }
): Promise<void> {
  const id = `${prefix}-${suffix}`;
  await prisma.csvDashboardRow.create({
    data: {
      id,
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date('2026-09-01T00:00:00Z'),
      rowData
    }
  });
  rowIds.push(id);
  if (note) {
    await prisma.productionScheduleRowNote.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: id,
        note: 'n',
        dueDate: note.dueDate ? new Date(note.dueDate) : null
      }
    });
  }
}

const pickOwn = <T extends { fseiban: string }>(rows: T[]): T[] => rows.filter((row) => row.fseiban.startsWith(prefix));

describe('納期管理サマリ: 製番スコープ指定は全件集計後の絞り込みと同じ結果 (PostgreSQL)', () => {
  beforeAll(async () => {
    if (!(await prisma.csvDashboard.findUnique({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID } }))) {
      await prisma.csvDashboard.create({
        data: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID, name: prefix, columnDefinitions: [], templateConfig: {} }
      });
      createdDashboard = true;
    }
    // 製番A: 同じ論理キーの古い ProductNo 行（勝者ではない）のメモ納期は無視される
    await seedRow(
      'a1-old',
      { ProductNo: '100', FSEIBAN: seibanA, FHINCD: fhincdA, FHINMEI: '部品', FSIGENCD: 'MC01', FKOJUN: '10', FSIGENSHOYORYO: '5' },
      { dueDate: '2026-01-01' }
    );
    await seedRow(
      'a1',
      { ProductNo: '200', FSEIBAN: seibanA, FHINCD: fhincdA, FHINMEI: '部品', FSIGENCD: 'MC01', FKOJUN: '10', FSIGENSHOYORYO: '5' },
      { dueDate: '2026-12-10' }
    );
    await seedRow(
      'a2',
      { ProductNo: '201', FSEIBAN: seibanA, FHINCD: fhincdA, FHINMEI: '部品', FSIGENCD: 'MC02', FKOJUN: '20', FSIGENSHOYORYO: '2.5' },
      { dueDate: '2026-12-05' }
    );
    // 完了行は件数には入るがカバレッジの分母には入らない
    await seedRow('a3', {
      ProductNo: '202', FSEIBAN: seibanA, FHINCD: fhincdA2, FHINMEI: '部品2', FSIGENCD: 'MC01', FKOJUN: '10', FSIGENSHOYORYO: 'x',
      FPROGRESS: '完了'
    });
    await seedRow('a4', {
      ProductNo: '203', FSEIBAN: seibanA, FHINCD: `MH${prefix}`, FHINMEI: '機種A', FSIGENCD: 'MC03', FKOJUN: '10', FSIGENSHOYORYO: '1'
    });
    // 製番B: メモ納期なし
    await seedRow('b1', {
      ProductNo: '300', FSEIBAN: seibanB, FHINCD: fhincdA, FHINMEI: '部品', FSIGENCD: 'MC01', FKOJUN: '10', FSIGENSHOYORYO: '3'
    });
    await seedRow('b2', { ProductNo: '301', FSEIBAN: seibanB, FHINCD: fhincdA2, FHINMEI: '部品2', FSIGENCD: 'MC01', FKOJUN: '10' }, {
      dueDate: null
    });
    // 製番C: スコープ外
    await seedRow('c1', {
      ProductNo: '400', FSEIBAN: seibanC, FHINCD: fhincdA, FHINMEI: '部品', FSIGENCD: 'MC01', FKOJUN: '10', FSIGENSHOYORYO: '7'
    }, { dueDate: '2026-11-20' });

    await prisma.productionScheduleActualHoursFeature.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location,
        fhincd: fhincdA,
        resourceCd: 'MC01',
        sampleCount: 3,
        medianPerPieceMinutes: 4,
        p75PerPieceMinutes: 5,
        windowFrom: new Date('2026-01-01T00:00:00Z'),
        windowTo: new Date('2026-06-01T00:00:00Z')
      }
    });
    await prisma.productionScheduleSeibanDueDate.create({
      data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: seibanB, dueDate: new Date('2026-12-24') }
    });
  });

  afterAll(async () => {
    await prisma.productionScheduleSeibanDueDate.deleteMany({ where: { fseiban: { in: [seibanA, seibanB, seibanC] } } });
    await prisma.productionScheduleActualHoursFeature.deleteMany({ where: { location } });
    await prisma.productionScheduleRowNote.deleteMany({ where: { csvDashboardRowId: { in: rowIds } } });
    await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
    if (createdDashboard) {
      await prisma.csvDashboard.delete({ where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID } });
    }
    await prisma.$disconnect();
  });

  it('全件集計の値（件数・所要時間・機種名・カバレッジ・納期）を製番ごとに返す', async () => {
    const all = pickOwn(await listDueManagementSummaries(location));
    expect(all).toEqual([
      {
        fseiban: seibanA,
        machineName: '機種A',
        dueDate: null,
        partsCount: 3,
        processCount: 4,
        totalRequiredMinutes: 8.5,
        actualEstimatedMinutes: 0,
        // 未完了3行のうち (fhincdA, MC01) の1行だけ実績あり
        actualCoverageRatio: 1 / 3
      },
      {
        fseiban: seibanB,
        machineName: null,
        dueDate: new Date('2026-12-24T00:00:00.000Z'),
        partsCount: 2,
        processCount: 2,
        totalRequiredMinutes: 3,
        actualEstimatedMinutes: 0,
        actualCoverageRatio: 0.5
      },
      {
        fseiban: seibanC,
        machineName: null,
        dueDate: null,
        partsCount: 1,
        processCount: 1,
        totalRequiredMinutes: 7,
        actualEstimatedMinutes: 0,
        actualCoverageRatio: 1
      }
    ]);
  });

  it('fseibans 指定は全件結果をその製番に絞ったものと一致し、空配列なら空', async () => {
    const all = pickOwn(await listDueManagementSummaries(location));
    const scoped = await listDueManagementSummaries(location, { fseibans: [seibanB, seibanA, `${prefix}-none`] });
    expect(scoped).toEqual(all.filter((row) => row.fseiban === seibanA || row.fseiban === seibanB));
    await expect(listDueManagementSummaries(location, { fseibans: [] })).resolves.toEqual([]);
  });

  it('メモ納期の最小値は勝者行だけで決まり、メモが無い製番は null', async () => {
    const map = await listEarliestEffectiveDueDateBySeiban([seibanA, seibanB, seibanC]);
    expect(map).toEqual(
      new Map([
        [seibanA, new Date('2026-12-05T00:00:00.000Z')],
        [seibanB, null],
        [seibanC, new Date('2026-11-20T00:00:00.000Z')]
      ])
    );
  });

  it('トリアージは対象製番だけを返し、対象が空なら空のゾーンを返す', async () => {
    const triage = await listDueManagementTriage({
      locationScope: { deviceScopeKey: location },
      targetFseibans: [` ${seibanA} `, seibanB],
      selectedFseibans: [seibanB]
    });
    const items = [...triage.zones.danger, ...triage.zones.caution, ...triage.zones.safe];
    expect(items.map((item) => item.fseiban).sort()).toEqual([seibanA, seibanB]);
    const itemA = items.find((item) => item.fseiban === seibanA);
    expect(itemA?.dueDate).toEqual(new Date('2026-12-05T00:00:00.000Z'));
    expect(itemA?.actualCoverageRatio).toBeCloseTo(1 / 3);
    expect(items.find((item) => item.fseiban === seibanB)).toMatchObject({ dueDate: null, isSelected: true });

    await expect(
      listDueManagementTriage({ locationScope: { deviceScopeKey: location }, targetFseibans: ['  '], selectedFseibans: [] })
    ).resolves.toEqual({ zones: { danger: [], caution: [], safe: [] } });
  });
});
