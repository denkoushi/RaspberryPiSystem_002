import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../../production-schedule/constants.js';
import { buildFkojunstMailStatusKey } from '../../production-schedule/fkojunst-mail-status-key.js';
import { buildGrindingPlanningBoardRowItemId } from '../../production-schedule/grinding-planning-board-projection.js';
import { buildMaxProductNoWinnerCondition } from '../../production-schedule/row-resolver/max-product-no-sql.js';
import { refreshSupersededProductionScheduleRows } from '../../production-schedule/superseded-order-marker.js';
import { CsvDashboardIngestor } from '../csv-dashboard-ingestor.js';

vi.mock('../../production-schedule/production-schedule-part-name-lookup-rebuild.js', () => ({
  requestProductionSchedulePartNameLookupRebuild: vi.fn().mockResolvedValue(undefined),
}));

const D = PRODUCTION_SCHEDULE_DASHBOARD_ID;
const productNo = '0003940203';
const otherProductNo = '0003940204';
const columns = ['ProductNo', 'FSEIBAN', 'FHINCD', 'FKOJUN', 'FSIGENCD', 'FSTTYOTEIYMD'];
const caseDate = new Date().toISOString();
const oldUpdatedAt = new Date('2026-10-02T00:00:00.000Z');
const ingestor = new CsvDashboardIngestor();

const csvRow = (resource: string, fkojun = '200', order = productNo): string =>
  [order, 'BA1S6345', 'MD004240000', fkojun, resource, caseDate].join(',');

const rawIngest = (...rows: string[]) => ingestor.ingestFromGmail(D, [columns.join(','), ...rows].join('\n'));
// 末尾のオーダーは照合しないので、検証対象の後ろに別のオーダーを置く。
const tailRow = (): string => csvRow('999', '100', '0009999999');
const ingest = (...rows: string[]) => rawIngest(...rows, tailRow());

async function scheduleRow(resource: string, fkojun = '200', order = productNo) {
  const [row] = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${D} AND "rowData"->>'ProductNo' = ${order}
      AND "rowData"->>'FKOJUN' = ${fkojun} AND "rowData"->>'FSIGENCD' = ${resource}
  `;
  return prisma.csvDashboardRow.findUniqueOrThrow({ where: { id: row.id } });
}

async function visibleResources(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ resource: string }>>(Prisma.sql`
    SELECT r."rowData"->>'FSIGENCD' AS resource
    FROM "CsvDashboardRow" r
    WHERE r."csvDashboardId" = ${D} AND r."rowData"->>'ProductNo' = ${productNo}
      AND r."rowData"->>'FKOJUN' = '200' AND ${buildMaxProductNoWinnerCondition('r')}
    ORDER BY resource
  `);
  return rows.map((row) => row.resource);
}

describe('生産日程 CSV の旧資源の非表示 (PostgreSQL)', () => {
  beforeEach(async () => {
    await prisma.csvDashboard.deleteMany({ where: { id: D } });
    await prisma.csvDashboard.create({
      data: {
        id: D,
        name: 'ProductionSchedule_Test',
        ingestMode: 'DEDUP',
        columnDefinitions: columns.map((name) => ({
          internalName: name, displayName: name, csvHeaderCandidates: [name], dataType: 'string',
        })),
        dateColumnName: 'FSTTYOTEIYMD',
        templateType: 'TABLE',
        templateConfig: { rowsPerPage: 10, fontSize: 14, displayColumns: [] },
      },
    });
  });

  afterAll(async () => {
    await prisma.csvDashboard.deleteMany({ where: { id: D } });
    await prisma.$disconnect();
  });

  it('過去の旧資源を隠し、今回届いた資源と旧行の手動データを保持する', async () => {
    await ingest(csvRow('26M'), csvRow('10'));
    const old = await scheduleRow('26M');
    await prisma.csvDashboardRow.update({
      where: { id: old.id },
      data: { updatedAt: oldUpdatedAt, sourceIngestRunId: null, sourceIngestRunStartedAt: null },
    });
    const rowRef = { csvDashboardId: D, csvDashboardRowId: old.id };
    const progress = await prisma.productionScheduleProgress.create({ data: { ...rowRef, isCompleted: true } });
    const note = await prisma.productionScheduleRowNote.create({ data: { ...rowRef, note: '保留' } });
    const arrival = await prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.create({
      data: {
        csvDashboardId: D,
        siteKey: 'test',
        itemKey: buildGrindingPlanningBoardRowItemId(old.rowData as Record<string, unknown>),
        state: 'arrived',
        recordedAt: oldUpdatedAt,
      },
    });
    const unchanged = await scheduleRow('10');

    expect(await ingest(csvRow('10'), csvRow('27M'))).toMatchObject({ rowsAdded: 1, rowsSkipped: 2 });

    expect(await visibleResources()).toEqual(['10', '27M']);
    expect(await scheduleRow('10')).toEqual(unchanged);
    expect(await scheduleRow('26M')).toMatchObject({
      id: old.id, supersededAt: expect.any(Date), supersededReason: 'DROPPED_RESOURCE',
    });
    expect(await prisma.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: old.id } })).toEqual(progress);
    expect(await prisma.productionScheduleRowNote.findUnique({ where: { csvDashboardRowId: old.id } })).toEqual(note);
    expect(await prisma.productionScheduleGrindingPlanningBoardFirstProcessArrival.findUnique({
      where: { id: arrival.id },
    })).toEqual(arrival);
  });

  it('一部の工順だけ届いたときは他の工順やオーダーに触れない', async () => {
    await ingest(csvRow('26M'), csvRow('26M', '300'), csvRow('26M', '200', otherProductNo));
    const otherProcess = await scheduleRow('26M', '300');
    const otherOrder = await scheduleRow('26M', '200', otherProductNo);

    await ingest(csvRow('27M'));

    expect(await visibleResources()).toEqual(['27M']);
    expect(await scheduleRow('26M', '300')).toEqual(otherProcess);
    expect(await scheduleRow('26M', '200', otherProductNo)).toEqual(otherOrder);
  });

  it('差分更新が省略されても再受信した旧資源を同じ行 ID で表示する', async () => {
    await ingest(csvRow('26M'));
    const old = await scheduleRow('26M');
    await ingest(csvRow('27M'));
    expect(await visibleResources()).toEqual(['27M']);

    expect(await ingest(csvRow('26M'), csvRow('27M'))).toMatchObject({ rowsAdded: 0, rowsSkipped: 3 });

    expect(await visibleResources()).toEqual(['26M', '27M']);
    expect(await scheduleRow('26M')).toMatchObject({
      id: old.id, sourceIngestRunId: old.sourceIngestRunId, supersededAt: null, supersededReason: null,
    });
  });

  it('工程状態 X と旧資源の印が重なっても各処理は自分の理由だけを解除する', async () => {
    const refreshX = (statusCode: string) => refreshSupersededProductionScheduleRows(prisma, {
      statusByKey: new Map([[buildFkojunstMailStatusKey({ fsezono: productNo, fkojun: '200', fkoteicd: '26M' }), statusCode]]),
    });
    await ingest(csvRow('26M'), csvRow('26M', '200', otherProductNo));
    await refreshX('X');
    expect(await scheduleRow('26M')).toMatchObject({ supersededReason: 'ORDER_STATUS_X' });

    await ingest(csvRow('27M'));
    expect(await scheduleRow('26M')).toMatchObject({ supersededReason: 'ORDER_STATUS_X_AND_DROPPED_RESOURCE' });
    await refreshX('R');
    expect(await scheduleRow('26M')).toMatchObject({ supersededAt: expect.any(Date), supersededReason: 'DROPPED_RESOURCE' });
    expect(await visibleResources()).toEqual(['27M']);

    await refreshX('X');
    expect(await scheduleRow('26M')).toMatchObject({ supersededReason: 'ORDER_STATUS_X_AND_DROPPED_RESOURCE' });
    await ingest(csvRow('26M'), csvRow('27M'));
    expect(await scheduleRow('26M')).toMatchObject({ supersededAt: expect.any(Date), supersededReason: 'ORDER_STATUS_X' });
    expect(await visibleResources()).toEqual(['27M']);
    await refreshX('R');
    expect(await visibleResources()).toEqual(['26M', '27M']);
  });

  it('CSV の末尾のオーダーは、切れている恐れがあるので照合しない', async () => {
    await rawIngest(csvRow('26M'));
    await rawIngest(csvRow('27M'));
    expect(await visibleResources()).toEqual(['26M', '27M']);
  });
});
