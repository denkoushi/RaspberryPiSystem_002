import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  upsertProductionScheduleDueDate,
  upsertProductionScheduleNote,
  upsertProductionScheduleProcessingType
} from '../production-schedule-command.service.js';

const LOCATION = `SHARED-WRITERS-${randomUUID()}`;
const PROCESSING_TYPE = 'many-writers';
const DUE_DATE_TEXT = '2026-12-01';
const DUE_DATE = new Date(`${DUE_DATE_TEXT}T00:00:00.000Z`);
const REPEATS = 5;
const rowIds: string[] = [];
const optionIds: string[] = [];

async function cleanup(): Promise<void> {
  await prisma.productionScheduleDueDateAuditLog.deleteMany({ where: { location: LOCATION } });
  await prisma.productionScheduleRowNote.deleteMany({ where: { csvDashboardRowId: { in: rowIds } } });
  await prisma.csvDashboardRow.deleteMany({ where: { id: { in: rowIds } } });
  await prisma.productionScheduleProcessingTypeOption.deleteMany({ where: { id: { in: optionIds } } });
}

describe('shared schedule fields with six concurrent writers', () => {
  beforeAll(async () => {
    await prisma.csvDashboard.upsert({
      where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      create: {
        id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        name: 'Shared fields many writers test',
        columnDefinitions: [],
        templateConfig: {}
      },
      update: {}
    });
    const option = await prisma.productionScheduleProcessingTypeOption.create({
      data: { location: LOCATION, code: PROCESSING_TYPE, label: PROCESSING_TYPE, enabled: true, priority: 10 }
    });
    optionIds.push(option.id);
    const row = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        // No FHINCD: exercise the row fields without updating the separate part-level field.
        rowData: { progress: '未完了' }
      }
    });
    rowIds.push(row.id);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
    }
  });

  it.each(['save', 'clear'] as const)('備考%s・納期・処理種別を各2本同時保存しても全て成功し3欄が残る', async (mode) => {
    const rowId = rowIds[0]!;
    const params = { rowId, locationKey: LOCATION };
    for (let iteration = 0; iteration < REPEATS; iteration++) {
      await prisma.productionScheduleRowNote.deleteMany({ where: { csvDashboardRowId: rowId } });
      if (mode === 'clear') {
        await prisma.productionScheduleRowNote.create({
          data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: rowId, note: 'old' }
        });
      }
      const note = mode === 'save' ? `saved note ${iteration}` : '';
      const writers = [
        () => upsertProductionScheduleNote({ ...params, note }),
        () => upsertProductionScheduleDueDate({ ...params, dueDateText: DUE_DATE_TEXT }),
        () => upsertProductionScheduleProcessingType({ ...params, processingType: PROCESSING_TYPE }),
        () => upsertProductionScheduleNote({ ...params, note }),
        () => upsertProductionScheduleDueDate({ ...params, dueDateText: DUE_DATE_TEXT }),
        () => upsertProductionScheduleProcessingType({ ...params, processingType: PROCESSING_TYPE })
      ];
      if (iteration % 2 === 1) writers.reverse();
      const results = await Promise.allSettled(writers.map((write) => write()));
      for (const result of results) expect(result).toMatchObject({ status: 'fulfilled' });
      const saved = await prisma.productionScheduleRowNote.findUniqueOrThrow({ where: { csvDashboardRowId: rowId } });
      expect(saved).toMatchObject({ note, dueDate: DUE_DATE, processingType: PROCESSING_TYPE });
    }
  });
});
