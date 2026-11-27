import { Prisma } from '@prisma/client';

import { toTrimmedString } from '../../lib/string-normalize.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from './fkojunst-status-mail-critical-lock.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';

// 機械でない資源。同じ工順に機械の行と並んで届くのが普通なので、付け替えの証拠にも、隠す対象にもしない。
const NON_MACHINE_RESOURCE_CDS = ['10', 'MSZ', 'KUMITATE1', 'KUMITATE2'];

/** 取り込み完了と同じトランザクションで、今回届いた工順の機械の資源だけを照合する。 */
export async function refreshDroppedProductionScheduleResources(
  tx: Prisma.TransactionClient,
  rows: ReadonlyArray<{ data: Record<string, unknown> }>,
  ingestStartedAt: Date,
): Promise<void> {
  const keys = rows.flatMap(({ data }) => {
    const productNo = toTrimmedString(data.ProductNo);
    const fkojun = toTrimmedString(data.FKOJUN);
    const resource = normalizeProductionScheduleResourceCd(toTrimmedString(data.FSIGENCD));
    return productNo && fkojun && resource && !NON_MACHINE_RESOURCE_CDS.includes(resource)
      ? [{ productNo, fkojun, resource }]
      : [];
  });
  // CSV が応答上限で末尾から切れたとき(KB-435)、最後のオーダーだけは資源が欠けている恐れがあるので照合しない。
  const lastProductNo = keys.at(-1)?.productNo;
  const safeKeys = keys.filter((key) => key.productNo !== lastProductNo);
  if (safeKeys.length === 0) return;

  await acquireFkojunstStatusMailCriticalTransactionLock(tx);
  await tx.$executeRaw(Prisma.sql`
    WITH incoming AS (
      SELECT "productNo", fkojun, ARRAY_AGG(DISTINCT resource) AS resources
      FROM jsonb_to_recordset(${JSON.stringify(safeKeys)}::jsonb) AS k("productNo" text, fkojun text, resource text)
      GROUP BY "productNo", fkojun
    ), candidates AS (
      SELECT r."id", UPPER(BTRIM(r."rowData"->>'FSIGENCD')) <> ALL(i.resources) AS dropped
      FROM "CsvDashboardRow" r
      JOIN incoming i ON BTRIM(r."rowData"->>'ProductNo') = i."productNo"
        AND BTRIM(r."rowData"->>'FKOJUN') = i.fkojun
      WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND BTRIM(r."rowData"->>'FSIGENCD') <> ''
        AND UPPER(BTRIM(r."rowData"->>'FSIGENCD')) NOT IN (${Prisma.join(NON_MACHINE_RESOURCE_CDS)})
        AND (r."sourceIngestRunStartedAt" IS NULL OR r."sourceIngestRunStartedAt" <= ${ingestStartedAt})
        AND NOT EXISTS (
          SELECT 1 FROM "CsvDashboardIngestRun" newer
          WHERE newer."csvDashboardId" = r."csvDashboardId"
            AND newer."status" = 'COMPLETED' AND newer."rowsProcessed" > 0
            AND newer."startedAt" > ${ingestStartedAt}
        )
    )
    UPDATE "CsvDashboardRow" r
    SET "supersededAt" = CASE
          WHEN c.dropped OR r."supersededReason" = 'ORDER_STATUS_X_AND_DROPPED_RESOURCE'
            THEN COALESCE(r."supersededAt", NOW())
        END,
        "supersededReason" = (CASE
          WHEN c.dropped AND r."supersededAt" IS NOT NULL THEN 'ORDER_STATUS_X_AND_DROPPED_RESOURCE'
          WHEN c.dropped THEN 'DROPPED_RESOURCE'
          WHEN r."supersededReason" = 'ORDER_STATUS_X_AND_DROPPED_RESOURCE' THEN 'ORDER_STATUS_X'
        END)::"CsvDashboardRowSupersededReason",
        "updatedAt" = NOW()
    FROM candidates c
    WHERE r."id" = c."id"
      AND c.dropped <> COALESCE(r."supersededReason" IN ('DROPPED_RESOURCE', 'ORDER_STATUS_X_AND_DROPPED_RESOURCE'), FALSE)
  `);
}
