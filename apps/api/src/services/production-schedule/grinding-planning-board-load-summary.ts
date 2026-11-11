import { getGrindingPlanningBoardResourceMinutes } from './grinding-planning-board-resource-minutes.service.js';
import { resolveRequiredMinutes } from './grinding-planning-board-required-minutes.js';
import { SESSAKU_PIECE_INCLUDE_SETUP_SQL, SESSAKU_PIECE_LOAD_JOINS_SQL } from './sessaku-pieces/piece-load.sql.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  GrindingPlanningBoardResourceMinutesResponse,
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardLoad,
  GrindingPlanningBoardLoadResponse
} from '@raspi-system/shared-types';

import { ApiError } from '../../lib/errors.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import type { GrindingPlanningBoardPerformance } from './grinding-planning-board-performance.js';
import {
  buildGrindingPlanningBoardRowItemId
} from './grinding-planning-board-projection.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';
import { addPlanningTestBarLoad } from './grinding-planning-board-load-test-bars.js';

export type GrindingPlanningBoardLoadSummaryRow = {
  /** Stable logical item id. Duplicate rows with this id are counted once. */
  itemId: string;
  /** Source row id. */
  sourceRowId: string;
  kind: 'row' | 'piece';
  originalResourceCd: string | null;
  effectiveResourceCd: string | null;
  /** Source required minutes. */
  requiredMinutes: number | null;
  requiredMinutesKnown: boolean;
  isCompleted: boolean;
};

export type GrindingPlanningBoardLoadSummary = GrindingPlanningBoardLoadResponse;

export type GrindingPlanningBoardLoadSummaryDbClient = Pick<PrismaClient, '$queryRaw'>;

export type ReadGrindingPlanningBoardLoadSummaryParams = {
  resourceMinutes?: GrindingPlanningBoardResourceMinutesResponse;
  client: GrindingPlanningBoardLoadSummaryDbClient;
  dashboardId?: string;
  /** Canonical winner ids, used by the isolated fallback path and tests. */
  winnerRowIds?: readonly string[];
  /** Existing leaderboard materialization predicate. Avoids re-reading ids in 900-row chunks. */
  leaderboardMaterializedBaseWhere?: Prisma.Sql;
  siteKey: string;
  category: GrindingPlanningBoardCategory;
  isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => boolean;
  cache?: {
    scheduleSource?: 'general' | 'dCompany' | 'both';
    generationToken: string;
    readGenerationToken: () => Promise<string>;
    performance: GrindingPlanningBoardPerformance;
  };
};

type LoadSummarySourceRow = {
  includeSetup?: boolean;
  pieceId?: string | null; pieceQuantity?: number | null; quantityWarning?: string | null;
  id: string;
  fseiban: string | null;
  fhinCd: string | null;
  productNo: string | null;
  resourceCd: string | null;
  processOrder: string | null;
  requiredMinutesRaw: string | null;
  requiredMinutes: number | null;
  isCompleted: boolean;
  plannedQuantity: number | null;
};

type LoadSummaryOverrideRow = {
  itemKey: string;
  overrideResourceCd: string | null;
};

type LoadSummaryOverrideBinding = {
  itemKind: 'row';
  fseiban: string | null;
  productNo: string | null;
  fhincd: string | null;
  resourceCd: string | null;
  processOrder: string | null;
  overrideResourceCd: string | null;
};

type LoadSummaryAggregateRow = {
  originalResourceCd: string | null;
  effectiveResourceCd: string | null;
  includeSetup?: boolean;
  fhincd?: string | null; quantity?: number | null;
  itemCount: bigint;
  unknownItemCount: bigint;
  requiredMinutesSum: number | null;
};

const SOURCE_ROW_CHUNK_SIZE = 900;
const MAX_LOAD_SUMMARY_CACHE_ENTRIES = 128;
// The generation token sees insert/update/delete on every table the aggregate
// reads, provided runtime writers advance updatedAt (Prisma does; raw SQL must).
// Migrations may skip it, but they ship with a restart that drops this cache.
// The fixed age is only a backstop against a writer that breaks that rule.
const LOAD_SUMMARY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
type AggregateCacheEntry = {
  siteKey: string;
  dashboardId: string;
  generationToken: string;
  promise: Promise<LoadSummaryAggregateRow[]>;
  completedAtMs?: number;
};
const aggregateCaches = new WeakMap<GrindingPlanningBoardLoadSummaryDbClient, {
  completed: Map<string, AggregateCacheEntry>;
  inFlight: Map<string, AggregateCacheEntry>;
}>();

function decodeAggregateOverride(row: LoadSummaryOverrideRow): LoadSummaryOverrideBinding | null {
  if (!row.itemKey.startsWith('row:')) return null;
  try {
    const values: unknown = JSON.parse(Buffer.from(row.itemKey.slice(4), 'base64url').toString('utf8'));
    if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')
      || !(values.length === 4 && values[0] !== '********' || values.length === 5 && values[0] === '********')) return null;
    const canonicalItemKey = buildGrindingPlanningBoardRowItemId({
      FSEIBAN: values[0],
      FHINCD: values[1],
      FSIGENCD: values[2],
      FKOJUN: values[3],
      ProductNo: values[4]
    });
    if (canonicalItemKey !== row.itemKey) return null;
    return {
      itemKind: 'row',
      fseiban: values[0],
      productNo: values[4] ?? null,
      fhincd: values[1],
      resourceCd: values[2],
      processOrder: values[3],
      overrideResourceCd: row.overrideResourceCd
    };
  } catch {
    return null;
  }
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push([...values.slice(index, index + size)]);
  }
  return chunks;
}

function buildSourceRowData(row: LoadSummarySourceRow): Record<string, string> {
  return {
    // Preserve JSON ->> text exactly for the canonical logical key.
    FSEIBAN: row.fseiban ?? '',
    FHINCD: row.fhinCd ?? '',
    ProductNo: row.productNo ?? '',
    FSIGENCD: row.resourceCd ?? '',
    FKOJUN: row.processOrder ?? '',
    FSIGENSHOYORYO: row.requiredMinutesRaw ?? ''
  };
}

function resolveOverrideResource(
  overrideByItemKey: ReadonlyMap<string, string | null>,
  itemKey: string,
  originalResourceCd: string
): string {
  const override = overrideByItemKey.get(itemKey);
  return (override == null ? null : normalizeProductionScheduleResourceCd(override)) ?? originalResourceCd;
}

function toSummaryRow(
  row: LoadSummarySourceRow,
  overrideByItemKey: ReadonlyMap<string, string | null>,
  settings: GrindingPlanningBoardResourceMinutesResponse,
  originalResourceCd: string
): GrindingPlanningBoardLoadSummaryRow {
  const rowData = buildSourceRowData(row);
  const parentItemId = buildGrindingPlanningBoardRowItemId(rowData);
  if (row.pieceId) {
    const itemId = `piece:${row.pieceId}`;
    const effectiveResourceCd = resolveOverrideResource(overrideByItemKey, overrideByItemKey.has(itemId) ? itemId : parentItemId, originalResourceCd);
    const minutes = row.plannedQuantity != null && row.plannedQuantity > 0 && row.quantityWarning !== 'INVALID_PLANNED_QUANTITY' && row.requiredMinutes != null && row.requiredMinutes > 0
      ? row.requiredMinutes * (row.pieceQuantity ?? 0) / row.plannedQuantity : null; return { itemId, sourceRowId: row.id, kind: 'piece', originalResourceCd,
      effectiveResourceCd,
      ...resolveRequiredMinutes({ originalMinutes: minutes, originalKnown: minutes != null,
        quantity: row.pieceQuantity ?? null, includeSetup: row.includeSetup, effectiveResourceCd, fhincd: row.fhinCd ?? '' }, settings), isCompleted: row.isCompleted };
  }
  const effectiveResourceCd = resolveOverrideResource(overrideByItemKey, parentItemId, originalResourceCd);
  return {
    itemId: parentItemId,
    sourceRowId: row.id,
    kind: 'row',
    originalResourceCd,
    effectiveResourceCd,
    ...resolveRequiredMinutes({ originalMinutes: row.requiredMinutes, originalKnown: row.requiredMinutes != null,
      quantity: row.plannedQuantity, effectiveResourceCd, fhincd: row.fhinCd ?? '' }, settings),
    isCompleted: row.isCompleted
  };
}

function buildGrindingPlanningBoardLoadSummaryFromAggregates(
  aggregateRows: readonly LoadSummaryAggregateRow[],
  params: Pick<ReadGrindingPlanningBoardLoadSummaryParams, 'category' | 'isResourceInCategory'>
): GrindingPlanningBoardLoadSummary {
  const byResource = new Map<string, GrindingPlanningBoardLoad>();
  let unknownRequiredMinutesCount = 0;

  const ensure = (resourceCd: string): GrindingPlanningBoardLoad => {
    const existing = byResource.get(resourceCd);
    if (existing) return existing;
    const created: GrindingPlanningBoardLoad = {
      resourceCd,
      originalItemCount: 0,
      alternateItemCount: 0,
      originalRequiredMinutes: null,
      alternateRequiredMinutes: null,
      unfinishedItemCount: 0,
      requiredMinutes: null,
      unknownItemCount: 0,
      originalUnknownItemCount: 0,
      alternateUnknownItemCount: 0
    };
    byResource.set(resourceCd, created);
    return created;
  };

  for (const aggregate of aggregateRows) {
    const originalResource = aggregate.originalResourceCd == null
      ? null
      : normalizeProductionScheduleResourceCd(aggregate.originalResourceCd);
    if (originalResource == null || !params.isResourceInCategory(originalResource, params.category)) continue;

    const originalLoadResource = originalResource.trim() || null;
    const effectiveResource = aggregate.effectiveResourceCd == null
      ? null
      : normalizeProductionScheduleResourceCd(aggregate.effectiveResourceCd);
    const effectiveLoadResource = effectiveResource?.trim() || null;
    if (originalLoadResource == null && effectiveLoadResource == null) continue;

    const itemCount = Number(aggregate.itemCount);
    const unknownItemCount = Number(aggregate.unknownItemCount);
    unknownRequiredMinutesCount += unknownItemCount;

    if (originalLoadResource != null) {
      const originalEntry = ensure(originalLoadResource);
      originalEntry.originalItemCount += itemCount;
      addMinutes(originalEntry, 'originalRequiredMinutes', aggregate.requiredMinutesSum);
      originalEntry.originalUnknownItemCount += unknownItemCount;
    }

    if (effectiveLoadResource != null) {
      const alternateEntry = ensure(effectiveLoadResource);
      alternateEntry.alternateItemCount += itemCount;
      alternateEntry.unfinishedItemCount += itemCount;
      addMinutes(alternateEntry, 'alternateRequiredMinutes', aggregate.requiredMinutesSum);
      alternateEntry.alternateUnknownItemCount += unknownItemCount;
      alternateEntry.unknownItemCount += unknownItemCount;
    }
  }

  for (const entry of byResource.values()) {
    if (entry.originalItemCount === 0 && entry.originalUnknownItemCount === 0) {
      entry.originalRequiredMinutes = 0;
    }
    if (entry.alternateItemCount === 0 && entry.alternateUnknownItemCount === 0) {
      entry.alternateRequiredMinutes = 0;
    }
    entry.requiredMinutes = entry.alternateRequiredMinutes;
  }

  return {
    load: [...byResource.values()].sort((left, right) => left.resourceCd.localeCompare(right.resourceCd)),
    unknownRequiredMinutesCount
  };
}

async function readAggregatedLoadSummary(params: {
  client: GrindingPlanningBoardLoadSummaryDbClient;
  dashboardId: string;
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  overrideRows: readonly LoadSummaryOverrideRow[];
  siteKey: string;
  resourceMinutes: GrindingPlanningBoardResourceMinutesResponse;
}): Promise<LoadSummaryAggregateRow[]> {
  const overrideBindings = params.overrideRows.flatMap((row) => {
    const binding = decodeAggregateOverride(row);
    return binding == null ? [] : [binding];
  });

  // DISTINCT ON keeps the same first source row per logical item without the
  // ROW_NUMBER() = 1 selectivity underestimate that caused items × overrides scans.
  const aggregateRows = await params.client.$queryRaw<LoadSummaryAggregateRow[]>(Prisma.sql`
    WITH "baseRows" AS (
      SELECT
        "CsvDashboardRow"."id",
        "CsvDashboardRow"."rowData"->>'FSEIBAN' AS "fseiban",
        "CsvDashboardRow"."rowData"->>'ProductNo' AS "productNo",
        "CsvDashboardRow"."rowData"->>'FHINCD' AS "fhincd",
        "CsvDashboardRow"."rowData"->>'FSIGENCD' AS "resourceCd",
        "CsvDashboardRow"."rowData"->>'FKOJUN' AS "processOrder",
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
            AND (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric >= 0
          THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::double precision
          ELSE NULL
        END AS "requiredMinutes",
        ${SESSAKU_PIECE_INCLUDE_SETUP_SQL},
        "supplement"."plannedQuantity", pc."id" AS "pieceId", pc."quantity" AS "pieceQuantity", ps."quantityWarning"
      FROM "CsvDashboardRow"
      LEFT JOIN "ProductionScheduleProgress" AS "p"
        ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "p"."csvDashboardId" = ${params.dashboardId}
      LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
        ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "ext"."csvDashboardId" = ${params.dashboardId}
      LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
        ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "supplement"."csvDashboardId" = ${params.dashboardId}
        AND (BTRIM(COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '')) <> '********'
          OR "supplement"."productNo" = ("CsvDashboardRow"."rowData"->>'ProductNo'))
      ${SESSAKU_PIECE_LOAD_JOINS_SQL}
      WHERE ${params.leaderboardMaterializedBaseWhere}
        AND NOT (COALESCE("ext"."isExternallyCompleted", FALSE)
          OR CASE WHEN pc."id" IS NULL THEN COALESCE("p"."isCompleted", FALSE) ELSE pc."isCompleted" END)
    ),
    "items" AS (
      SELECT
        b."id" AS "sourceRowId", b."pieceId", b."includeSetup",
        b."fseiban",
        b."productNo",
        b."fhincd",
        b."processOrder",
        b."resourceCd" AS "originalResourceCd",
        CASE WHEN b."pieceId" IS NULL THEN b."plannedQuantity" ELSE b."pieceQuantity" END AS "quantity",
        'row'::text AS "itemKind",
        CASE WHEN b."pieceId" IS NULL THEN b."requiredMinutes"
          WHEN b."requiredMinutes" > 0 AND b."plannedQuantity" > 0 AND COALESCE(b."quantityWarning", '') <> 'INVALID_PLANNED_QUANTITY'
          THEN b."requiredMinutes" * b."pieceQuantity" / b."plannedQuantity" ELSE NULL END AS "requiredMinutes"
      FROM "baseRows" AS b
    ),
    "deduplicatedItems" AS (
      SELECT DISTINCT ON (
        "items"."pieceId",
        COALESCE("items"."fseiban", ''),
        CASE WHEN "items"."fseiban" = '********' THEN COALESCE("items"."productNo", '') ELSE '' END,
        COALESCE("items"."fhincd", ''),
        COALESCE("items"."processOrder", ''),
        COALESCE("items"."originalResourceCd", '')
      ) "items".*
      FROM "items"
      ORDER BY "items"."pieceId",
        COALESCE("items"."fseiban", ''),
        CASE WHEN "items"."fseiban" = '********' THEN COALESCE("items"."productNo", '') ELSE '' END,
        COALESCE("items"."fhincd", ''),
        COALESCE("items"."processOrder", ''),
        COALESCE("items"."originalResourceCd", ''),
        "items"."sourceRowId"
    ),
    "overrides" AS MATERIALIZED (
      SELECT *
      FROM jsonb_to_recordset(${JSON.stringify(overrideBindings)}::jsonb) AS "overrideRows"(
        "itemKind" text,
        "fseiban" text,
        "productNo" text,
        "fhincd" text,
        "resourceCd" text,
        "processOrder" text,
        "overrideResourceCd" text
      )
    ),
    "effectiveItems" AS (
      SELECT
        "deduplicatedItems"."sourceRowId",
        "deduplicatedItems"."pieceId",
        "deduplicatedItems"."originalResourceCd",
        CASE
          WHEN "pieceOverrides"."itemKey" IS NOT NULL THEN COALESCE("pieceOverrides"."overrideResourceCd", "deduplicatedItems"."originalResourceCd")
          WHEN "rowOverrides"."overrideResourceCd" IS NULL
          THEN "deduplicatedItems"."originalResourceCd"
          ELSE "rowOverrides"."overrideResourceCd"
        END AS "effectiveResourceCd",
        "deduplicatedItems"."requiredMinutes",
        "deduplicatedItems"."fhincd", "deduplicatedItems"."quantity", "deduplicatedItems"."includeSetup"
      FROM "deduplicatedItems"
      LEFT JOIN "ProductionScheduleGrindingPlanningBoardOverride" "pieceOverrides"
        ON "pieceOverrides"."csvDashboardId" = ${params.dashboardId} AND "pieceOverrides"."siteKey" = ${params.siteKey}
          AND "pieceOverrides"."itemKey" = ('piece:' || "deduplicatedItems"."pieceId")
      LEFT JOIN "overrides" AS "rowOverrides"
        ON "deduplicatedItems"."itemKind" = 'row'
          AND "rowOverrides"."itemKind" = 'row'
          AND "rowOverrides"."fseiban" = COALESCE("deduplicatedItems"."fseiban", '')
          AND ("deduplicatedItems"."fseiban" <> '********' OR "rowOverrides"."productNo" = COALESCE("deduplicatedItems"."productNo", ''))
          AND "rowOverrides"."fhincd" = COALESCE("deduplicatedItems"."fhincd", '')
          AND "rowOverrides"."resourceCd" = COALESCE("deduplicatedItems"."originalResourceCd", '')
          AND "rowOverrides"."processOrder" = COALESCE("deduplicatedItems"."processOrder", '')
    )
    SELECT
      "originalResourceCd",
      "effectiveResourceCd",
      "fhincd", "quantity", "includeSetup",
      COUNT(*)::bigint AS "itemCount",
      COUNT(*) FILTER (WHERE "requiredMinutes" IS NULL)::bigint AS "unknownItemCount",
      SUM("requiredMinutes" ORDER BY "sourceRowId", "pieceId")::double precision AS "requiredMinutesSum"
    FROM "effectiveItems"
    GROUP BY "originalResourceCd", "effectiveResourceCd", "fhincd", "quantity", "requiredMinutes", "includeSetup"
  `);

  return aggregateRows.map((row) => {
    const count = Number(row.itemCount);
    const resolved = resolveRequiredMinutes({
      originalMinutes: row.requiredMinutesSum == null ? null : row.requiredMinutesSum / count,
      originalKnown: Number(row.unknownItemCount) === 0,
      quantity: row.quantity ?? null, includeSetup: row.includeSetup, effectiveResourceCd: row.effectiveResourceCd, fhincd: row.fhincd ?? ''
    }, params.resourceMinutes);
    return resolved.requiredMinutesSource === 'own'
      ? { ...row, requiredMinutesSum: resolved.requiredMinutes! * count, unknownItemCount: 0n } : row;
  });
}

async function readMaterializedLoadAggregates(
  params: ReadGrindingPlanningBoardLoadSummaryParams & { leaderboardMaterializedBaseWhere: Prisma.Sql },
  dashboardId: string
): Promise<LoadSummaryAggregateRow[]> {
  const compute = async () => {
    const overrideRows = await params.client.$queryRaw<LoadSummaryOverrideRow[]>(Prisma.sql`
      SELECT "itemKey", "overrideResourceCd"
      FROM "ProductionScheduleGrindingPlanningBoardOverride"
      WHERE "csvDashboardId" = ${dashboardId}
        AND "siteKey" = ${params.siteKey}
    `);
    return readAggregatedLoadSummary({
      client: params.client, dashboardId, siteKey: params.siteKey,
      leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere,
      overrideRows, resourceMinutes: params.resourceMinutes!
    });
  };
  const context = params.cache;
  if (!context) return compute();
  let caches = aggregateCaches.get(params.client);
  if (!caches) {
    caches = { completed: new Map(), inFlight: new Map() };
    aggregateCaches.set(params.client, caches);
  }
  const { completed, inFlight } = caches;
  // Only completed entries are purged here: a late request of an older
  // generation must not evict the newer generation's in-flight aggregate.
  const now = Date.now();
  for (const [key, entry] of completed) {
    const expired = entry.completedAtMs != null && now - entry.completedAtMs > LOAD_SUMMARY_CACHE_TTL_MS;
    if (expired || (entry.siteKey === params.siteKey && entry.dashboardId === dashboardId && entry.generationToken !== context.generationToken)) {
      completed.delete(key);
    }
  }
  // The base predicate is dashboard + canonical winner membership. Membership
  // order is immaterial; normalize it so the resolver's row order cannot miss.
  const key = JSON.stringify({
    siteKey: params.siteKey, dashboardId, generationToken: context.generationToken,
    scheduleSource: context.scheduleSource ?? 'both',
    baseWhere: {
      strings: params.leaderboardMaterializedBaseWhere.strings,
      values: params.leaderboardMaterializedBaseWhere.values.map((value) => Array.isArray(value) ? [...value].sort() : value)
    }
  });
  const existing = completed.get(key) ?? inFlight.get(key);
  if (existing) return context.performance.measure('loadSummaryCacheHit', () => existing.promise);
  const entry: AggregateCacheEntry = {
    siteKey: params.siteKey, dashboardId, generationToken: context.generationToken,
    promise: context.performance.measure('loadSummaryCompute', async () => {
      const rows = await compute();
      if (await context.readGenerationToken() !== context.generationToken) {
        throw new ApiError(409, '一覧の元データが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_SNAPSHOT');
      }
      return rows;
    })
  };
  inFlight.set(key, entry);
  try {
    const rows = await entry.promise;
    if (inFlight.get(key) === entry) {
      entry.completedAtMs = Date.now();
      completed.set(key, entry);
      if (completed.size > MAX_LOAD_SUMMARY_CACHE_ENTRIES) completed.delete(completed.keys().next().value!);
    }
    return rows;
  } finally {
    if (inFlight.get(key) === entry) inFlight.delete(key);
  }
}

/**
 * Reads only the columns needed to build the load summary. Winner selection is
 * owned by the caller; callers should pass the canonical materialization
 * predicate, or canonical winner ids for the isolated fallback path.
 * No full rowData, note, rank, or machine metadata is selected.
 */
export async function readGrindingPlanningBoardLoadSummary(
  params: ReadGrindingPlanningBoardLoadSummaryParams
): Promise<GrindingPlanningBoardLoadSummary> {
  const winnerRowIds = [...new Set((params.winnerRowIds ?? []).map((id) => id.trim()).filter(Boolean))].sort();
  if (params.leaderboardMaterializedBaseWhere === undefined && winnerRowIds.length === 0) {
    return addPlanningTestBarLoad({ load: [], unknownRequiredMinutesCount: 0 }, params);
  }
  const dashboardId = params.dashboardId ?? PRODUCTION_SCHEDULE_DASHBOARD_ID;
  const resourceMinutes = params.resourceMinutes ?? await getGrindingPlanningBoardResourceMinutes({ siteKey: params.siteKey });
  if (params.leaderboardMaterializedBaseWhere !== undefined) {
    const rows = await readMaterializedLoadAggregates({ ...params, resourceMinutes, leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere }, dashboardId);
    return addPlanningTestBarLoad(buildGrindingPlanningBoardLoadSummaryFromAggregates(rows, params), params);
  }
  const rows: LoadSummarySourceRow[] = [];
  const readSourceRows = async (where: Prisma.Sql) => {
    rows.push(...await params.client.$queryRaw<LoadSummarySourceRow[]>(Prisma.sql`
      SELECT
        "CsvDashboardRow"."id",
        "CsvDashboardRow"."rowData"->>'FSEIBAN' AS "fseiban",
        "CsvDashboardRow"."rowData"->>'FHINCD' AS "fhinCd",
        "CsvDashboardRow"."rowData"->>'ProductNo' AS "productNo",
        "CsvDashboardRow"."rowData"->>'FSIGENCD' AS "resourceCd",
        "CsvDashboardRow"."rowData"->>'FKOJUN' AS "processOrder",
        "CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO' AS "requiredMinutesRaw",
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
            AND (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric >= 0
          THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::double precision
          ELSE NULL
        END AS "requiredMinutes",
        (CASE WHEN pc."id" IS NULL THEN COALESCE("p"."isCompleted", FALSE) ELSE pc."isCompleted" END OR COALESCE("ext"."isExternallyCompleted", FALSE)) AS "isCompleted",
        ${SESSAKU_PIECE_INCLUDE_SETUP_SQL},
        pc."id" AS "pieceId", pc."quantity" AS "pieceQuantity", ps."quantityWarning",
        "supplement"."plannedQuantity" AS "plannedQuantity"
      FROM "CsvDashboardRow"
      LEFT JOIN "ProductionScheduleProgress" AS "p"
        ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "p"."csvDashboardId" = ${dashboardId}
      LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
        ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "ext"."csvDashboardId" = ${dashboardId}
      LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
        ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
        AND "supplement"."csvDashboardId" = ${dashboardId}
        AND (BTRIM(COALESCE("CsvDashboardRow"."rowData"->>'FSEIBAN', '')) <> '********'
          OR "supplement"."productNo" = ("CsvDashboardRow"."rowData"->>'ProductNo'))
      ${SESSAKU_PIECE_LOAD_JOINS_SQL}
      WHERE ${where}
        AND NOT (COALESCE("ext"."isExternallyCompleted", FALSE)
          OR CASE WHEN pc."id" IS NULL THEN COALESCE("p"."isCompleted", FALSE) ELSE pc."isCompleted" END)
      ORDER BY "CsvDashboardRow"."id", pc."id"
    `));
  };

  for (const ids of chunk(winnerRowIds, SOURCE_ROW_CHUNK_SIZE)) {
    const idParts = ids.map((id) => Prisma.sql`${id}`);
    await readSourceRows(Prisma.sql`
      "CsvDashboardRow"."csvDashboardId" = ${dashboardId}
      AND "CsvDashboardRow"."id"::text = ANY(ARRAY[${Prisma.join(idParts)}]::text[])
    `);
  }

  const overrideRows = await params.client.$queryRaw<LoadSummaryOverrideRow[]>(Prisma.sql`
    SELECT "itemKey", "overrideResourceCd"
    FROM "ProductionScheduleGrindingPlanningBoardOverride"
    WHERE "csvDashboardId" = ${dashboardId}
      AND "siteKey" = ${params.siteKey}
  `);
  const overrideByItemKey = new Map(overrideRows.map((row) => [row.itemKey, row.overrideResourceCd]));
  const summaryRows = rows.flatMap((row) => {
    const originalResourceCd = row.resourceCd == null ? null : normalizeProductionScheduleResourceCd(row.resourceCd);
    if (originalResourceCd == null || !params.isResourceInCategory(originalResourceCd, params.category)) return [];
    return [toSummaryRow(row, overrideByItemKey, resourceMinutes, originalResourceCd)];
  });
  return addPlanningTestBarLoad(buildGrindingPlanningBoardLoadSummary(summaryRows), params);
}

function addMinutes(
  entry: GrindingPlanningBoardLoad,
  field: 'originalRequiredMinutes' | 'alternateRequiredMinutes',
  minutes: number | null
): void {
  if (minutes == null) return;
  entry[field] = (entry[field] ?? 0) + minutes;
}

/**
 * Aggregates the load view from lightweight logical item summaries.
 *
 * The caller supplies all rows for the board, including unselected seiban. The
 * summary intentionally does not perform winner selection, category filtering,
 * completion resolution; those stay in the existing source pipeline.
 */
export function buildGrindingPlanningBoardLoadSummary(
  inputRows: readonly GrindingPlanningBoardLoadSummaryRow[]
): GrindingPlanningBoardLoadSummary {
  const rows: GrindingPlanningBoardLoadSummaryRow[] = [];
  const seen = new Set<string>();
  for (const row of inputRows) {
    const itemId = row.itemId.trim();
    if (!itemId || seen.has(itemId)) continue;
    seen.add(itemId);
    rows.push(row);
  }

  const byResource = new Map<string, GrindingPlanningBoardLoad>();
  let unknownRequiredMinutesCount = 0;

  const ensure = (resourceCd: string): GrindingPlanningBoardLoad => {
    const existing = byResource.get(resourceCd);
    if (existing) return existing;
    const created: GrindingPlanningBoardLoad = {
      resourceCd,
      originalItemCount: 0,
      alternateItemCount: 0,
      originalRequiredMinutes: null,
      alternateRequiredMinutes: null,
      unfinishedItemCount: 0,
      requiredMinutes: null,
      unknownItemCount: 0,
      originalUnknownItemCount: 0,
      alternateUnknownItemCount: 0
    };
    byResource.set(resourceCd, created);
    return created;
  };

  rows.sort((left, right) => left.sourceRowId < right.sourceRowId ? -1 : left.sourceRowId > right.sourceRowId ? 1
    : left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0);
  for (const row of rows) {
    if (row.isCompleted) continue;
    const originalResource = row.originalResourceCd?.trim() || null;
    const alternateResource = row.effectiveResourceCd?.trim() || null;
    if (originalResource == null && alternateResource == null) continue;

    const unknown = !row.requiredMinutesKnown || row.requiredMinutes == null;
    if (unknown) unknownRequiredMinutesCount += 1;

    if (originalResource != null) {
      const originalEntry = ensure(originalResource);
      originalEntry.originalItemCount += 1;
      addMinutes(originalEntry, 'originalRequiredMinutes', row.requiredMinutes);
      if (unknown) originalEntry.originalUnknownItemCount += 1;
    }

    if (alternateResource != null) {
      const alternateEntry = ensure(alternateResource);
      alternateEntry.alternateItemCount += 1;
      alternateEntry.unfinishedItemCount += 1;
      addMinutes(alternateEntry, 'alternateRequiredMinutes', row.requiredMinutes);
      if (unknown) {
        alternateEntry.alternateUnknownItemCount += 1;
        alternateEntry.unknownItemCount += 1;
      }
    }
  }

  for (const entry of byResource.values()) {
    if (entry.originalItemCount === 0 && entry.originalUnknownItemCount === 0) {
      entry.originalRequiredMinutes = 0;
    }
    if (entry.alternateItemCount === 0 && entry.alternateUnknownItemCount === 0) {
      entry.alternateRequiredMinutes = 0;
    }
    entry.requiredMinutes = entry.alternateRequiredMinutes;
  }

  return {
    load: [...byResource.values()].sort((left, right) => left.resourceCd.localeCompare(right.resourceCd)),
    unknownRequiredMinutesCount
  };
}
