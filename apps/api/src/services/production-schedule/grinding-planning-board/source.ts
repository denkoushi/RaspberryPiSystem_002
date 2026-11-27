import { resolveSessakuPieceItemKeys, sessakuPieceIdFromItemId, type SessakuPieceLogicalKey } from '../sessaku-pieces/piece-key.js';
import { BOARD_DUE_JOINS_SQL, BOARD_MANUAL_UPDATED_AT_SQL } from '../d-schedule-minutes/board-due.sql.js';
import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import type { GrindingPlanningBoardCategory } from '@raspi-system/shared-types';
import { chunkLeaderboardRowIdsForHydrate } from '../leaderboard/leaderboard-display-row-scope.js';
import { getResourceCategoryPolicy, normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { isSendaiResourceGroupCd } from '../resource-master.service.js';
import { buildPartKey, isGrindingPlanningBoardRowCompleted } from '../grinding-planning-board-projection.js';
import type { GrindingPlanningBoardProjectionRanks } from '../grinding-planning-board-projection-input.types.js';
import { buildMaxProductNoLogicalKeyPartitionExprs, buildMaxProductNoWinnerCondition, buildMaxProductNoWinnerSelectionOrderBySql } from '../row-resolver/index.js';
import { STRING_TRIM_CHARACTERS, decodeRowItemId, isCategoryResource, type DbClient, type RankRow, type RowDetail, type WinnerRow } from './shared.js';

export async function readWinnerRowsByIds(client: DbClient, rowIds: readonly string[]): Promise<WinnerRow[]> {
  const ids = [...new Set(rowIds)];
  if (ids.length === 0) return [];
  // Small id sets: per-row winner lookup (same rule as the materialized winner set).
  return client.$queryRaw<WinnerRow[]>(Prisma.sql`
    SELECT "CsvDashboardRow"."id", "CsvDashboardRow"."rowData", "CsvDashboardRow"."updatedAt"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "CsvDashboardRow"."id"::text = ANY(${ids}::text[])
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
  `);
}

/**
 * Winners among rows matching `fseibanFilter`, ranked only inside that subset.
 * Filters must keep or drop whole winner partitions so ROW_NUMBER inside each
 * kept partition stays unchanged.
 */
async function readWinnerRowsByFseibanFilter(client: DbClient, fseibanFilter: Prisma.Sql, progressOnly = false): Promise<WinnerRow[]> {
  const rowData = progressOnly ? Prisma.sql`jsonb_build_object('FSEIBAN', "rowData"->>'FSEIBAN', 'ProductNo', "rowData"->>'ProductNo',
    'FHINCD', "rowData"->>'FHINCD', 'FSIGENCD', "rowData"->>'FSIGENCD')` : Prisma.sql`"rowData"`;
  return client.$queryRaw<WinnerRow[]>(Prisma.sql`
    WITH "ranked" AS (
      SELECT "r"."id", "r"."rowData", "r"."updatedAt",
        ROW_NUMBER() OVER (
          PARTITION BY ${Prisma.raw(buildMaxProductNoLogicalKeyPartitionExprs('r'))}
          ORDER BY ${Prisma.raw(buildMaxProductNoWinnerSelectionOrderBySql('r'))}
        ) AS "rn"
      FROM "CsvDashboardRow" AS "r"
      WHERE "r"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND ${fseibanFilter}
    )
    SELECT "id", ${rowData} AS "rowData", "updatedAt" FROM "ranked" WHERE "rn" = 1
  `);
}

export type SessakuLaneSourceScope = {
  targetFseiban?: string;
  resourceCds: readonly string[];
  inboundKeys: readonly SessakuPieceLogicalKey[];
};

export async function readWinnerRowsByFseibans(client: DbClient, fseibans: readonly string[], laneScope?: SessakuLaneSourceScope): Promise<WinnerRow[]> {
  const values = [...new Set(fseibans.map((value) => value.trim()).filter(Boolean))];
  if (values.length === 0) return [];
  let scope = Prisma.sql`TRUE`;
  if (laneScope) {
    // A test-bar lane uses the full winner partition; piece replacement keeps its existing four-column scope.
    const { inboundKeys, targetFseiban } = laneScope;
    let inbound = Prisma.sql`FALSE`;
    if (inboundKeys.length) inbound = targetFseiban === undefined ? Prisma.sql`
      (${Prisma.raw(buildMaxProductNoLogicalKeyPartitionExprs('r'))}) IN (
        SELECT fseiban, fhincd, fsigencd, fkojun, BTRIM("productNo")
        FROM jsonb_to_recordset(${JSON.stringify(inboundKeys)}::jsonb)
          AS keys(fseiban text, fhincd text, fsigencd text, fkojun text, "productNo" text)
      )` : Prisma.sql`(
      COALESCE("r"."rowData"->>'FSEIBAN', ''), COALESCE("r"."rowData"->>'FHINCD', ''),
      COALESCE("r"."rowData"->>'FSIGENCD', ''), COALESCE("r"."rowData"->>'FKOJUN', '')
    ) IN (${Prisma.join(inboundKeys.map((key) => Prisma.sql`(${key.fseiban}, ${key.fhincd}, ${key.fsigencd}, ${key.fkojun})`))})`;
    // Each predicate depends only on logical-key columns, so it keeps entire winner partitions.
    // Match String.trim() in the projection, including tabs and Unicode whitespace.
    scope = Prisma.sql`("r"."rowData"->>'FSEIBAN' = ${targetFseiban ?? null}
      OR BTRIM("r"."rowData"->>'FSIGENCD', ${STRING_TRIM_CHARACTERS}) = ANY(${[...laneScope.resourceCds]}::text[])
      OR ${inbound})`;
  }
  const filter = Prisma.sql`"r"."rowData"->>'FSEIBAN' = ANY(${values}::text[]) AND ${scope}`;
  if (!laneScope?.inboundKeys.length) return readWinnerRowsByFseibanFilter(client, filter);
  // A long inbound tuple IN list pushes the plan cost past jit_above_cost. PostgreSQL 18 JIT then
  // compiles for minutes without checking interrupts (statement_timeout and pg_terminate_backend
  // do not stop it), so turn JIT off for this transaction only. SET LOCAL needs the same connection
  // inside a transaction; a root client gets its own short transaction.
  const read = async (tx: Prisma.TransactionClient) => {
    await tx.$executeRaw`SET LOCAL jit = off`;
    return readWinnerRowsByFseibanFilter(tx, filter);
  };
  return '$transaction' in client ? client.$transaction(read) : read(client);
}

export async function readLaneCandidateKeys(client: DbClient, siteKey: string, resourceCd: string | null | undefined, referenceIds: readonly string[]) {
  const inbound = resourceCd == null ? [] : await client.$queryRaw<Array<{ itemKey: string }>>(Prisma.sql`
    SELECT "itemKey" FROM "ProductionScheduleGrindingPlanningBoardOverride"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND "siteKey" = ${siteKey}
      AND BTRIM("overrideResourceCd", ${STRING_TRIM_CHARACTERS}) = ${resourceCd}
  `);
  // IDs containing strings PostgreSQL cannot store are stale references, just like missing IDs.
  const isDatabaseText = (value: string) => !value.includes('\0') && !/[\uD800-\uDFFF]/u.test(value);
  const ids = [...new Set([...referenceIds.filter(isDatabaseText), ...inbound.map(({ itemKey }) => itemKey)])];
  const pieces = await resolveSessakuPieceItemKeys(client, ids.filter((id) => sessakuPieceIdFromItemId(id)), { allowMissing: true });
  const keys = [...pieces.values()];
  for (const id of ids) {
    const encoded = decodeRowItemId(id);
    if (!encoded) continue;
    const parts = JSON.parse(encoded) as string[];
    const [fseiban, fhincd, fsigencd, fkojun, productNo] = parts;
    if (productNo !== undefined && parts.every(isDatabaseText)) keys.push({ fseiban, fhincd, fsigencd, fkojun, productNo });
  }
  return keys;
}

export async function readWinnerProgressRows(client: DbClient, fseibans: readonly string[], keys: readonly SessakuPieceLogicalKey[]) {
  if (!keys.length) return [];
  // JS trim preserves the equivalence of ProductNo values in each winner partition.
  const parts = [...new Set(keys.map(({ fseiban, productNo, fhincd }) => buildPartKey(fseiban, productNo, fhincd)))].map((key) => key.split('\0'));
  return readWinnerRowsByFseibanFilter(client, Prisma.sql`
    "r"."rowData"->>'FSEIBAN' = ANY(${[...fseibans]}::text[])
    AND (BTRIM(COALESCE("r"."rowData"->>'FSEIBAN', ''), ${STRING_TRIM_CHARACTERS}), BTRIM(COALESCE("r"."rowData"->>'FHINCD', ''), ${STRING_TRIM_CHARACTERS}),
      BTRIM(COALESCE("r"."rowData"->>'ProductNo', ''), ${STRING_TRIM_CHARACTERS}))
    IN (SELECT * FROM unnest(${parts.map(([fseiban]) => fseiban)}::text[], ${parts.map(([, fhincd]) => fhincd)}::text[],
      ${parts.map(([, , productNo]) => productNo)}::text[]))
  `, true);
}

/** Matches the logical-key identity (`COALESCE(raw, '')`) exactly, unlike the trimmed FSEIBAN lookup. */
export async function readWinnerRowsByLogicalKeyFseibans(client: DbClient, fseibans: readonly string[]): Promise<WinnerRow[]> {
  const values = [...new Set(fseibans)];
  if (values.length === 0) return [];
  return readWinnerRowsByFseibanFilter(client, Prisma.sql`COALESCE("r"."rowData"->>'FSEIBAN', '') = ANY(${values}::text[])`);
}

export async function readRowDetails(client: DbClient, rowIds: readonly string[]): Promise<Map<string, RowDetail>> {
  if (rowIds.length === 0) return new Map();
  const details = new Map<string, RowDetail>();
  for (const chunk of chunkLeaderboardRowIdsForHydrate([...new Set(rowIds)])) {
    const rows = await client.csvDashboardRow.findMany({
      where: { id: { in: chunk }, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: {
        id: true,
        updatedAt: true,
        rowNotes: { where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, orderBy: { updatedAt: 'desc' }, take: 1, select: { dueDate: true } },
        orderSupplements: { where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, select: { plannedQuantity: true, plannedEndDate: true } },
        productionScheduleProgress: { select: { isCompleted: true, updatedAt: true } },
        productionScheduleExternalCompletion: { select: { isExternallyCompleted: true, updatedAt: true } }
      }
    });
    const dueInputs = await client.$queryRaw<Array<{ id: string; manualUpdatedAt: Date | null; excelDueDate: Date | null; excelChangedAt: Date | null }>>`
      SELECT "CsvDashboardRow"."id", ${BOARD_MANUAL_UPDATED_AT_SQL} AS "manualUpdatedAt",
        "excel_due"."partsCompleteDate" AS "excelDueDate", "excel_due"."excelChangedAt" AS "excelChangedAt"
      FROM "CsvDashboardRow"
      LEFT JOIN "ProductionScheduleRowNote" AS "n" ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      ${BOARD_DUE_JOINS_SQL}
      WHERE "CsvDashboardRow"."id" = ANY(${chunk}::text[])
        AND "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    `;
    const byId = new Map(dueInputs.map((row) => [row.id, row]));
    for (const detail of rows) details.set(detail.id, { ...detail, ...byId.get(detail.id) } as RowDetail);
  }
  return details;
}

export async function readRowCompletionFlags(client: DbClient, rowIds: readonly string[]) {
  const flags = new Map<string, boolean>();
  for (const chunk of chunkLeaderboardRowIdsForHydrate(rowIds)) {
    const rows = await client.csvDashboardRow.findMany({
      where: { id: { in: chunk }, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { id: true, productionScheduleProgress: { select: { isCompleted: true } },
        productionScheduleExternalCompletion: { select: { isExternallyCompleted: true } } }
    });
    for (const row of rows) flags.set(row.id, isGrindingPlanningBoardRowCompleted(row));
  }
  return flags;
}

export async function readRanks(client: DbClient, rowIds: readonly string[], siteKey: string, records?: readonly RankRow[]): Promise<GrindingPlanningBoardProjectionRanks> {
  const rows: RankRow[] = records?.filter((row) => row.siteKey === siteKey || row.location === siteKey) ?? [];
  for (const chunk of records ? [] : chunkLeaderboardRowIdsForHydrate([...new Set(rowIds)])) {
    rows.push(...await client.productionScheduleOrderAssignment.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: { in: chunk }, OR: [{ siteKey }, { location: siteKey }] },
      select: { csvDashboardRowId: true, resourceCd: true, orderNumber: true, updatedAt: true, siteKey: true, location: true }, orderBy: { updatedAt: 'desc' }
    }));
  }
  const preferred = (candidate: { location: string; updatedAt: Date }, current: { location: string; updatedAt: Date }) => {
    const candidateRank = candidate.location === siteKey ? 0 : 1;
    const currentRank = current.location === siteKey ? 0 : 1;
    return candidateRank !== currentRank ? candidateRank < currentRank : candidate.updatedAt.getTime() > current.updatedAt.getTime();
  };
  const rowMap = new Map<string, RankRow>();
  for (const row of rows) { const current = rowMap.get(row.csvDashboardRowId); if (!current || preferred(row, current)) rowMap.set(row.csvDashboardRowId, row); }
  return { rows: rowMap };
}

export async function readOverrides(client: DbClient, siteKey: string, itemKeys?: readonly string[]): Promise<Map<string, ProductionScheduleGrindingPlanningBoardOverride>> {
  const rows = await client.productionScheduleGrindingPlanningBoardOverride.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey,
      itemKey: itemKeys == null ? undefined : { in: [...new Set(itemKeys)] },
      ...(itemKeys == null ? { OR: [{ itemKey: { startsWith: 'row:' } }, { itemKey: { startsWith: 'piece:' } }, { itemKey: { startsWith: 'pieceops:' } }] } : {})
    }
  });
  return new Map(rows.map((row) => [row.itemKey, row]));
}

export async function readMasterResourceCds(client: DbClient): Promise<Set<string>> {
  const rows = await client.productionScheduleResourceMaster.findMany({ select: { resourceCd: true } });
  return new Set(rows.map((row) => normalizeProductionScheduleResourceCd(row.resourceCd)).filter(Boolean));
}

// 研削の 582・583 は撤去済み。資源マスタに残っていてもボードの機械に出さない。
export const RETIRED_PLANNING_BOARD_RESOURCE_CDS: ReadonlySet<string> = new Set(['582', '583']);

export async function readPlanningResourceCandidates(client: DbClient, category: GrindingPlanningBoardCategory, policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>): Promise<string[]> {
  const master = await client.productionScheduleResourceMaster.findMany({ select: { resourceCd: true, resourceGroupCd: true } });
  return Array.from(new Set(master.filter((row) => !isSendaiResourceGroupCd(row.resourceGroupCd)).map((row) => normalizeProductionScheduleResourceCd(row.resourceCd)).filter(Boolean))).filter((value) => !RETIRED_PLANNING_BOARD_RESOURCE_CDS.has(value) && isCategoryResource(value, category, policy)).sort((a, b) => a.localeCompare(b));
}
