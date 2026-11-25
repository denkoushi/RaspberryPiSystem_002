import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
} from '../constants.js';
import { ProductionScheduleOrderSupplementSyncService } from '../order-supplement-sync.service.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';

const MAIN_DASHBOARD_ID = PRODUCTION_SCHEDULE_DASHBOARD_ID;
const SUPPLEMENT_DASHBOARD_ID = PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID;
const DATA_HASH_PREFIX = 'order-supplement-split-sync';

async function cleanupFixtures(): Promise<void> {
  const rows = await prisma.csvDashboardRow.findMany({
    where: {
      dataHash: { startsWith: DATA_HASH_PREFIX },
    },
    select: { id: true },
  });
  const rowIds = rows.map((row) => row.id);
  if (rowIds.length === 0) return;

  await prisma.productionScheduleOrderSplitAssignment.deleteMany({
    where: {
      split: {
        parentCsvDashboardRowId: { in: rowIds },
      },
    },
  });
  await prisma.productionScheduleOrderSplit.deleteMany({
    where: {
      parentCsvDashboardRowId: { in: rowIds },
    },
  });
  await prisma.productionScheduleOrderSupplement.deleteMany({
    where: {
      csvDashboardRowId: { in: rowIds },
    },
  });
  await prisma.csvDashboardRow.deleteMany({
    where: {
      id: { in: rowIds },
    },
  });
}

describe('order-supplement-sync.service (integration)', () => {
  beforeAll(async () => {
    await prisma.csvDashboard.upsert({
      where: { id: MAIN_DASHBOARD_ID },
      update: {},
      create: {
        id: MAIN_DASHBOARD_ID,
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
    await prisma.csvDashboard.upsert({
      where: { id: SUPPLEMENT_DASHBOARD_ID },
      update: {},
      create: {
        id: SUPPLEMENT_DASHBOARD_ID,
        name: 'ProductionSchedule_OrderSupplement',
        columnDefinitions: [],
        templateType: 'TABLE',
        templateConfig: {},
        ingestMode: 'DEDUP',
        dedupKeyColumns: ['ProductNo', 'FSIGENCD', 'FKOJUN'],
        dateColumnName: 'registeredAt',
        enabled: true,
      },
    });
  });

  beforeEach(async () => {
    await cleanupFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await prisma.$disconnect();
  });

  it('旧片が残っていても親の plannedQuantity のみ更新する', async () => {
    const parent = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: MAIN_DASHBOARD_ID,
        occurredAt: new Date('2026-06-20T00:00:00.000Z'),
        dataHash: `${DATA_HASH_PREFIX}-main`,
        rowData: {
          ProductNo: '0003712732',
          FSEIBAN: 'SYNC-SPLIT',
          FHINCD: 'PART-1',
          FSIGENCD: '503',
          FKOJUN: '200',
        },
      },
      select: { id: true },
    });
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
        occurredAt: new Date('2026-06-20T00:00:00.000Z'),
        dataHash: `${DATA_HASH_PREFIX}-source`,
        rowData: {
          ProductNo: '0003712732',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '10',
        },
      },
    });
    await prisma.productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: MAIN_DASHBOARD_ID,
        csvDashboardRowId: parent.id,
        sourceCsvDashboardId: SUPPLEMENT_DASHBOARD_ID,
        productNo: '0003712732',
        resourceCd: '503',
        processOrder: '200',
        plannedQuantity: 5,
      },
    });
    await prisma.productionScheduleOrderSplit.createMany({
      data: [
        {
          csvDashboardId: MAIN_DASHBOARD_ID,
          parentCsvDashboardRowId: parent.id,
          splitNo: 1,
          splitQuantity: 2,
        },
        {
          csvDashboardId: MAIN_DASHBOARD_ID,
          parentCsvDashboardRowId: parent.id,
          splitNo: 2,
          splitQuantity: 3,
        },
      ],
    });

    const result = await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();

    expect(result.upserted).toBeGreaterThanOrEqual(1);
    const supplement = await prisma.productionScheduleOrderSupplement.findUnique({
      where: { csvDashboardRowId: parent.id },
      select: { plannedQuantity: true },
    });
    const splits = await prisma.productionScheduleOrderSplit.findMany({
      where: { parentCsvDashboardRowId: parent.id },
      orderBy: { splitNo: 'asc' },
      select: { splitQuantity: true },
    });
    expect(supplement?.plannedQuantity).toBe(10);
    expect(splits.map((split) => split.splitQuantity)).toEqual([2, 3]);
    expect(splits.reduce((sum, split) => sum + split.splitQuantity, 0)).toBe(5);
  });

  it('既存行ありで補助CSVの plannedQuantity が空なら既存数量と split を維持する', async () => {
    const parent = await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: MAIN_DASHBOARD_ID,
        occurredAt: new Date('2026-06-20T00:00:00.000Z'),
        dataHash: `${DATA_HASH_PREFIX}-blank-quantity-main`,
        rowData: {
          ProductNo: '9999999901',
          FSEIBAN: 'SYNC-SPLIT-BLANK',
          FHINCD: 'PART-BLANK',
          FSIGENCD: '503',
          FKOJUN: '200',
        },
      },
      select: { id: true },
    });
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
        occurredAt: new Date('2026-06-20T00:00:00.000Z'),
        dataHash: `${DATA_HASH_PREFIX}-blank-quantity-source`,
        rowData: {
          ProductNo: '9999999901',
          FSIGENCD: '503',
          FKOJUN: '200',
          plannedQuantity: '',
        },
      },
    });
    await prisma.productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: MAIN_DASHBOARD_ID,
        csvDashboardRowId: parent.id,
        sourceCsvDashboardId: SUPPLEMENT_DASHBOARD_ID,
        productNo: '9999999901',
        resourceCd: '503',
        processOrder: '200',
        plannedQuantity: 5,
      },
    });
    await prisma.productionScheduleOrderSplit.createMany({
      data: [
        {
          csvDashboardId: MAIN_DASHBOARD_ID,
          parentCsvDashboardRowId: parent.id,
          splitNo: 1,
          splitQuantity: 2,
        },
        {
          csvDashboardId: MAIN_DASHBOARD_ID,
          parentCsvDashboardRowId: parent.id,
          splitNo: 2,
          splitQuantity: 3,
        },
      ],
    });

    const result = await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();

    expect(result.upserted).toBeGreaterThanOrEqual(1);
    const supplement = await prisma.productionScheduleOrderSupplement.findUnique({
      where: { csvDashboardRowId: parent.id },
      select: { plannedQuantity: true },
    });
    const splits = await prisma.productionScheduleOrderSplit.findMany({
      where: { parentCsvDashboardRowId: parent.id },
      orderBy: { splitNo: 'asc' },
      select: { splitQuantity: true },
    });
    expect(supplement?.plannedQuantity).toBe(5);
    expect(splits.map((split) => split.splitQuantity)).toEqual([2, 3]);
    expect(splits.reduce((sum, split) => sum + split.splitQuantity, 0)).toBe(5);
  });

  it('同一4列キーの印なし番号は両方とも、自分の番号の補助行へ照合し、印付きの番号は照合しない', async () => {
    const mainRows = await Promise.all(
      [
        { suffix: 'low', productNo: '1000000001' },
        { suffix: 'high', productNo: '1000000002' },
        { suffix: 'old', productNo: '1000000000', supersededAt: new Date('2026-06-21T00:00:00.000Z') },
      ].map(({ suffix, productNo, supersededAt }) =>
        prisma.csvDashboardRow.create({
          data: {
            csvDashboardId: MAIN_DASHBOARD_ID,
            occurredAt: new Date('2026-06-20T00:00:00.000Z'),
            supersededAt,
            dataHash: `${DATA_HASH_PREFIX}-winner-${suffix}-main`,
            rowData: {
              ProductNo: productNo,
              FSEIBAN: 'SYNC-WINNER',
              FHINCD: 'PART-WINNER',
              FSIGENCD: '503',
              FKOJUN: '200',
            },
          },
          select: { id: true },
        })
      )
    );

    await prisma.csvDashboardRow.createMany({
      data: [
        {
          csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
          occurredAt: new Date('2026-06-20T00:00:00.000Z'),
          dataHash: `${DATA_HASH_PREFIX}-winner-low-source`,
          rowData: {
            ProductNo: '1000000001',
            FSIGENCD: '503',
            FKOJUN: '200',
            plannedQuantity: '1',
          },
        },
        {
          csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
          occurredAt: new Date('2026-06-20T00:00:00.000Z'),
          dataHash: `${DATA_HASH_PREFIX}-winner-high-source`,
          rowData: {
            ProductNo: '1000000002',
            FSIGENCD: '503',
            FKOJUN: '200',
            plannedQuantity: '2',
          },
        },
        {
          csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
          occurredAt: new Date('2026-06-20T00:00:00.000Z'),
          dataHash: `${DATA_HASH_PREFIX}-winner-old-source`,
          rowData: {
            ProductNo: '1000000000',
            FSIGENCD: '503',
            FKOJUN: '200',
            plannedQuantity: '9',
          },
        },
      ],
    });

    const result = await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();
    const supplements = await prisma.productionScheduleOrderSupplement.findMany({
      where: {
        csvDashboardRowId: { in: mainRows.map((row) => row.id) },
      },
      select: {
        csvDashboardRowId: true,
        productNo: true,
        plannedQuantity: true,
      },
    });

    expect(result).toEqual({
      scanned: 3,
      normalized: 3,
      matched: 2,
      unmatched: 1,
      upserted: 2,
      pruned: 0,
    });
    expect(
      [...supplements].sort((x, y) => x.productNo.localeCompare(y.productNo)),
    ).toEqual([
      { csvDashboardRowId: mainRows[0]?.id, productNo: '1000000001', plannedQuantity: 1 },
      { csvDashboardRowId: mainRows[1]?.id, productNo: '1000000002', plannedQuantity: 2 },
    ]);
  });

  it('27M の補助から同じオーダー・工順の 021 winner に指示数を反映し、再同期でも維持する', async () => {
    const productNo = '0004174165';
    const occurredAt = new Date('2026-06-20T00:00:00.000Z');
    const [exact, fallback, superseded] = await Promise.all(
      [
        { resourceCd: '27M', suffix: 'exact', createdAt: occurredAt },
        { resourceCd: '021', suffix: 'fallback', createdAt: occurredAt },
        { resourceCd: '021', suffix: 'superseded', createdAt: new Date('2026-06-19') },
      ].map(({ resourceCd, suffix, createdAt }) =>
        prisma.csvDashboardRow.create({
          data: {
            csvDashboardId: MAIN_DASHBOARD_ID,
            occurredAt,
            createdAt,
            dataHash: `${DATA_HASH_PREFIX}-alternate-${suffix}`,
            rowData: {
              ProductNo: productNo,
              FSEIBAN: 'SYNC-ALTERNATE',
              FHINCD: 'PART-ALTERNATE',
              FSIGENCD: resourceCd,
              FKOJUN: '200',
            },
          },
        })
      )
    );
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
        occurredAt,
        dataHash: `${DATA_HASH_PREFIX}-alternate-source`,
        rowData: {
          ProductNo: productNo,
          FSIGENCD: '27M',
          FKOJUN: '200',
          FKOJUNSIJISU: '5',
          FKOJUNSTTYOTEIYMD: '2027-03-04',
        },
      },
    });
    const readSupplement = (rowId: string) => prisma.productionScheduleOrderSupplement.findUnique({
      where: { csvDashboardRowId: rowId },
    });
    const service = new ProductionScheduleOrderSupplementSyncService();
    expect(await service.syncFromSupplementDashboard()).toMatchObject({ matched: 1, unmatched: 0, upserted: 2 });
    expect(await readSupplement(exact.id)).toMatchObject({
      plannedQuantity: 5,
      plannedStartDate: new Date('2027-03-04'),
    });
    expect(await readSupplement(fallback.id)).toMatchObject({
      productNo,
      resourceCd: '021',
      processOrder: '200',
      sourceCsvDashboardId: SUPPLEMENT_DASHBOARD_ID,
      plannedQuantity: 5,
      plannedStartDate: null,
      plannedEndDate: null,
      plannedStartDateManuallySet: false,
    });
    expect(await readSupplement(superseded.id)).toBeNull();

    const prior = await prisma.productionScheduleOrderSupplement.update({
      where: { csvDashboardRowId: fallback.id },
      data: {
        plannedQuantity: 2,
        plannedStartDate: new Date('2024-01-01'),
        plannedEndDate: new Date('2024-01-02'),
        lastSeenAt: new Date('2024-01-01'),
      },
    });
    expect(await service.syncFromSupplementDashboard()).toMatchObject({ matched: 1, unmatched: 0, upserted: 2 });
    const refreshed = await readSupplement(fallback.id);
    expect(refreshed).toMatchObject({
      id: prior.id,
      plannedQuantity: 5,
      plannedStartDate: prior.plannedStartDate,
      plannedEndDate: prior.plannedEndDate,
      plannedStartDateManuallySet: false,
    });
    expect(refreshed?.lastSeenAt.getTime()).toBeGreaterThan(prior.lastSeenAt.getTime());
  });

  it('1年超のsource行は未照合だけ削除し、現行日程に残る長期案件は保持する', async () => {
    await prisma.csvDashboardRow.create({
      data: {
        csvDashboardId: MAIN_DASHBOARD_ID,
        occurredAt: new Date('2026-07-20T00:00:00.000Z'),
        dataHash: `${DATA_HASH_PREFIX}-retention-current-main`,
        rowData: {
          ProductNo: '1000000010',
          FSEIBAN: 'SYNC-RETENTION',
          FHINCD: 'PART-RETENTION',
          FSIGENCD: '503',
          FKOJUN: '200',
        },
      },
    });
    const sourceRows = await Promise.all(
      [
        { suffix: 'current', productNo: '1000000010' },
        { suffix: 'unmatched', productNo: '1000000011' },
      ].map(({ suffix, productNo }) =>
        prisma.csvDashboardRow.create({
          data: {
            csvDashboardId: SUPPLEMENT_DASHBOARD_ID,
            occurredAt: new Date('2026-07-20T00:00:00.000Z'),
            dataHash: `${DATA_HASH_PREFIX}-retention-${suffix}-source`,
            rowData: {
              ProductNo: productNo,
              FSIGENCD: '503',
              FKOJUN: '200',
              plannedQuantity: '1',
              plannedStartDate: '2024-01-01',
              plannedEndDate: '2024-12-31',
            },
          },
          select: { id: true },
        })
      )
    );

    await new ProductionScheduleOrderSupplementSyncService().syncFromSupplementDashboard();

    const retainedRows = await prisma.csvDashboardRow.findMany({
      where: { id: { in: sourceRows.map((row) => row.id) } },
      select: { id: true },
    });
    expect(retainedRows.map((row) => row.id)).toEqual([sourceRows[0]?.id]);
  });
});
