import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  upsertProductionScheduleDueManagementPartNote,
  upsertProductionSchedulePartPriorities,
  upsertProductionScheduleSeibanDueDate
} from '../due-management-command.service.js';

const LOCATION = 'DUE-WRITE-CONCURRENCY';
const FSEIBAN = 'DWC-SEIBAN-01';
const PARTS = ['DWC-A', 'DWC-B', 'DWC-C', 'DWC-D'];
const DUE_DATE_TEXT = '2026-12-01';
const DUE_DATE = new Date(`${DUE_DATE_TEXT}T00:00:00.000Z`);
const REPEATS = 10;
const rowIds: string[] = [];
const part = { locationKey: LOCATION, fseiban: FSEIBAN, fhincd: PARTS[0]! };

async function cleanup(): Promise<void> {
  await prisma.productionSchedulePartPriority.deleteMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: LOCATION, fseiban: FSEIBAN }
  });
  await prisma.productionScheduleDueDateAuditLog.deleteMany({ where: { fseiban: FSEIBAN, location: LOCATION } });
  await prisma.productionScheduleSeibanDueDate.deleteMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: FSEIBAN }
  });
  await prisma.productionScheduleRowNote.deleteMany({ where: { csvDashboardRowId: { in: rowIds } } });
  await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
}

// Exercise both invocation orders repeatedly using real, independent transactions.
async function race(first: () => Promise<unknown>, second: () => Promise<unknown>, iteration: number): Promise<void> {
  const writers = iteration % 2 === 0 ? [first, second] : [second, first];
  const results = await Promise.allSettled(writers.map((write) => write()));
  for (const result of results) expect(result).toMatchObject({ status: 'fulfilled' });
}

describe('due management write concurrency', () => {
  beforeAll(async () => {
    await prisma.csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      create: {
        id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        name: 'Due management write concurrency test',
        columnDefinitions: [],
        templateConfig: {}
      },
      update: {}
    });
    for (const fhincd of PARTS) {
      const row = await prisma.csvDashboardRow.create({
        data: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          occurredAt: new Date(),
          rowData: { FSEIBAN, FHINCD: fhincd, FSIGENCD: 'DWC', progress: '未完了' }
        }
      });
      rowIds.push(row.id);
    }
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
    }
  });

  it('備考クリアと納期保存を並行実行しても保存した納期が残る', async () => {
    for (let iteration = 0; iteration < REPEATS; iteration++) {
      await prisma.productionScheduleRowNote.upsert({
        where: { csvDashboardRowId: rowIds[0]! },
        create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: rowIds[0]!, note: 'old' },
        update: { note: 'old', dueDate: null, processingType: null }
      });
      await race(
        () => upsertProductionScheduleDueManagementPartNote({ ...part, note: '' }),
        () => upsertProductionScheduleSeibanDueDate({ ...part, dueDateText: DUE_DATE_TEXT }),
        iteration
      );
      const row = await prisma.productionScheduleRowNote.findUnique({ where: { csvDashboardRowId: rowIds[0]! } });
      expect(row).toMatchObject({ note: '', dueDate: DUE_DATE });
    }
  });

  it('納期取消と備考保存を並行実行しても保存した備考が残る', async () => {
    for (let iteration = 0; iteration < REPEATS; iteration++) {
      await prisma.productionScheduleRowNote.upsert({
        where: { csvDashboardRowId: rowIds[0]! },
        create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: rowIds[0]!, note: '', dueDate: DUE_DATE },
        update: { note: '', dueDate: DUE_DATE, processingType: null }
      });
      await race(
        () => upsertProductionScheduleSeibanDueDate({ ...part, dueDateText: '' }),
        () => upsertProductionScheduleDueManagementPartNote({ ...part, note: 'saved note' }),
        iteration
      );
      const row = await prisma.productionScheduleRowNote.findUnique({ where: { csvDashboardRowId: rowIds[0]! } });
      expect(row).toMatchObject({ note: 'saved note', dueDate: null });
    }
  });

  it('同じ製番の納期を並行保存しても両方が成功し一方の納期全体が残る', async () => {
    const dates = [DUE_DATE_TEXT, '2026-12-02'];
    for (let iteration = 0; iteration < REPEATS; iteration++) {
      await race(
        () => upsertProductionScheduleSeibanDueDate({ ...part, dueDateText: dates[0]! }),
        () => upsertProductionScheduleSeibanDueDate({ ...part, dueDateText: dates[1]! }),
        iteration
      );
      const saved = await prisma.productionScheduleSeibanDueDate.findUniqueOrThrow({
        where: { csvDashboardId_fseiban: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: FSEIBAN } }
      });
      expect(dates).toContain(saved.dueDate.toISOString().slice(0, 10));
      const rows = await prisma.productionScheduleRowNote.findMany({ where: { csvDashboardRowId: { in: rowIds } } });
      expect(rows).toHaveLength(rowIds.length);
      for (const row of rows) expect(row.dueDate).toEqual(saved.dueDate);
    }
  });

  it('同じ製番の部品優先順位を並行保存しても一方の順位全体が残る', async () => {
    const replacements = [[PARTS[0]!, PARTS[1]!], [PARTS[2]!, PARTS[3]!]];
    for (let iteration = 0; iteration < REPEATS; iteration++) {
      await prisma.productionSchedulePartPriority.deleteMany({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: LOCATION, fseiban: FSEIBAN }
      });
      await race(
        () => upsertProductionSchedulePartPriorities({ ...part, orderedFhincds: replacements[0]! }),
        () => upsertProductionSchedulePartPriorities({ ...part, orderedFhincds: replacements[1]! }),
        iteration
      );
      const priorities = await prisma.productionSchedulePartPriority.findMany({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, location: LOCATION, fseiban: FSEIBAN },
        orderBy: { priorityRank: 'asc' },
        select: { fhincd: true, priorityRank: true }
      });
      expect(replacements.map((parts) => parts.map((fhincd, index) => ({ fhincd, priorityRank: index + 1 })))).toContainEqual(priorities);
      expect(new Set(priorities.map((priority) => priority.priorityRank)).size).toBe(priorities.length);
    }
  });
});
