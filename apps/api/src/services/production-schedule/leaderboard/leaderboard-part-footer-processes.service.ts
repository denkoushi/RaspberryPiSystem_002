import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  getResourceCategoryPolicy,
  isProductionScheduleExcludedCuttingResourceCd
} from '../policies/resource-category-policy.service.js';
import { getResourceNameMapByResourceCds } from '../resource-master.service.js';
import { resolveProgressOverviewResourceNames } from '../progress-overview-query.service.js';
import {
  buildLeaderboardPartFooterChipLookupKey,
  readTrimmedRowDataField,
  resolveLeaderboardRowSeibanJoinKeyForFooter
} from './leaderboard-part-footer-chip-key.js';

// #region agent log
const emitLeaderboardFooterQueryDebugLog = (payload: {
  hypothesisId: string;
  location: string;
  message: string;
  data: Record<string, unknown>;
  runId?: string;
}) => {
  fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '44c291' },
    body: JSON.stringify({
      sessionId: '44c291',
      runId: payload.runId ?? 'investigate-1',
      hypothesisId: payload.hypothesisId,
      location: payload.location,
      message: payload.message,
      data: payload.data,
      timestamp: Date.now()
    })
  }).catch(() => {});
};
// #endregion

export type LeaderboardPartFooterProcessItem = {
  rowId: string;
  resourceCd: string;
  resourceNames?: string[];
  isCompleted: boolean;
};

type FooterSqlRow = {
  rowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  fsigencd: string;
  fkojun: string;
  isCompleted: boolean;
};

const parseProcessOrder = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * 順位ボード一覧行に含まれる部品キーについて、progress-overview と同契約の工程チップ配列を返す。
 * 呼び出し側は `responseProfile=leaderboard` のときのみ利用する。
 */
export async function buildLeaderboardFooterChipsByPartKeyForScheduleRows(params: {
  rows: ReadonlyArray<{
    id: string;
    seibanJoinKey: string | null | undefined;
    rowData: unknown;
  }>;
  locationKey: string;
  siteKey?: string;
}): Promise<Record<string, LeaderboardPartFooterProcessItem[]> | undefined> {
  const footerStartAt = Date.now();
  const { rows, locationKey, siteKey } = params;
  const uniqueKeys = new Set<string>();
  const tripleByKey = new Map<
    string,
    { seibanJoinKey: string; productNo: string; fhincd: string }
  >();

  for (const row of rows) {
    const seibanJoinKey = resolveLeaderboardRowSeibanJoinKeyForFooter(row);
    const productNo = readTrimmedRowDataField(row.rowData, 'ProductNo');
    const fhincd = readTrimmedRowDataField(row.rowData, 'FHINCD');
    if (!seibanJoinKey.length || !fhincd.length) continue;

    const key = buildLeaderboardPartFooterChipLookupKey({ seibanJoinKey, productNo, fhincd });
    if (uniqueKeys.has(key)) continue;
    uniqueKeys.add(key);
    tripleByKey.set(key, { seibanJoinKey, productNo, fhincd });
  }

  if (tripleByKey.size === 0) {
    // #region agent log
    emitLeaderboardFooterQueryDebugLog({
      hypothesisId: 'H3',
      location: 'leaderboard-part-footer-processes.service.ts:noTargetKeys',
      message: 'footer query skipped due to empty target part keys',
      data: {
        rowCount: rows.length,
        elapsedMs: Date.now() - footerStartAt
      }
    });
    // #endregion
    return undefined;
  }

  const resourceCategoryPolicy = await getResourceCategoryPolicy({
    siteKey,
    deviceScopeKey: locationKey
  });

  const targetKeyRows = [...tripleByKey.values()].map(
    (t) => Prisma.sql`(${t.seibanJoinKey}, ${t.productNo}, ${t.fhincd})`
  );

  const sqlStartAt = Date.now();
  const sqlRows = await prisma.$queryRaw<FooterSqlRow[]>(Prisma.sql`
    WITH "targetKeys" ("seibanJoinKey", "productNo", "fhincd") AS (
      VALUES ${Prisma.join(targetKeyRows, ',')}
    ),
    "matchedRows" AS (
      SELECT "CsvDashboardRow".*
      FROM "CsvDashboardRow"
      INNER JOIN "targetKeys"
        ON NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') = "targetKeys"."seibanJoinKey"
        AND COALESCE(NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'ProductNo'), ''), '') = "targetKeys"."productNo"
        AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FHINCD'), '') = "targetKeys"."fhincd"
      WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    ),
    "winnerRows" AS (
      SELECT DISTINCT ON (
        COALESCE("matchedRows"."rowData"->>'FSEIBAN', ''),
        COALESCE("matchedRows"."rowData"->>'FHINCD', ''),
        COALESCE("matchedRows"."rowData"->>'FSIGENCD', ''),
        COALESCE("matchedRows"."rowData"->>'FKOJUN', '')
      )
        "matchedRows".*
      FROM "matchedRows"
      ORDER BY
        COALESCE("matchedRows"."rowData"->>'FSEIBAN', '') ASC,
        COALESCE("matchedRows"."rowData"->>'FHINCD', '') ASC,
        COALESCE("matchedRows"."rowData"->>'FSIGENCD', '') ASC,
        COALESCE("matchedRows"."rowData"->>'FKOJUN', '') ASC,
        "matchedRows"."createdAt" DESC,
        "matchedRows"."id" DESC
    )
    SELECT
      "winnerRows"."id" AS "rowId",
      ("winnerRows"."rowData"->>'FSEIBAN') AS "fseiban",
      COALESCE(("winnerRows"."rowData"->>'ProductNo'), '') AS "productNo",
      COALESCE(("winnerRows"."rowData"->>'FHINCD'), '') AS "fhincd",
      COALESCE(("winnerRows"."rowData"->>'FHINMEI'), '') AS "fhinmei",
      COALESCE(("winnerRows"."rowData"->>'FSIGENCD'), '') AS "fsigencd",
      COALESCE(("winnerRows"."rowData"->>'FKOJUN'), '') AS "fkojun",
      COALESCE("p"."isCompleted", FALSE) AS "isCompleted"
    FROM "winnerRows"
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "winnerRows"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    ORDER BY
      ("winnerRows"."rowData"->>'FSEIBAN') ASC,
      ("winnerRows"."rowData"->>'FHINCD') ASC,
      (CASE
        WHEN ("winnerRows"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("winnerRows"."rowData"->>'FKOJUN'))::int
        ELSE NULL
      END) ASC
  `);
  // #region agent log
  emitLeaderboardFooterQueryDebugLog({
    hypothesisId: 'H3',
    location: 'leaderboard-part-footer-processes.service.ts:sqlCompleted',
    message: 'footer query SQL completed',
    data: {
      rowCount: rows.length,
      uniquePartKeyCount: tripleByKey.size,
      sqlRowCount: sqlRows.length,
      sqlElapsedMs: Date.now() - sqlStartAt
    }
  });
  // #endregion

  const resourceNameMap = await getResourceNameMapByResourceCds(sqlRows.map((r) => r.fsigencd));

  const processesByPartKey = new Map<string, Array<{ processOrder: number | null; rowId: string; resourceCd: string; resourceNames?: string[]; isCompleted: boolean }>>();

  for (const row of sqlRows) {
    const fseiban = row.fseiban.trim();
    const productNo = row.productNo.trim();
    const fhincd = row.fhincd.trim();
    if (!fseiban.length || !fhincd.length) continue;

    const partKey = buildLeaderboardPartFooterChipLookupKey({
      seibanJoinKey: fseiban,
      productNo,
      fhincd
    });
    if (!tripleByKey.has(partKey)) {
      continue;
    }

    const resourceCd = row.fsigencd.trim();
    if (!resourceCd.length) continue;
    if (isProductionScheduleExcludedCuttingResourceCd(resourceCd, resourceCategoryPolicy)) {
      continue;
    }

    const list = processesByPartKey.get(partKey) ?? [];
    list.push({
      rowId: row.rowId,
      resourceCd,
      resourceNames: resolveProgressOverviewResourceNames(resourceCd, resourceNameMap),
      processOrder: parseProcessOrder(row.fkojun),
      isCompleted: row.isCompleted
    });
    processesByPartKey.set(partKey, list);
  }

  const out: Record<string, LeaderboardPartFooterProcessItem[]> = {};
  for (const lookupKey of uniqueKeys) {
    const procs = (processesByPartKey.get(lookupKey) ?? []).slice().sort((a, b) => {
      const ao = a.processOrder ?? Number.MAX_SAFE_INTEGER;
      const bo = b.processOrder ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.rowId.localeCompare(b.rowId);
    });
    out[lookupKey] = procs.map(({ rowId, resourceCd, resourceNames, isCompleted }) =>
      resourceNames && resourceNames.length > 0
        ? { rowId, resourceCd, resourceNames, isCompleted }
        : { rowId, resourceCd, isCompleted }
    );
  }

  // #region agent log
  emitLeaderboardFooterQueryDebugLog({
    hypothesisId: 'H3',
    location: 'leaderboard-part-footer-processes.service.ts:done',
    message: 'footer query mapping completed',
    data: {
      elapsedMs: Date.now() - footerStartAt,
      outputPartKeyCount: Object.keys(out).length
    }
  });
  // #endregion

  return out;
}
