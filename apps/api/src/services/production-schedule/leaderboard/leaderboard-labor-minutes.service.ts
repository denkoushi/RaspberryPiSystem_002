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
const LABOR_LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000;
const LABOR_LOOKUP_CACHE_MAX_ENTRIES = 20_000;

type LaborLookupRow = {
  productNo: string;
  fkojun: string;
  laborMinutes: number;
};

type LaborLookupCacheEntry = {
  expiresAtMs: number;
  laborMinutes: number;
};

const laborLookupCache = new Map<string, LaborLookupCacheEntry>();

function buildScopedLaborLookupCacheKey(params: {
  scopeKey: string;
  productNo: string;
  fkojun: string;
}): string {
  return `${params.scopeKey}\0${buildLeaderboardLaborLookupKey(params.productNo, params.fkojun)}`;
}

function pruneExpiredLaborLookupCache(now = Date.now()): void {
  for (const [key, entry] of laborLookupCache) {
    if (entry.expiresAtMs < now) {
      laborLookupCache.delete(key);
    }
  }
  if (laborLookupCache.size <= LABOR_LOOKUP_CACHE_MAX_ENTRIES) return;
  const overflow = laborLookupCache.size - LABOR_LOOKUP_CACHE_MAX_ENTRIES;
  let removed = 0;
  for (const key of laborLookupCache.keys()) {
    laborLookupCache.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function readCachedLaborMinutes(params: {
  scopeKey: string | undefined;
  productNo: string;
  fkojun: string;
  now: number;
}): number | undefined {
  const scopeKey = params.scopeKey?.trim();
  if (!scopeKey) return undefined;
  const cacheKey = buildScopedLaborLookupCacheKey({
    scopeKey,
    productNo: params.productNo,
    fkojun: params.fkojun
  });
  const hit = laborLookupCache.get(cacheKey);
  if (!hit || hit.expiresAtMs < params.now) {
    laborLookupCache.delete(cacheKey);
    return undefined;
  }
  return hit.laborMinutes;
}

function writeCachedLaborMinutes(params: {
  scopeKey: string | undefined;
  productNo: string;
  fkojun: string;
  laborMinutes: number;
  now: number;
}): void {
  const scopeKey = params.scopeKey;
  if (!scopeKey) return;
  laborLookupCache.set(
    buildScopedLaborLookupCacheKey({
      scopeKey,
      productNo: params.productNo,
      fkojun: params.fkojun
    }),
    {
      expiresAtMs: params.now + LABOR_LOOKUP_CACHE_TTL_MS,
      laborMinutes: params.laborMinutes
    }
  );
}

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

  const now = Date.now();
  const cacheScopeKey = lookupContext.cacheScopeKey?.trim() || undefined;
  if (cacheScopeKey) {
    pruneExpiredLaborLookupCache(now);
  }
  const missingKeys: Array<{ productNo: string; fkojun: string }> = [];
  for (const key of keys) {
    const cached = readCachedLaborMinutes({
      scopeKey: cacheScopeKey,
      productNo: key.productNo,
      fkojun: key.fkojun,
      now
    });
    if (cached === undefined) {
      missingKeys.push(key);
      continue;
    }
    out.set(buildLeaderboardLaborLookupKey(key.productNo, key.fkojun), cached);
  }
  if (missingKeys.length === 0) return out;

  const valueTuples = missingKeys.map(
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
    const normalizedMinutes = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
    out.set(
      buildLeaderboardLaborLookupKey(productNo, fkojun),
      normalizedMinutes
    );
    writeCachedLaborMinutes({
      scopeKey: cacheScopeKey,
      productNo,
      fkojun,
      laborMinutes: normalizedMinutes,
      now
    });
  }

  for (const key of missingKeys) {
    const lookupKey = buildLeaderboardLaborLookupKey(key.productNo, key.fkojun);
    if (out.has(lookupKey)) continue;
    out.set(lookupKey, 0);
    writeCachedLaborMinutes({
      scopeKey: cacheScopeKey,
      productNo: key.productNo,
      fkojun: key.fkojun,
      laborMinutes: 0,
      now
    });
  }

  if (cacheScopeKey && laborLookupCache.size > LABOR_LOOKUP_CACHE_MAX_ENTRIES) {
    pruneExpiredLaborLookupCache(now);
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

/** テスト用 */
export function clearLeaderboardLaborMinutesLookupCacheForTests(): void {
  laborLookupCache.clear();
}
