import { Prisma, type PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';
import type { FkojunstMailNormalizedRow } from './fkojunst-mail-row.types.js';
import {
  collectFkojunstMailNormalizedRowsFromSourceRows,
  dedupeFkojunstMailRowsByLatest
} from './fkojunst-status-mail-sync.pipeline.js';
import {
  FKOJUNST_STATUS_MAIL_SOURCE_ROW_SQL_ORDER_BY,
  type FkojunstStatusMailSourceRow
} from './fkojunst-status-mail-source-rows.reader.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';

type IncompleteProcess = { productNo: string; processOrder: string; resourceCd: string };
const groupKey = (productNo: string, processOrder: string) => JSON.stringify([productNo.trim(), processOrder.trim()]);
export const buildProcessArrivalResourceSwapKey = (process: IncompleteProcess): string =>
  JSON.stringify([process.productNo.trim(), process.processOrder.trim(), normalizeProductionScheduleResourceCd(process.resourceCd)]);

/** Only supplies completion evidence for arrival; persisted completion stays unchanged. */
export function buildProcessArrivalResourceSwapCompletedKeys(
  rows: readonly FkojunstMailNormalizedRow[], processes: readonly IncompleteProcess[],
  isExcluded: (resourceCd: string) => boolean
): Set<string> {
  const byGroup = new Map<string, Map<string, FkojunstMailNormalizedRow>>();
  for (const row of rows) {
    const key = groupKey(row.fsezono, row.fkojun);
    const group = byGroup.get(key) ?? new Map<string, FkojunstMailNormalizedRow>();
    group.set(row.fkoteicd, row);
    byGroup.set(key, group);
  }
  const completed = new Set<string>();
  for (const process of processes) {
    const resourceCd = normalizeProductionScheduleResourceCd(process.resourceCd);
    if (isExcluded(resourceCd)) continue;
    const group = byGroup.get(groupKey(process.productNo, process.processOrder));
    const own = group?.get(resourceCd);
    if (own && (own.statusCode === 'S' || own.hasUnparseableDate)) continue;
    for (const other of group?.values() ?? []) {
      if (other.fkoteicd === resourceCd || other.statusCode !== 'C' || other.hasUnparseableDate || isExcluded(other.fkoteicd)) continue;
      if (own && other.sourceUpdatedAt.getTime() < own.sourceUpdatedAt.getTime()) continue;
      completed.add(buildProcessArrivalResourceSwapKey(process));
      break;
    }
  }
  return completed;
}

// Keep this literal predicate aligned with csv_dashboard_row_fkojunst_sezono_idx.
const FKOJUNST_SEZONO_INDEX_PREDICATE = Prisma.raw(
  `r."csvDashboardId" = '${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}'`
);

export async function findProcessArrivalResourceSwapCompletedKeys(
  processes: readonly IncompleteProcess[], isExcluded: (resourceCd: string) => boolean,
  client: Pick<PrismaClient, '$queryRaw'>
): Promise<Set<string>> {
  const productNos = [...new Set(processes.map((process) => process.productNo.trim()).filter(Boolean))];
  if (!productNos.length) return new Set();
  // Narrow the mail rows first and look up only their ingest runs by primary key.
  // A plain join made the planner hash-scan every ingest run (~100k rows) on each board page.
  const sourceRows = await client.$queryRaw<FkojunstStatusMailSourceRow[]>(Prisma.sql`
    WITH "swapRows" AS MATERIALIZED (
      SELECT r."id", r."rowData", r."createdAt", r."updatedAt", r."sourceRowOrdinal",
        r."sourceIngestRunStartedAt", r."sourceIngestRunId"
      FROM "CsvDashboardRow" r
      WHERE ${FKOJUNST_SEZONO_INDEX_PREDICATE}
        AND BTRIM(r."rowData"->>'FSEZONO') = ANY(${productNos}::text[])
    ), "swapRuns" AS MATERIALIZED (
      SELECT run."id", run."status", run."completedAt"
      FROM "CsvDashboardIngestRun" run
      WHERE run."id" = ANY(ARRAY(
        SELECT DISTINCT s."sourceIngestRunId" FROM "swapRows" s WHERE s."sourceIngestRunId" IS NOT NULL
      ))
    )
    SELECT r."id", r."rowData", r."createdAt", r."updatedAt", r."sourceRowOrdinal",
      r."sourceIngestRunStartedAt", ir."completedAt" AS "sourceIngestRunCompletedAt"
    FROM "swapRows" r
    LEFT JOIN "swapRuns" ir ON ir."id" = r."sourceIngestRunId"
    WHERE r."sourceIngestRunId" IS NULL
      OR (ir."status" = 'COMPLETED'::"ImportStatus" AND ir."completedAt" IS NOT NULL)
    ORDER BY ${Prisma.join(FKOJUNST_STATUS_MAIL_SOURCE_ROW_SQL_ORDER_BY.map((fragment) => Prisma.raw(fragment)), ', ')}
  `);
  const { normalizedRows } = collectFkojunstMailNormalizedRowsFromSourceRows(sourceRows);
  return buildProcessArrivalResourceSwapCompletedKeys(dedupeFkojunstMailRowsByLatest(normalizedRows), processes, isExcluded);
}
