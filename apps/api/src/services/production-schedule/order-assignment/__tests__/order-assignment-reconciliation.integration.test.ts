import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../constants.js';
import { reconcileStaleProductionScheduleOrderAssignments } from '../order-assignment-reconciliation.service.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

const DASHBOARD_ID = PRODUCTION_SCHEDULE_DASHBOARD_ID;
const LOCATION = 'ReconcileTest';

describe('order-assignment reconciliation (integration)', () => {
  let rowVisibleId: string;
  let rowInvisibleId: string;
  let rowFormerWinnerId: string;
  let rowCurrentWinnerId: string;

  beforeAll(async () => {
    await prisma.csvDashboard.upsert({
      where: { id: DASHBOARD_ID },
      update: {},
      create: {
        id: DASHBOARD_ID,
        name: 'ProductionSchedule_Mishima_Grinding',
        columnDefinitions: [],
        templateType: 'CARD_GRID',
        templateConfig: {},
        ingestMode: 'DEDUP',
        dedupKeyColumns: ['ProductNo', 'FSEIBAN', 'FHINCD', 'FSIGENCD', 'FKOJUN'],
        dateColumnName: 'registeredAt',
        enabled: true,
      },
    });

    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'reconcile-visible',
          rowData: {
            ProductNo: '9001',
            FSEIBAN: 'RV',
            FHINCD: 'H1',
            FSIGENCD: '080',
            FKOJUN: '200',
          },
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date(),
          dataHash: 'reconcile-invisible',
          rowData: {
            ProductNo: '9002',
            FSEIBAN: 'RI',
            FHINCD: 'H2',
            FSIGENCD: '080',
            FKOJUN: '201',
          },
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date('2026-05-01T00:00:00.000Z'),
          dataHash: 'reconcile-former-winner',
          rowData: {
            ProductNo: '9100',
            FSEIBAN: 'RW',
            FHINCD: 'H3',
            FSIGENCD: '081',
            FKOJUN: '300',
          },
        },
        {
          csvDashboardId: DASHBOARD_ID,
          occurredAt: new Date('2026-05-02T00:00:00.000Z'),
          dataHash: 'reconcile-current-winner',
          rowData: {
            ProductNo: '9101',
            FSEIBAN: 'RW',
            FHINCD: 'H3',
            FSIGENCD: '081',
            FKOJUN: '300',
          },
        },
      ],
    });

    const rows = await prisma.csvDashboardRow.findMany({
      where: {
        csvDashboardId: DASHBOARD_ID,
        dataHash: {
          in: [
            'reconcile-visible',
            'reconcile-invisible',
            'reconcile-former-winner',
            'reconcile-current-winner',
          ],
        },
      },
      select: { id: true, dataHash: true },
    });
    rowVisibleId = rows.find((r) => r.dataHash === 'reconcile-visible')!.id;
    rowInvisibleId = rows.find((r) => r.dataHash === 'reconcile-invisible')!.id;
    rowFormerWinnerId = rows.find((r) => r.dataHash === 'reconcile-former-winner')!.id;
    rowCurrentWinnerId = rows.find((r) => r.dataHash === 'reconcile-current-winner')!.id;

    await prisma.productionScheduleFkojunstMailStatus.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: rowVisibleId,
        sourceCsvDashboardId: 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e',
        fkojun: '200',
        fkoteicd: '080',
        fsezono: '9001',
        statusCode: 'S',
        sourceUpdatedAt: new Date('2026-05-01T00:00:00.000Z'),
      },
    });
  });

  beforeEach(async () => {
    await prisma.productionScheduleOrderSplitAssignment.deleteMany({
      where: {
        split: {
          parentCsvDashboardRowId: {
            in: [rowVisibleId, rowInvisibleId, rowFormerWinnerId, rowCurrentWinnerId],
          },
        },
      },
    });
    await prisma.productionScheduleOrderSplit.deleteMany({
      where: {
        parentCsvDashboardRowId: {
          in: [rowVisibleId, rowInvisibleId, rowFormerWinnerId, rowCurrentWinnerId],
        },
      },
    });
    await prisma.productionScheduleOrderAssignment.deleteMany({
      where: {
        csvDashboardRowId: {
          in: [rowVisibleId, rowInvisibleId, rowFormerWinnerId, rowCurrentWinnerId],
        },
      },
    });
    await prisma.productionScheduleExternalCompletion.deleteMany({
      where: {
        csvDashboardRowId: {
          in: [rowVisibleId, rowInvisibleId, rowFormerWinnerId, rowCurrentWinnerId],
        },
      },
    });
    await prisma.productionScheduleFkojunstMailStatus.deleteMany({
      where: {
        csvDashboardRowId: { in: [rowVisibleId, rowInvisibleId, rowFormerWinnerId, rowCurrentWinnerId] },
      },
    });
    await prisma.productionScheduleFkojunstMailStatus.createMany({
      data: [
        {
          csvDashboardId: DASHBOARD_ID,
          csvDashboardRowId: rowVisibleId,
          sourceCsvDashboardId: 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e',
          fkojun: '200',
          fkoteicd: '080',
          fsezono: '9001',
          statusCode: 'S',
          sourceUpdatedAt: new Date('2026-05-01T00:00:00.000Z'),
        },
        {
          csvDashboardId: DASHBOARD_ID,
          csvDashboardRowId: rowCurrentWinnerId,
          sourceCsvDashboardId: 'b7c8d9e0-f1a2-4b3c-9d4e-5f6a7b8c9d0e',
          fkojun: '300',
          fkoteicd: '081',
          fsezono: '9101',
          statusCode: 'S',
          sourceUpdatedAt: new Date('2026-05-02T00:00:00.000Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.productionScheduleOrderSplitAssignment.deleteMany({
      where: {
        split: {
          parentCsvDashboardRowId: {
            in: [rowVisibleId, rowInvisibleId, rowFormerWinnerId, rowCurrentWinnerId],
          },
        },
      },
    });
    await prisma.productionScheduleOrderSplit.deleteMany({
      where: {
        parentCsvDashboardRowId: {
          in: [rowVisibleId, rowInvisibleId, rowFormerWinnerId, rowCurrentWinnerId],
        },
      },
    });
    await prisma.productionScheduleOrderAssignment.deleteMany({
      where: {
        csvDashboardRowId: {
          in: [rowVisibleId, rowInvisibleId, rowFormerWinnerId, rowCurrentWinnerId],
        },
      },
    });
    await prisma.productionScheduleExternalCompletion.deleteMany({
      where: {
        csvDashboardRowId: {
          in: [rowVisibleId, rowInvisibleId, rowFormerWinnerId, rowCurrentWinnerId],
        },
      },
    });
    await prisma.productionScheduleFkojunstMailStatus.deleteMany({
      where: {
        csvDashboardRowId: {
          in: [rowVisibleId, rowInvisibleId, rowFormerWinnerId, rowCurrentWinnerId],
        },
      },
    });
    await prisma.csvDashboardRow.deleteMany({
      where: {
        dataHash: {
          in: [
            'reconcile-visible',
            'reconcile-invisible',
            'reconcile-former-winner',
            'reconcile-current-winner',
          ],
        },
      },
    });
  });

  it('releases externally completed assignments (A)', async () => {
    await prisma.productionScheduleOrderAssignment.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: rowVisibleId,
        location: LOCATION,
        siteKey: LOCATION,
        resourceCd: '080',
        orderNumber: 1,
      },
    });
    await prisma.productionScheduleExternalCompletion.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: rowVisibleId,
        isExternallyCompleted: true,
        externallyCompletedFromFkojunstMailStatus: true,
      },
    });

    const result = await reconcileStaleProductionScheduleOrderAssignments();
    expect(result.released).toBe(1);

    const remaining = await prisma.productionScheduleOrderAssignment.count({
      where: { csvDashboardRowId: rowVisibleId, location: LOCATION },
    });
    expect(remaining).toBe(0);
  });

  it('releases assignments without fkmail (alpha)', async () => {
    await prisma.productionScheduleOrderAssignment.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: rowInvisibleId,
        location: LOCATION,
        siteKey: LOCATION,
        resourceCd: '080',
        orderNumber: 2,
      },
    });

    await reconcileStaleProductionScheduleOrderAssignments();

    const remaining = await prisma.productionScheduleOrderAssignment.count({
      where: { csvDashboardRowId: rowInvisibleId, location: LOCATION },
    });
    expect(remaining).toBe(0);
  });

  it('releases assignments for rows that are no longer current winners', async () => {
    await prisma.productionScheduleOrderAssignment.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: rowFormerWinnerId,
        location: LOCATION,
        siteKey: LOCATION,
        resourceCd: '081',
        orderNumber: 1,
      },
    });
    await prisma.productionScheduleOrderAssignment.create({
      data: {
        csvDashboardId: DASHBOARD_ID,
        csvDashboardRowId: rowCurrentWinnerId,
        location: LOCATION,
        siteKey: LOCATION,
        resourceCd: '081',
        orderNumber: 2,
      },
    });

    const result = await reconcileStaleProductionScheduleOrderAssignments();
    expect(result.released).toBeGreaterThanOrEqual(1);

    const formerRemaining = await prisma.productionScheduleOrderAssignment.count({
      where: { csvDashboardRowId: rowFormerWinnerId, location: LOCATION },
    });
    const currentRemaining = await prisma.productionScheduleOrderAssignment.findMany({
      where: { csvDashboardRowId: rowCurrentWinnerId, location: LOCATION },
    });
    expect(formerRemaining).toBe(0);
    expect(currentRemaining).toHaveLength(1);
    expect(currentRemaining[0]?.orderNumber).toBe(1);
  });

  it('parent assignment release shifts split assignments in the same order space', async () => {
    const previousFlag = process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;
    process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = 'true';

    try {
      await prisma.productionScheduleOrderAssignment.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          csvDashboardRowId: rowInvisibleId,
          location: LOCATION,
          siteKey: LOCATION,
          resourceCd: '080',
          orderNumber: 1,
        },
      });
      const split = await prisma.productionScheduleOrderSplit.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          parentCsvDashboardRowId: rowVisibleId,
          splitNo: 1,
          splitQuantity: 1,
        },
      });
      await prisma.productionScheduleOrderSplitAssignment.create({
        data: {
          csvDashboardId: DASHBOARD_ID,
          splitId: split.id,
          location: LOCATION,
          siteKey: LOCATION,
          resourceCd: '080',
          orderNumber: 2,
        },
      });

      const result = await reconcileStaleProductionScheduleOrderAssignments();
      expect(result.released).toBeGreaterThanOrEqual(1);

      const remainingParentAssignment = await prisma.productionScheduleOrderAssignment.findUnique({
        where: {
          csvDashboardRowId_location: {
            csvDashboardRowId: rowInvisibleId,
            location: LOCATION,
          },
        },
      });
      expect(remainingParentAssignment).toBeNull();

      const shiftedSplitAssignment = await prisma.productionScheduleOrderSplitAssignment.findUnique({
        where: {
          splitId_location: {
            splitId: split.id,
            location: LOCATION,
          },
        },
      });
      expect(shiftedSplitAssignment?.orderNumber).toBe(1);
    } finally {
      if (previousFlag == null) {
        delete process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED;
      } else {
        process.env.KIOSK_PRODUCTION_SCHEDULE_ORDER_SPLIT_ENABLED = previousFlag;
      }
    }
  });
});
