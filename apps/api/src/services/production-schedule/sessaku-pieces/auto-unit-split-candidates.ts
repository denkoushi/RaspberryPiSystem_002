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

export type AutoUnitSplitRejectedInput = { parentId: string; inputVersion: string };

/** The same predicate is executable in pre-deploy counts and SQL/TS contract integration tests. */
export function autoUnitSplitCandidateSql(siteKey: string, order: string[], policy: ResourceCategoryPolicy, excludedParentIds: readonly string[] = [],
  rejectedInputs: readonly AutoUnitSplitRejectedInput[] = []): Prisma.Sql {
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
  const parentIdFor = (alias: 'r' | 'v') => Prisma.sql`'row:' || RTRIM(TRANSLATE(REPLACE(ENCODE(CONVERT_TO(
    '[' || to_json(COALESCE(${Prisma.raw(alias)}."rowData"->>'FSEIBAN', ''))::text || ',' || to_json(COALESCE(${Prisma.raw(alias)}."rowData"->>'FHINCD', ''))::text || ',' ||
    to_json(COALESCE(${Prisma.raw(alias)}."rowData"->>'FSIGENCD', ''))::text || ',' || to_json(COALESCE(${Prisma.raw(alias)}."rowData"->>'FKOJUN', ''))::text || ']', 'UTF8'), 'base64'), E'\n', ''), '+/', '-_'), '=')`;
  const parentId = parentIdFor('r');
  // Include every eligibility source, not just CSV row data or set versions.
  // Match the board's String.trim semantics, including tabs and full-width spaces.
  const inputVersion = Prisma.sql`MD5(JSONB_BUILD_ARRAY(
    ${JSON.stringify(policy)}::jsonb,
    (SELECT JSONB_AGG(JSONB_BUILD_ARRAY(v."id", v."rowData",
      (SELECT TO_JSONB(q) FROM "ProductionScheduleOrderSupplement" q WHERE q."csvDashboardRowId" = v."id"),
      (SELECT TO_JSONB(p) FROM "ProductionScheduleProgress" p WHERE p."csvDashboardRowId" = v."id"),
      (SELECT TO_JSONB(x) FROM "ProductionScheduleExternalCompletion" x WHERE x."csvDashboardRowId" = v."id"),
      (SELECT JSONB_BUILD_ARRAY(o."itemKey", o."overrideResourceCd") FROM "ProductionScheduleGrindingPlanningBoardOverride" o
        WHERE o."csvDashboardId" = v."csvDashboardId" AND o."siteKey" = ${siteKey} AND o."itemKey" = (${parentIdFor('v')}))
    ) ORDER BY v."id") FROM "CsvDashboardRow" v
      WHERE v."csvDashboardId" = r."csvDashboardId" AND ${trim(Prisma.sql`v."rowData"->>'FSEIBAN'`)} = ${trim(Prisma.sql`r."rowData"->>'FSEIBAN'`)}),
    (SELECT JSONB_AGG(JSONB_BUILD_ARRAY(TO_JSONB(v),
      (SELECT JSONB_AGG(JSONB_BUILD_ARRAY(TO_JSONB(p),
        (SELECT JSONB_AGG(TO_JSONB(op) ORDER BY op."id") FROM "ProductionScheduleSessakuPieceOpCompletion" op WHERE op."pieceId" = p."id"),
        (SELECT JSONB_BUILD_ARRAY(o."itemKey", o."overrideResourceCd") FROM "ProductionScheduleGrindingPlanningBoardOverride" o
          WHERE o."csvDashboardId" = v."csvDashboardId" AND o."siteKey" = ${siteKey} AND o."itemKey" = 'piece:' || p."id")
      ) ORDER BY p."id") FROM "ProductionScheduleSessakuPiece" p WHERE p."pieceSetId" = v."id")
    ) ORDER BY v."id") FROM "ProductionScheduleSessakuPieceSet" v
      WHERE v."csvDashboardId" = r."csvDashboardId" AND v."fseiban" = r."rowData"->>'FSEIBAN'),
    (SELECT JSONB_AGG(TO_JSONB(c) ORDER BY c."id") FROM "ProductionScheduleGrindingPlanningBoardResourceCapacity" c
      WHERE c."csvDashboardId" = r."csvDashboardId" AND c."siteKey" = ${siteKey})
  )::text)`;
  const rejected = rejectedInputs.length ? Prisma.sql`AND NOT EXISTS (
    SELECT 1 FROM JSONB_TO_RECORDSET(${JSON.stringify(rejectedInputs)}::jsonb) AS rejected("parentId" text, "inputVersion" text)
    WHERE rejected."parentId" = (${parentId}) AND rejected."inputVersion" = (${inputVersion}))` : Prisma.empty;
  const exclusion = excludedParentIds.length ? Prisma.sql`AND (${parentId}) <> ALL(${[...excludedParentIds]}::text[])` : Prisma.empty;
  // MATERIALIZED keeps winner/predecessor joins behind quantity and editable-piece
  // probes. Unit pieces and quantity-one CSV rows do no expensive discovery work.
  const splittableRows = Prisma.sql`SELECT r.* FROM "CsvDashboardRow" r
    JOIN "ProductionScheduleOrderSupplement" q ON q."csvDashboardRowId" = r."id" AND q."csvDashboardId" = r."csvDashboardId"
    LEFT JOIN "ProductionScheduleSessakuPieceSet" s ON s."csvDashboardId" = r."csvDashboardId"
      AND s."fseiban" = COALESCE(r."rowData"->>'FSEIBAN', '') AND s."fhincd" = COALESCE(r."rowData"->>'FHINCD', '')
      AND s."fsigencd" = COALESCE(r."rowData"->>'FSIGENCD', '') AND s."fkojun" = COALESCE(r."rowData"->>'FKOJUN', '')
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND r."rowData"->>'FSEIBAN' = ANY(${order}::text[])
      AND ${resource} <> '' AND UPPER(${resource}) <> ALL(${[...policy.grindingResourceCds, ...policy.cuttingExcludedResourceCds]}::text[])
      AND q."plannedQuantity" BETWEEN 2 AND 50 AND s."sourcePieceSetId" IS NULL
      AND s."quantityWarning" IS NULL
      AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPiece" p WHERE p."pieceSetId" = s."id" AND p."sourcePieceId" IS NOT NULL)
      AND (NOT EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPiece" p WHERE p."pieceSetId" = s."id")
        OR EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPiece" p WHERE p."pieceSetId" = s."id"
          AND p."sourcePieceId" IS NULL AND NOT p."isCompleted" AND p."quantity" BETWEEN 2 AND 50
          AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPieceOpCompletion" op WHERE op."pieceId" = p."id")))`;
  const pieceEffective = trim(Prisma.sql`COALESCE(CASE WHEN po."id" IS NOT NULL THEN po."overrideResourceCd" ELSE o."overrideResourceCd" END, r."rowData"->>'FSIGENCD')`);
  return Prisma.sql`WITH splittable_rows AS MATERIALIZED (${splittableRows}), eligible AS MATERIALIZED (
    SELECT r."id", r."csvDashboardId", r."rowData", r."rowData"->>'FSEIBAN' AS "fseiban", ${parentId} AS "parentId" FROM splittable_rows r
    LEFT JOIN "ProductionScheduleGrindingPlanningBoardOverride" o ON o."csvDashboardId" = r."csvDashboardId" AND o."siteKey" = ${siteKey} AND o."itemKey" = (${parentId})
    LEFT JOIN "ProductionScheduleGrindingPlanningBoardResourceCapacity" c ON c."csvDashboardId" = r."csvDashboardId" AND c."siteKey" = ${siteKey} AND c."resourceCd" = ${effective}
    LEFT JOIN "ProductionScheduleSessakuPieceSet" s ON s."csvDashboardId" = r."csvDashboardId"
      AND s."fseiban" = COALESCE(r."rowData"->>'FSEIBAN', '') AND s."fhincd" = COALESCE(r."rowData"->>'FHINCD', '')
      AND s."fsigencd" = COALESCE(r."rowData"->>'FSIGENCD', '') AND s."fkojun" = COALESCE(r."rowData"->>'FKOJUN', '')
    JOIN "ProductionScheduleOrderSupplement" q ON q."csvDashboardRowId" = r."id" AND q."csvDashboardId" = r."csvDashboardId"
    WHERE r."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND r."rowData"->>'FSEIBAN' = ANY(${order}::text[])
      AND ${trim(Prisma.sql`r."rowData"->>'FSEIBAN'`)} NOT IN ('', '********') AND ${part} <> '' AND ${process} <> ''
      AND ${resource} <> '' AND UPPER(${resource}) <> ALL(${[...policy.grindingResourceCds, ...policy.cuttingExcludedResourceCds]}::text[])
      ${exclusion}
      ${rejected}
      AND s."sourcePieceSetId" IS NULL AND s."quantityWarning" IS NULL AND q."plannedQuantity" BETWEEN 2 AND 50
      AND ((NOT EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPiece" p WHERE p."pieceSetId" = s."id")
          AND COALESCE(c."unitSplitEnabled", ${effective} IN ('021', '022')))
        OR EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPiece" p
          LEFT JOIN "ProductionScheduleGrindingPlanningBoardOverride" po ON po."csvDashboardId" = r."csvDashboardId"
            AND po."siteKey" = ${siteKey} AND po."itemKey" = 'piece:' || p."id"
          LEFT JOIN "ProductionScheduleGrindingPlanningBoardResourceCapacity" pc ON pc."csvDashboardId" = r."csvDashboardId"
            AND pc."siteKey" = ${siteKey} AND pc."resourceCd" = ${pieceEffective}
          WHERE p."pieceSetId" = s."id" AND p."sourcePieceId" IS NULL AND NOT p."isCompleted" AND p."quantity" BETWEEN 2 AND 50
            AND COALESCE(pc."unitSplitEnabled", ${pieceEffective} IN ('021', '022'))
            AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPieceOpCompletion" op WHERE op."pieceId" = p."id")
            AND NOT EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPiece" dp
              JOIN "ProductionScheduleSessakuPieceOpCompletion" op ON op."pieceId" = dp."id"
              WHERE dp."sourcePieceId" = p."id")))
      -- Match assertLaterProcessesEditable: only linked sets with a current winner
      -- can block edits through quantity warnings or completed downstream pieces.
      AND (s."id" IS NULL OR NOT EXISTS (SELECT 1 FROM (
        SELECT ds."id" FROM "ProductionScheduleSessakuPieceSet" ds WHERE ds."sourcePieceSetId" = s."id"
        UNION
        SELECT dp."pieceSetId" FROM "ProductionScheduleSessakuPiece" sp
          JOIN "ProductionScheduleSessakuPiece" dp ON dp."sourcePieceId" = sp."id" WHERE sp."pieceSetId" = s."id"
      ) linked JOIN "ProductionScheduleSessakuPieceSet" ds ON ds."id" = linked."id"
        JOIN "CsvDashboardRow" d ON d."csvDashboardId" = ds."csvDashboardId"
          AND COALESCE(d."rowData"->>'FSEIBAN', '') = ds."fseiban" AND COALESCE(d."rowData"->>'FHINCD', '') = ds."fhincd"
          AND COALESCE(d."rowData"->>'FSIGENCD', '') = ds."fsigencd" AND COALESCE(d."rowData"->>'FKOJUN', '') = ds."fkojun"
        WHERE ds."csvDashboardId" = r."csvDashboardId"
          AND (ds."quantityWarning" IS NOT NULL
            OR EXISTS (SELECT 1 FROM "ProductionScheduleSessakuPiece" dp WHERE dp."pieceSetId" = ds."id" AND dp."isCompleted")
            OR EXISTS (SELECT 1 FROM "ProductionScheduleProgress" dp WHERE dp."csvDashboardRowId" = d."id" AND dp."isCompleted")
            OR EXISTS (SELECT 1 FROM "ProductionScheduleExternalCompletion" dx WHERE dx."csvDashboardRowId" = d."id" AND dx."isExternallyCompleted"))
          AND ${buildMaxProductNoWinnerCondition('d')}))
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
    ) SELECT "id", "fseiban", "parentId", ${inputVersion} AS "inputVersion" FROM eligible r
      ORDER BY array_position(${order}::text[], "fseiban"), "fseiban" COLLATE "C", "parentId" COLLATE "C", "id"`;
}
