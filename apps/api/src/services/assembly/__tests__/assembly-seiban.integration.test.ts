process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../../app.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { createTestClientDevice } from '../../../routes/__tests__/helpers.js';
import { AssemblySeibanLotQuantityService } from '../assembly-seiban-lot-quantity.service.js';
import { AssemblySeibanStartService } from '../assembly-seiban-start.service.js';

const ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID = '8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31';
const FIXTURE_PREFIX = 'ASMLOT';

async function ensureProductionScheduleDashboard() {
  await prisma.csvDashboard.upsert({
    where: { id: PRODUCTION_SCHEDULE_DASHBOARD_ID },
    create: {
      id: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      name: 'Test Production Schedule',
      columnDefinitions: [],
      templateConfig: {}
    },
    update: {}
  });
}

async function cleanupFixtures() {
  const rows = await prisma.csvDashboardRow.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      dataHash: { startsWith: `${FIXTURE_PREFIX}-` }
    },
    select: { id: true }
  });
  const rowIds = rows.map((row) => row.id);

  if (rowIds.length > 0) {
    await prisma.productionScheduleOrderSupplement.deleteMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: { in: rowIds } }
    });
  }

  await prisma.productionScheduleActualHoursRaw.deleteMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      sourceFileKey: { startsWith: `${FIXTURE_PREFIX}-` }
    }
  });

  await prisma.csvDashboardRow.deleteMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, dataHash: { startsWith: `${FIXTURE_PREFIX}-` } }
  });
}

async function createScheduleRowWithSupplement(params: {
  fseiban: string;
  fhincd: string;
  fsigencd: string;
  fkojun: string;
  productNo: string;
  plannedQuantity?: number | null;
}) {
  const row = await prisma.csvDashboardRow.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      occurredAt: new Date(),
      dataHash: `${FIXTURE_PREFIX}-${Date.now()}-${Math.random()}`,
      rowData: {
        FSEIBAN: params.fseiban,
        FHINCD: params.fhincd,
        FSIGENCD: params.fsigencd,
        FKOJUN: params.fkojun,
        ProductNo: params.productNo
      }
    }
  });

  if (params.plannedQuantity != null) {
    await prisma.productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: row.id,
        sourceCsvDashboardId: ORDER_SUPPLEMENT_SOURCE_DASHBOARD_ID,
        productNo: params.productNo,
        resourceCd: params.fsigencd,
        processOrder: params.fkojun,
        plannedQuantity: params.plannedQuantity
      }
    });
  }

  return row;
}

async function createActualHoursRow(params: {
  fseiban: string;
  lotNo: string;
  lotQty: number;
}) {
  await prisma.productionScheduleActualHoursRaw.create({
    data: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      sourceFileKey: `${FIXTURE_PREFIX}-actual-${Date.now()}-${Math.random()}`,
      rowFingerprint: `${FIXTURE_PREFIX}-actual-${Date.now()}-${Math.random()}`,
      workDate: new Date(),
      fseiban: params.fseiban,
      fhincd: 'PART-1',
      lotNo: params.lotNo,
      lotQty: params.lotQty,
      resourceCd: 'R1',
      actualMinutes: 10,
      perPieceMinutes: 1
    }
  });
}

describe('assembly seiban services (integration)', () => {
  const lotQuantityService = new AssemblySeibanLotQuantityService();
  const seibanStartService = new AssemblySeibanStartService();

  beforeAll(async () => {
    await ensureProductionScheduleDashboard();
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
  });

  beforeEach(async () => {
    await cleanupFixtures();
  });

  it('adopts the mode planned quantity for duplicate part rows', async () => {
    const fseiban = `${FIXTURE_PREFIX}-MODE`;
    await createScheduleRowWithSupplement({
      fseiban,
      fhincd: 'PART-A',
      fsigencd: 'R1',
      fkojun: '10',
      productNo: '9000000001',
      plannedQuantity: 5
    });
    await createScheduleRowWithSupplement({
      fseiban,
      fhincd: 'PART-B',
      fsigencd: 'R2',
      fkojun: '20',
      productNo: '9000000002',
      plannedQuantity: 5
    });
    await createScheduleRowWithSupplement({
      fseiban,
      fhincd: 'PART-C',
      fsigencd: 'R3',
      fkojun: '30',
      productNo: '9000000003',
      plannedQuantity: 10
    });

    await expect(lotQuantityService.listByProductNos([fseiban])).resolves.toEqual([
      { productNo: fseiban.toUpperCase(), lotQty: 5 }
    ]);
  });

  it('prefers the smaller planned quantity when mode counts tie', async () => {
    const fseiban = `${FIXTURE_PREFIX}-TIE`;
    await createScheduleRowWithSupplement({
      fseiban,
      fhincd: 'PART-A',
      fsigencd: 'R1',
      fkojun: '10',
      productNo: '9000000011',
      plannedQuantity: 5
    });
    await createScheduleRowWithSupplement({
      fseiban,
      fhincd: 'PART-B',
      fsigencd: 'R2',
      fkojun: '20',
      productNo: '9000000012',
      plannedQuantity: 5
    });
    await createScheduleRowWithSupplement({
      fseiban,
      fhincd: 'PART-C',
      fsigencd: 'R3',
      fkojun: '30',
      productNo: '9000000013',
      plannedQuantity: 10
    });
    await createScheduleRowWithSupplement({
      fseiban,
      fhincd: 'PART-D',
      fsigencd: 'R4',
      fkojun: '40',
      productNo: '9000000014',
      plannedQuantity: 10
    });

    await expect(lotQuantityService.listByProductNos([fseiban])).resolves.toEqual([
      { productNo: fseiban.toUpperCase(), lotQty: 5 }
    ]);
  });

  it('falls back to actual hours when supplement is missing', async () => {
    const fseiban = `${FIXTURE_PREFIX}-FALLBACK`;
    await createActualHoursRow({ fseiban, lotNo: 'L1', lotQty: 4 });
    await createActualHoursRow({ fseiban, lotNo: 'L2', lotQty: 3 });

    await expect(lotQuantityService.listByProductNos([fseiban])).resolves.toEqual([
      { productNo: fseiban.toUpperCase(), lotQty: 7 }
    ]);
  });

  it('returns the same seiban candidates without winner filtering', async () => {
    const fseiban = `${FIXTURE_PREFIX}-CAND`;
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        dataHash: `${FIXTURE_PREFIX}-cand-old`,
        rowData: {
          FSEIBAN: fseiban,
          FHINCD: 'PART-1',
          FSIGENCD: 'R1',
          FKOJUN: '10',
          ProductNo: '1'
        }
      }
    });
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        dataHash: `${FIXTURE_PREFIX}-cand-new`,
        rowData: {
          FSEIBAN: fseiban,
          FHINCD: 'PART-1',
          FSIGENCD: 'R1',
          FKOJUN: '10',
          ProductNo: '2'
        }
      }
    });
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        occurredAt: new Date(),
        dataHash: `${FIXTURE_PREFIX}-cand-part`,
        rowData: {
          FSEIBAN: fseiban,
          FHINCD: 'PART-2',
          FSIGENCD: 'R2',
          FKOJUN: '20',
          ProductNo: '1'
        }
      }
    });

    const candidates = await seibanStartService.listSeibanCandidates({
      prefix: FIXTURE_PREFIX,
      limit: 10
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.fseiban).toBe(fseiban);
  });

  it('exposes lot quantities through the assembly route', async () => {
    const app = await buildServer();
    const client = await createTestClientDevice();
    const fseiban = `${FIXTURE_PREFIX}-ROUTE`;
    await createScheduleRowWithSupplement({
      fseiban,
      fhincd: 'PART-A',
      fsigencd: 'R1',
      fkojun: '10',
      productNo: '9000000021',
      plannedQuantity: 6
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/assembly/seiban-lot-quantities?productNos=${encodeURIComponent(fseiban)}`,
      headers: { 'x-client-key': client.apiKey }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([{ productNo: fseiban.toUpperCase(), lotQty: 6 }]);
    await app.close();
  });
});
