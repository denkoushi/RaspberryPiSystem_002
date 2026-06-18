import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { buildPositiveCsvDashboardRowRequiredMinutesSql } from './leaderboard-labor-minutes-positive.sql.js';
import {
  buildLeaderboardLaborMinutesLookupJoinSql,
  buildLeaderboardLaborMinutesLookupWhereSql,
  type LeaderboardLaborMinutesLookupContext
} from './leaderboard-labor-minutes-lookup.sql.js';
import type { ProductionScheduleRow } from '../production-schedule-query.service.js';
import {
  buildLeaderboardLaborLookupKey,
  extractLeaderboardLaborLookupKeyFromRowData,
  extractResourceCdFromRowData
} from './leaderboard-labor-minutes-keys.js';
import { parseLeaderboardLaborMinutesValue } from './leaderboard-labor-minutes-parse.js';

const LABOR_RESOURCE_CD = '10';

type LaborLookupRow = {
  productNo: string;
  fkojun: string;
  laborMinutes: number;
};

function rowDataRecord(row: ProductionScheduleRow): Record<string, unknown> {
  const data = row.rowData;
  return data != null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {};
}

function machineMinutesFromRow(row: ProductionScheduleRow): number {
  if (typeof row.machineRequiredMinutes === 'number' && Number.isFinite(row.machineRequiredMinutes)) {
    return row.machineRequiredMinutes >= 0 ? row.machineRequiredMinutes : 0;
  }
  return parseLeaderboardLaborMinutesValue(rowDataRecord(row).FSIGENSHOYORYO);
}

function laborMinutesFromRow(row: ProductionScheduleRow): number {
  if (typeof row.laborRequiredMinutes === 'number' && Number.isFinite(row.laborRequiredMinutes)) {
    return row.laborRequiredMinutes >= 0 ? row.laborRequiredMinutes : 0;
  }
  return 0;
}

/**
 * 表示済み通常行（FSIGENCD≠10）だけから人工数 lookup キーを集める。
 * 通常行が shell 可視性を通過していないキーはここに入らないため、10 行側 fkmail は不要。
 */
function collectDistinctLaborLookupKeys(rows: readonly ProductionScheduleRow[]): Array<{ productNo: string; fkojun: string }> {
  const seen = new Set<string>();
  const out: Array<{ productNo: string; fkojun: string }> = [];
  for (const row of rows) {
    const resourceCd = extractResourceCdFromRowData(rowDataRecord(row));
    if (resourceCd === LABOR_RESOURCE_CD) continue;
    const keyParts = extractLeaderboardLaborLookupKeyFromRowData(rowDataRecord(row));
    if (!keyParts || seen.has(keyParts.key)) continue;
    seen.add(keyParts.key);
    out.push({ productNo: keyParts.productNo, fkojun: keyParts.fkojun });
  }
  return out;
}

function rowHasLaborMetadata(row: ProductionScheduleRow): boolean {
  return (
    typeof row.machineRequiredMinutes === 'number' &&
    Number.isFinite(row.machineRequiredMinutes) &&
    typeof row.laborRequiredMinutes === 'number' &&
    Number.isFinite(row.laborRequiredMinutes)
  );
}

async function fetchLaborMinutesByProductNoFkojun(params: {
  keys: readonly { productNo: string; fkojun: string }[];
  lookupContext: LeaderboardLaborMinutesLookupContext;
}): Promise<Map<string, number>> {
  const { keys, lookupContext } = params;
  const out = new Map<string, number>();
  if (keys.length === 0) return out;

  const valueTuples = keys.map(
    (k) => Prisma.sql`(${k.productNo}, ${k.fkojun})`
  );
  const requiredMinutesSql = buildPositiveCsvDashboardRowRequiredMinutesSql();
  const lookupWhereSql = buildLeaderboardLaborMinutesLookupWhereSql(lookupContext);
  const lookupJoinSql = buildLeaderboardLaborMinutesLookupJoinSql();

  const rows = await prisma.$queryRaw<LaborLookupRow[]>`
    WITH lookup_keys("productNo", "fkojun") AS (
      VALUES ${Prisma.join(valueTuples, ',')}
    )
    SELECT
      BTRIM("CsvDashboardRow"."rowData"->>'ProductNo') AS "productNo",
      BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') AS "fkojun",
      COALESCE(SUM(${requiredMinutesSql}), 0)::double precision AS "laborMinutes"
    FROM "CsvDashboardRow"
    ${lookupJoinSql}
    INNER JOIN lookup_keys
      ON BTRIM("CsvDashboardRow"."rowData"->>'ProductNo') = lookup_keys."productNo"
      AND BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN') = lookup_keys."fkojun"
    WHERE ${lookupWhereSql}
      AND UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD')) = ${LABOR_RESOURCE_CD}
    GROUP BY 1, 2
  `;

  for (const row of rows) {
    const productNo = String(row.productNo ?? '').trim();
    const fkojun = String(row.fkojun ?? '').trim();
    if (!productNo.length || !fkojun.length) continue;
    const minutes = Number(row.laborMinutes);
    out.set(
      buildLeaderboardLaborLookupKey(productNo, fkojun),
      Number.isFinite(minutes) && minutes > 0 ? minutes : 0
    );
  }

  return out;
}

function applyLaborMinutesToRow(
  row: ProductionScheduleRow,
  laborMap: ReadonlyMap<string, number>
): ProductionScheduleRow {
  const data = rowDataRecord(row);
  const resourceCd = extractResourceCdFromRowData(data);
  const machine = machineMinutesFromRow(row);

  if (resourceCd === LABOR_RESOURCE_CD) {
    return {
      ...row,
      machineRequiredMinutes: 0,
      laborRequiredMinutes: machine
    };
  }

  const keyParts = extractLeaderboardLaborLookupKeyFromRowData(data);
  const labor =
    keyParts != null ? (laborMap.get(keyParts.key) ?? laborMinutesFromRow(row)) : laborMinutesFromRow(row);

  return {
    ...row,
    machineRequiredMinutes: machine,
    laborRequiredMinutes: labor
  };
}

export type { LeaderboardLaborMinutesLookupContext } from './leaderboard-labor-minutes-lookup.sql.js';

/**
 * 順位ボード表示行へ機械所要量・人工数（分）メタデータを付与する。
 * 1 呼び出しあたり最大 1 回の DB 照合（N+1 禁止）。
 */
export async function attachLeaderboardLaborMinutes(
  rows: readonly ProductionScheduleRow[],
  lookupContext: LeaderboardLaborMinutesLookupContext
): Promise<ProductionScheduleRow[]> {
  if (rows.length === 0) return [];

  const rowsNeedingAttach = rows.filter((row) => !rowHasLaborMetadata(row));
  if (rowsNeedingAttach.length === 0) {
    return rows.map((row) => ({ ...row }));
  }

  const keys = collectDistinctLaborLookupKeys(rowsNeedingAttach);
  const laborMap = await fetchLaborMinutesByProductNoFkojun({
    keys,
    lookupContext
  });

  return rows.map((row) =>
    rowHasLaborMetadata(row) ? { ...row } : applyLaborMinutesToRow(row, laborMap)
  );
}
