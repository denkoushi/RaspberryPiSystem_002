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
export function isFirstAutoUnitSplitProcess(item: GrindingPlanningBoardItem, items: readonly GrindingPlanningBoardItem[]): boolean {
  return !items.some((other) => other.fseiban === item.fseiban && other.fhincd.trim() !== ''
    && other.originalResourceCd?.trim() && other.processOrder.trim()
    && (other.fhincd === item.fhincd ? isLaterProcessOrder(item.processOrder, other.processOrder)
      : other.fhincd.normalize('NFKC').trim() === item.fhincd.normalize('NFKC').trim()));
}

/** The same predicate is executable in pre-deploy counts and SQL/TS contract integration tests. */
export function autoUnitSplitCandidateSql(siteKey: string, order: string[], policy: ResourceCategoryPolicy, excludedParentIds: readonly string[] = []): Prisma.Sql {
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
  const exclusion = excludedParentIds.length ? Prisma.sql`AND (${parentId}) <> ALL(${[...excludedParentIds]}::text[])` : Prisma.empty;
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
      ${exclusion}
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
    ) SELECT "id", "fseiban", "parentId" FROM eligible
      ORDER BY array_position(${order}::text[], "fseiban"), "fseiban" COLLATE "C", "parentId" COLLATE "C", "id"`;
}
