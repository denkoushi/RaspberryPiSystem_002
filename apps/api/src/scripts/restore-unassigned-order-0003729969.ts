/** Restore only order 0003729969 from the archived Pi5 CSV files after the hash migration. */
import { readFile } from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

import { prisma } from '../lib/prisma.js';
import { CsvDashboardIngestor } from '../services/csv-dashboard/csv-dashboard-ingestor.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
} from '../services/production-schedule/constants.js';
import {
  dedupeFkojunstMailRowsByLatest,
  toFkojunstMailNormalizedRow,
} from '../services/production-schedule/fkojunst-status-mail-sync.pipeline.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../services/production-schedule/fkojunst-status-mail-critical-lock.js';
import { fetchFkojunstStatusMailGenerationSignals } from '../services/production-schedule/fkojunst-status-mail-generation-signals.js';
import { normalizeProductionScheduleResourceCd } from '../services/production-schedule/policies/resource-category-policy.service.js';
import { calculateProductionScheduleDataHash } from '../services/production-schedule/row-resolver/constants.js';

const PRODUCT_NO = '0003729969';
const MAIN_CSV = '/app/storage/csv-dashboards/3f2f6b0e-6a1e-4c0b-9d0b-1a4f3f0d2a01/raw/2026/09/2026-09-23T21-58-48-278Z-1a0cb0018cbdf0ab.csv';
const SUPPLEMENT_CSV = '/app/storage/csv-dashboards/8f0b8d6e-4b77-4e7e-8d9a-6c8b2f5d1a31/raw/2026/09/2026-09-05T21-54-02-891Z-1a07384f1ae9a885.csv';

type CsvRecord = Record<string, string>;

const rowKey = (row: CsvRecord): string => `${row.FSIGENCD}\t${row.FKOJUN}`;
const dbRowKey = (row: Record<string, unknown>): string =>
  `${String(row.FSIGENCD ?? '')}\t${String(row.FKOJUN ?? '')}`;
const statusKey = (processOrder: string, resourceCd: string): string =>
  `${processOrder.trim()}\t${normalizeProductionScheduleResourceCd(resourceCd.trim())}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseDate(value: string): Date {
  assert(/^\d{4}-\d{2}-\d{2}/.test(value), 'Archived supplement date is invalid');
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  assert(!Number.isNaN(date.getTime()), 'Archived supplement date is invalid');
  return date;
}

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  if (execute && !process.argv.includes(`--confirm=${PRODUCT_NO}`)) {
    throw new Error(`Execution requires --confirm=${PRODUCT_NO}`);
  }

  const mainContent = await readFile(MAIN_CSV, 'utf8');
  const mainRecords = parse(mainContent, { bom: true, columns: true, skip_empty_lines: true }) as CsvRecord[];
  const targetRows = mainRecords.filter((row) => row.ProductNo === PRODUCT_NO);
  assert(targetRows.length === 8, 'Expected exactly eight archived schedule rows');
  assert(targetRows.every((row) => row.FSEIBAN === '********'), 'Archived order has an unexpected seiban');
  const expectedKeys = new Set(targetRows.map(rowKey));
  assert(expectedKeys.size === 8 && expectedKeys.has('500\t230'), 'Archived order has unexpected process rows');

  const supplementContent = await readFile(SUPPLEMENT_CSV, 'utf8');
  const supplementRecords = parse(supplementContent, { bom: true, columns: true, skip_empty_lines: true }) as CsvRecord[];
  const supplementRows = supplementRecords.filter((row) => row['製造オーダー番号'] === PRODUCT_NO);
  assert(supplementRows.length === 1, 'Expected exactly one archived supplement row');
  const supplement = supplementRows[0]!;
  assert(supplement['資源CD'] === '500' && supplement['工順'] === '230' && supplement['指示数'] === '20',
    'Archived supplement does not match resource 500, process 230, quantity 20');
  const plannedStartDate = parseDate(supplement['着手日'] ?? '');
  const plannedEndDate = parseDate(supplement['完了日'] ?? '');

  const statusSourceRevision = (await fetchFkojunstStatusMailGenerationSignals(prisma)).rowsRevision;
  const statusSourceRows = await prisma.csvDashboardRow.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
      rowData: { path: ['FSEZONO'], equals: PRODUCT_NO },
    },
    select: { id: true, rowData: true, sourceRowOrdinal: true, sourceIngestRunStartedAt: true },
  });
  assert(statusSourceRows.length === 10, 'Expected ten FKOJUNST_Status source rows');
  const normalizedStatuses = statusSourceRows.map((row) => {
    const status = toFkojunstMailNormalizedRow(
      row.id,
      row.rowData as Record<string, unknown>,
      row.sourceRowOrdinal,
      row.sourceIngestRunStartedAt,
    ).row;
    assert(status, 'FKOJUNST_Status source has an invalid key');
    return status;
  });
  const statusWinners = dedupeFkojunstMailRowsByLatest(normalizedStatuses);
  assert(statusWinners.length === 5 && statusWinners.every((row) =>
    row.fsezono === PRODUCT_NO && row.statusCode === 'R' && !row.hasUnparseableDate),
  'FKOJUNST_Status source differs from the expected target status');
  const archivedStatusKeys = new Set(targetRows.map((row) => statusKey(row.FKOJUN, row.FSIGENCD)));
  const matchedStatuses = statusWinners.filter((row) => archivedStatusKeys.has(statusKey(row.fkojun, row.fkoteicd)));
  const unmatchedStatuses = statusWinners.filter((row) => !archivedStatusKeys.has(statusKey(row.fkojun, row.fkoteicd)));
  assert(matchedStatuses.length === 4 && unmatchedStatuses.length === 1
    && unmatchedStatuses[0]?.fkojun === '300' && unmatchedStatuses[0]?.fkoteicd === '731'
    && matchedStatuses.some((row) => row.fkojun === '230' && row.fkoteicd === '500'),
  'FKOJUNST_Status source does not match the archived schedule');

  const maskedRows = await prisma.csvDashboardRow.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, rowData: { path: ['FSEIBAN'], equals: '********' } },
    select: { id: true, rowData: true, dataHash: true },
  });
  const mismatchedHashes = maskedRows.filter((row) =>
    row.dataHash !== calculateProductionScheduleDataHash(row.rowData as Record<string, unknown>));
  assert(mismatchedHashes.length === 0, 'Existing masked rows still have legacy hashes; run the migration first');

  const readTargetRows = () => prisma.csvDashboardRow.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, rowData: { path: ['ProductNo'], equals: PRODUCT_NO } },
    select: { id: true, rowData: true },
  });
  let existingRows = await readTargetRows();
  assert(existingRows.length === 0 || existingRows.length === 8, 'Partial target order already exists; inspect before recovery');
  if (existingRows.length === 8) {
    const existingKeys = existingRows.map((row) => dbRowKey(row.rowData as Record<string, unknown>));
    assert(new Set(existingKeys).size === expectedKeys.size && existingKeys.every((key) => expectedKeys.has(key)),
      'Existing target order differs from archived rows');
    assert(existingRows.every((row) => (row.rowData as Record<string, unknown>).FSEIBAN === '********'),
      'Existing target order has an unexpected seiban');
  }

  const existingSupplement = await prisma.productionScheduleOrderSupplement.findFirst({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
      productNo: PRODUCT_NO,
      resourceCd: '500',
      processOrder: '230',
    },
    select: { csvDashboardRowId: true, plannedQuantity: true },
  });
  if (existingSupplement) {
    const measurementRow = existingRows.find((row) => dbRowKey(row.rowData as Record<string, unknown>) === '500\t230');
    assert(measurementRow && existingSupplement.csvDashboardRowId === measurementRow.id
      && existingSupplement.plannedQuantity === 20,
    'Existing supplement conflicts with archived data');
  }
  const existingStatuses = await prisma.productionScheduleFkojunstMailStatus.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fsezono: PRODUCT_NO },
    select: { csvDashboardRowId: true, fkojun: true, fkoteicd: true, statusCode: true, sourceUpdatedAt: true },
  });
  assert(existingStatuses.length === 0 || existingStatuses.length === matchedStatuses.length,
    'Partial target FKOJUNST_Status links already exist; inspect before recovery');
  if (existingStatuses.length > 0) {
    const existingRowIdByKey = new Map(existingRows.map((row) => [
      statusKey(String((row.rowData as Record<string, unknown>).FKOJUN ?? ''),
        String((row.rowData as Record<string, unknown>).FSIGENCD ?? '')),
      row.id,
    ]));
    assert(existingStatuses.every((existing) => {
      const source = matchedStatuses.find((row) =>
        statusKey(row.fkojun, row.fkoteicd) === statusKey(existing.fkojun, existing.fkoteicd));
      return source && existing.csvDashboardRowId === existingRowIdByKey.get(statusKey(source.fkojun, source.fkoteicd))
        && existing.statusCode === source.statusCode
        && existing.sourceUpdatedAt.getTime() === source.sourceUpdatedAt.getTime();
    }), 'Existing FKOJUNST_Status links conflict with the source');
  }
  console.log(JSON.stringify({ execute, archivedScheduleRows: targetRows.length,
    existingScheduleRows: existingRows.length, existingSupplement: existingSupplement != null,
    existingStatuses: existingStatuses.length, archivedMatchedStatuses: matchedStatuses.length,
    maskedRowsChecked: maskedRows.length }));
  if (!execute) return;

  if (existingRows.length === 0) {
    const targetCsv = stringify(targetRows, { header: true, columns: Object.keys(mainRecords[0]!) });
    await new CsvDashboardIngestor().ingestFromGmail(
      PRODUCTION_SCHEDULE_DASHBOARD_ID,
      targetCsv,
      `recovery-${PRODUCT_NO}-20260924`,
      `Targeted archived order recovery ${PRODUCT_NO}`,
      undefined,
      new Date('2026-09-23T21:58:48.278Z'),
    );
    existingRows = await readTargetRows();
  }
  assert(existingRows.length === 8, 'Schedule recovery did not produce eight rows');
  assert(new Set(existingRows.map((row) => dbRowKey(row.rowData as Record<string, unknown>))).size === 8,
    'Schedule recovery produced duplicate process rows');
  const measurementRows = existingRows.filter((row) => dbRowKey(row.rowData as Record<string, unknown>) === '500\t230');
  assert(measurementRows.length === 1, 'Resource 500 process 230 is not unique');
  const measurementRowId = measurementRows[0]!.id;

  if (!existingSupplement) {
    await prisma.productionScheduleOrderSupplement.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId: measurementRowId,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_ORDER_SUPPLEMENT_DASHBOARD_ID,
        productNo: PRODUCT_NO,
        resourceCd: '500',
        processOrder: '230',
        plannedQuantity: 20,
        plannedStartDate,
        plannedEndDate,
      },
    });
  }
  if (existingStatuses.length === 0) {
    const rowIdByStatusKey = new Map(existingRows.map((row) => [
      statusKey(String((row.rowData as Record<string, unknown>).FKOJUN ?? ''),
        String((row.rowData as Record<string, unknown>).FSIGENCD ?? '')),
      row.id,
    ]));
    const statusInputs = matchedStatuses.map((status) => {
      const csvDashboardRowId = rowIdByStatusKey.get(statusKey(status.fkojun, status.fkoteicd));
      assert(csvDashboardRowId, 'FKOJUNST_Status has no restored schedule row');
      return {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        csvDashboardRowId,
        sourceCsvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        fkojun: status.fkojun,
        fkoteicd: status.fkoteicd,
        fsezono: status.fsezono,
        statusCode: status.statusCode,
        sourceUpdatedAt: status.sourceUpdatedAt,
      };
    });
    await prisma.$transaction(async (tx) => {
      await acquireFkojunstStatusMailCriticalTransactionLock(tx);
      const currentRevision = (await fetchFkojunstStatusMailGenerationSignals(tx)).rowsRevision;
      assert(currentRevision === statusSourceRevision, 'FKOJUNST_Status source changed during recovery');
      const currentStatusCount = await tx.productionScheduleFkojunstMailStatus.count({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fsezono: PRODUCT_NO },
      });
      assert(currentStatusCount === 0, 'Target FKOJUNST_Status links changed during recovery');
      await tx.productionScheduleFkojunstMailStatus.createMany({ data: statusInputs });
    }, {
      maxWait: 15_000,
      timeout: 60_000,
    });
  }
  console.log(JSON.stringify({ restoredOrder: PRODUCT_NO, scheduleRows: existingRows.length,
    resourceCd: '500', processOrder: '230', plannedQuantity: 20,
    linkedStatuses: matchedStatuses.length }));
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
