import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID } from '../constants.js';
import { ProductionScheduleSeibanMachineNameSupplementSyncService } from '../seiban-machine-name-supplement-sync.service.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

describe('ProductionScheduleSeibanMachineNameSupplementSyncService', () => {
  const service = new ProductionScheduleSeibanMachineNameSupplementSyncService();

  beforeEach(async () => {
    await prisma.productionScheduleSeibanMachineNameSupplement.deleteMany({});
    await prisma.csvDashboardRow.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
    });
    await prisma.csvDashboardIngestRun.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
    });
    await prisma.csvDashboard.deleteMany({
      where: { id: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
    });

    await prisma.csvDashboard.create({
      data: {
        id: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        name: 'ProductionSchedule_SeibanMachineNameSupplement_Test',
        ingestMode: 'APPEND',
        columnDefinitions: [
          { internalName: 'FSEIBAN', displayName: '製番', dataType: 'string', order: 0 },
          { internalName: 'FHINMEI_MH_SH', displayName: '機種名', dataType: 'string', order: 1 },
        ],
        templateType: 'TABLE',
        templateConfig: {
          rowsPerPage: 10,
          fontSize: 14,
          displayColumns: ['FSEIBAN', 'FHINMEI_MH_SH'],
        },
      },
    });
  });

  afterAll(async () => {
    await prisma.productionScheduleSeibanMachineNameSupplement.deleteMany({});
    await prisma.csvDashboardRow.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
    });
    await prisma.csvDashboardIngestRun.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
    });
    await prisma.csvDashboard.deleteMany({
      where: { id: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID },
    });
  });

  it('指定 ingest run で追加された行だけを使い、同一製番は末尾行を採用する', async () => {
    const startedAt = new Date('2026-04-17T04:00:00.000Z');
    const completedAt = new Date('2026-04-17T04:00:10.000Z');

    const ingestRun = await prisma.csvDashboardIngestRun.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        status: 'COMPLETED',
        rowsProcessed: 3,
        rowsAdded: 3,
        rowsSkipped: 0,
        startedAt,
        completedAt,
      },
    });

    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        occurredAt: startedAt,
        rowData: { FSEIBAN: 'OUTSIDE', FHINMEI_MH_SH: '前run' },
        createdAt: new Date('2026-04-17T03:59:59.000Z'),
      },
    });
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        occurredAt: startedAt,
        rowData: { FSEIBAN: 'S-1', FHINMEI_MH_SH: '1件目' },
        createdAt: new Date('2026-04-17T04:00:01.000Z'),
      },
    });
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        occurredAt: startedAt,
        rowData: { FSEIBAN: 'S-1', FHINMEI_MH_SH: '最終値' },
        createdAt: new Date('2026-04-17T04:00:02.000Z'),
      },
    });
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        occurredAt: startedAt,
        rowData: { FSEIBAN: 'S-2', FHINMEI_MH_SH: '別製番' },
        createdAt: new Date('2026-04-17T04:00:03.000Z'),
      },
    });

    await prisma.productionScheduleSeibanMachineNameSupplement.create({
      data: {
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_SEIBAN_MACHINE_NAME_SUPPLEMENT_DASHBOARD_ID,
        fseiban: 'OLD',
        machineName: '旧値',
      },
    });

    const result = await service.syncFromSupplementDashboard({ ingestRunId: ingestRun.id });

    expect(result).toMatchObject({
      scanned: 3,
      normalized: 2,
      upserted: 2,
      pruned: 1,
    });

    const rows = await prisma.productionScheduleSeibanMachineNameSupplement.findMany({
      orderBy: { fseiban: 'asc' },
    });
    expect(rows.map((row) => ({ fseiban: row.fseiban, machineName: row.machineName }))).toEqual([
      { fseiban: 'S-1', machineName: '最終値' },
      { fseiban: 'S-2', machineName: '別製番' },
    ]);
  });
});
