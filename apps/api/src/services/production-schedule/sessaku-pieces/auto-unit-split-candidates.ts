import { createHash } from 'node:crypto';
import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';
import { isLaterProcessOrder } from '../process-order.js';
import { Prisma } from '@prisma/client';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { STRING_TRIM_CHARACTERS } from '../grinding-planning-board/shared.js';
import type { ResourceCategoryPolicy } from '../policies/resource-category-policy.service.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';

// Only this bounded decimal subset is safe to prefilter numerically in PostgreSQL.
// Locale-sensitive and other JS Number forms are always left to isLaterProcessOrder.
const decimalOrderPattern = '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]{1,2})?$';
export function autoUnitSplitInputKey(parentIds: Iterable<string>): string {
  return createHash('md5').update([...new Set(parentIds)].sort().join(',')).digest('hex');
}

export type AutoUnitSplitExcludedInput = { parentId: string; inputKey: string };

export function isFirstAutoUnitSplitProcess(item: GrindingPlanningBoardItem, items: readonly GrindingPlanningBoardItem[]): boolean {
  return !items.some((other) => other.fseiban === item.fseiban && other.fhincd.trim() !== ''
    && other.originalResourceCd?.trim() && other.processOrder.trim()
    && (other.fhincd === item.fhincd ? isLaterProcessOrder(item.processOrder, other.processOrder)
      : other.fhincd.normalize('NFKC').trim() === item.fhincd.normalize('NFKC').trim()));
}

/** Lightweight generation gate. MVCC tuple versions change on insert/update/delete, including bulk SQL writes.
 * Broad dashboard invalidation is intentional; no rowData, winner or predecessor evaluation is needed.
 */
export function autoUnitSplitInputFingerprintSql(siteKey: string): Prisma.Sql {
  const tables = ['CsvDashboardRow', 'ProductionScheduleOrderSupplement', 'ProductionScheduleProgress',
    'ProductionScheduleExternalCompletion', 'ProductionScheduleSessakuPieceSet', 'ProductionScheduleSessakuPieceHistory',
    'ProductionScheduleGrindingPlanningBoardOverride', 'ProductionScheduleGrindingPlanningBoardResourceCapacity'];
  const generations = tables.map((table) => Prisma.sql`SELECT ${table} AS source,
      COUNT(*)::text || ':' || COALESCE(bit_xor(hashtextextended(t.ctid::text || ':' || t.xmin::text, 0)), 0)::text AS generation
    FROM ${Prisma.raw('"' + table + '"')} t WHERE t."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      ${table.includes('Override') || table.includes('ResourceCapacity') ? Prisma.sql`AND t."siteKey" = ${siteKey}` : Prisma.empty}`);
  return Prisma.sql`SELECT MD5(STRING_AGG(source || ':' || generation, ',' ORDER BY source)) AS fingerprint
    FROM (${Prisma.join(generations, ' UNION ALL ')}) generations`;
}

/** The same predicate is executable in pre-deploy counts and SQL/TS contract integration tests. */
export function autoUnitSplitCandidateSql(siteKey: string, order: string[], policy: ResourceCategoryPolicy, excludedInputs: AutoUnitSplitExcludedInput[] = []): Prisma.Sql {
  const trim = (value: Prisma.Sql) => Prisma.sql`BTRIM(COALESCE(${value}, ''), ${STRING_TRIM_CHARACTERS})`;
  const resource = trim(Prisma.sql`r."rowData"->>'FSIGENCD'`);
  const part = trim(Prisma.sql`r."rowData"->>'FHINCD'`);
  const process = trim(Prisma.sql`NORMALIZE(r."rowData"->>'FKOJUN', NFKC)`);
  const earlierProcess = trim(Prisma.sql`NORMALIZE(e."rowData"->>'FKOJUN', NFKC)`);
  const laterThanEarlier = Prisma.sql`CASE WHEN LENGTH(${process}) <= 64 AND LENGTH(${earlierProcess}) <= 64
      AND ${process} ~ ${decimalOrderPattern} AND ${earlierProcess} ~ ${decimalOrderPattern}
    THEN (${process})::double precision > (${earlierProcess})::double precision
    ELSE false END`;
  const effective = trim(Prisma.sql`COALESCE(o."overrideResourceCd", r."rowData"->>'FSIGENCD')`);
  // SQL creates the identical base64url row ID from the raw logical key, including whitespace.
  const parentId = Prisma.sql`'row:' || RTRIM(TRANSLATE(REPLACE(ENCODE(CONVERT_TO(
    '[' || to_json(COALESCE(r."rowData"->>'FSEIBAN', ''))::text || ',' || to_json(COALESCE(r."rowData"->>'FHINCD', ''))::text || ',' ||
    to_json(COALESCE(r."rowData"->>'FSIGENCD', ''))::text || ',' || to_json(COALESCE(r."rowData"->>'FKOJUN', ''))::text || ']', 'UTF8'), 'base64'), E'\n', ''), '+/', '-_'), '=')`;
  // MATERIALIZED keeps winner/predecessor work behind the cheap untouched cutting-key gate.
  const untouched = Prisma.sql`SELECT r.* FROM "CsvDashboardRow" r
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND r."rowData"->>'FSEIBAN' = ANY(${order}::text[])
      AND ${resource} <> '' AND UPPER(${resource}) <> ALL(${[...policy.grindingResourceCds, ...policy.cuttingExcludedResourceCds]}::text[])
      AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPieceSet" s WHERE s."csvDashboardId" = r."csvDashboardId"
        AND s."fseiban" = COALESCE(r."rowData"->>'FSEIBAN', '') AND s."fhincd" = COALESCE(r."rowData"->>'FHINCD', '')
        AND s."fsigencd" = COALESCE(r."rowData"->>'FSIGENCD', '') AND s."fkojun" = COALESCE(r."rowData"->>'FKOJUN', ''))
      AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPieceHistory" h WHERE h."csvDashboardId" = r."csvDashboardId"
        AND h."fseiban" = COALESCE(r."rowData"->>'FSEIBAN', '') AND h."fhincd" = COALESCE(r."rowData"->>'FHINCD', '')
        AND h."fsigencd" = COALESCE(r."rowData"->>'FSIGENCD', '') AND h."fkojun" = COALESCE(r."rowData"->>'FKOJUN', ''))`;
  return Prisma.sql`WITH untouched AS MATERIALIZED (${untouched}), eligible AS MATERIALIZED (
    SELECT r."id", r."csvDashboardId", r."rowData", r."rowData"->>'FSEIBAN' AS "fseiban", ${parentId} AS "parentId" FROM untouched r
    LEFT JOIN "ProductionScheduleGrindingPlanningBoardOverride" o ON o."csvDashboardId" = r."csvDashboardId" AND o."siteKey" = ${siteKey} AND o."itemKey" = (${parentId})
    LEFT JOIN "ProductionScheduleGrindingPlanningBoardResourceCapacity" c ON c."csvDashboardId" = r."csvDashboardId" AND c."siteKey" = ${siteKey} AND c."resourceCd" = ${effective}
    JOIN "ProductionScheduleOrderSupplement" q ON q."csvDashboardRowId" = r."id" AND q."csvDashboardId" = r."csvDashboardId"
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND r."rowData"->>'FSEIBAN' = ANY(${order}::text[])
      AND ${trim(Prisma.sql`r."rowData"->>'FSEIBAN'`)} NOT IN ('', '********') AND ${part} <> '' AND ${process} <> ''
      AND ${resource} <> '' AND UPPER(${resource}) <> ALL(${[...policy.grindingResourceCds, ...policy.cuttingExcludedResourceCds]}::text[])
      AND COALESCE(c."unitSplitEnabled", ${effective} IN ('021', '022')) AND q."plannedQuantity" BETWEEN 2 AND 50
      AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleProgress" p WHERE p."csvDashboardRowId" = r."id" AND p."isCompleted")
      AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleExternalCompletion" x WHERE x."csvDashboardRowId" = r."id" AND x."isExternallyCompleted")
      AND ${buildMaxProductNoWinnerCondition('r')}
      AND NOT EXISTS (SELECT 1 FROM "CsvDashboardRow" e WHERE e."csvDashboardId" = r."csvDashboardId"
        AND e."rowData"->>'FSEIBAN' = ANY(${order}::text[])
        AND e."rowData"->>'FSEIBAN' = r."rowData"->>'FSEIBAN'
        AND e."rowData"->>'FHINCD' = r."rowData"->>'FHINCD' AND ${earlierProcess} <> '' AND ${trim(Prisma.sql`e."rowData"->>'FSIGENCD'`)} <> ''
        AND ${laterThanEarlier} AND ${buildMaxProductNoWinnerCondition('e')})
      -- Similar-looking but different raw part keys cannot share downstream pieces.
      AND NOT EXISTS (SELECT 1 FROM "CsvDashboardRow" e WHERE e."csvDashboardId" = r."csvDashboardId"
        AND e."rowData"->>'FSEIBAN' = r."rowData"->>'FSEIBAN'
        AND e."rowData"->>'FHINCD' <> r."rowData"->>'FHINCD'
        AND ${trim(Prisma.sql`e."rowData"->>'FSIGENCD'`)} <> '' AND ${earlierProcess} <> ''
        AND ${trim(Prisma.sql`NORMALIZE(e."rowData"->>'FHINCD', NFKC)`)} = ${trim(Prisma.sql`NORMALIZE(r."rowData"->>'FHINCD', NFKC)`)}
        AND ${buildMaxProductNoWinnerCondition('e')})
    ), input_keys AS (
      SELECT DISTINCT r."rowData"->>'FSEIBAN' AS "fseiban", ${parentId} AS "parentId"
      FROM "CsvDashboardRow" r WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND r."rowData"->>'FSEIBAN' = ANY(ARRAY(SELECT DISTINCT "fseiban" FROM eligible))
        AND ${buildMaxProductNoWinnerCondition('r')}
    ), input_generations AS MATERIALIZED (
      SELECT "fseiban", MD5(STRING_AGG("parentId", ',' ORDER BY "parentId" COLLATE "C")) AS "inputKey"
      FROM input_keys GROUP BY "fseiban"
    ), inputs AS (
      SELECT r."id", r."fseiban", r."parentId", g."inputKey" FROM eligible r
        JOIN input_generations g ON g."fseiban" = r."fseiban"
    ) SELECT "id", "fseiban", "parentId", "inputKey" FROM inputs r
      WHERE NOT EXISTS (SELECT 1 FROM JSONB_TO_RECORDSET(${JSON.stringify(excludedInputs)}::jsonb)
        AS excluded("parentId" text, "inputKey" text)
        WHERE excluded."parentId" = r."parentId" AND excluded."inputKey" = r."inputKey")
      ORDER BY "fseiban" COLLATE "C", "parentId" COLLATE "C", "id"`;
}
