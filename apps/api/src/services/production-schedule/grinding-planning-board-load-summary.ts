import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  GrindingPlanningBoardCategory,
  GrindingPlanningBoardLoad
} from '@raspi-system/shared-types';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import {
  buildGrindingPlanningBoardRowItemId
} from './grinding-planning-board-projection.js';
import { applySplitQuantityToProductionScheduleRowDisplayFields } from './order-split/split-display-required-minutes.js';
import { normalizeProductionScheduleResourceCd } from './policies/resource-category-policy.service.js';

export type GrindingPlanningBoardLoadSummaryRow = {
  /** Stable logical item id. Duplicate rows with this id are counted once. */
  itemId: string;
  /** Parent row id used to suppress an unsplit parent when split rows are present. */
  sourceRowId: string;
  kind: 'row' | 'split';
  originalResourceCd: string | null;
  effectiveResourceCd: string | null;
  /** Already split-adjusted required minutes. */
  requiredMinutes: number | null;
  requiredMinutesKnown: boolean;
  isCompleted: boolean;
};

export type GrindingPlanningBoardLoadSummary = {
  load: GrindingPlanningBoardLoad[];
  unknownRequiredMinutesCount: number;
};

export type GrindingPlanningBoardLoadSummaryDbClient = Pick<PrismaClient, '$queryRaw'>;

export type ReadGrindingPlanningBoardLoadSummaryParams = {
  client: GrindingPlanningBoardLoadSummaryDbClient;
  dashboardId?: string;
  /** Canonical winner ids, used by the isolated fallback path and tests. */
  winnerRowIds?: readonly string[];
  /** Existing leaderboard materialization predicate. Avoids re-reading ids in 900-row chunks. */
  leaderboardMaterializedBaseWhere?: Prisma.Sql;
  siteKey: string;
  category: GrindingPlanningBoardCategory;
  splitEnabled: boolean;
  isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => boolean;
};

type LoadSummarySourceRow = {
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
  splitId: string | null;
  splitQuantity: number | null;
};

type LoadSummaryOverrideRow = {
  itemKey: string;
  overrideResourceCd: string | null;
};

type LoadSummaryOverrideBinding = {
  itemKind: 'row' | 'split';
  fseiban: string | null;
  fhincd: string | null;
  resourceCd: string | null;
  processOrder: string | null;
  splitId: string | null;
  overrideResourceCd: string | null;
};

type LoadSummaryAggregateRow = {
  originalResourceCd: string | null;
  effectiveResourceCd: string | null;
  itemCount: bigint;
  unknownItemCount: bigint;
  requiredMinutesSum: number | null;
};

const SOURCE_ROW_CHUNK_SIZE = 900;
const SPLIT_PREFIX = 'split:';

function decodeAggregateOverride(row: LoadSummaryOverrideRow): LoadSummaryOverrideBinding | null {
  if (row.itemKey.startsWith(SPLIT_PREFIX)) {
    const splitId = row.itemKey.slice(SPLIT_PREFIX.length);
    return splitId.length > 0
      ? {
          itemKind: 'split',
          fseiban: null,
          fhincd: null,
          resourceCd: null,
          processOrder: null,
          splitId,
          overrideResourceCd: row.overrideResourceCd
        }
      : null;
  }
  if (!row.itemKey.startsWith('row:')) return null;
  try {
    const values: unknown = JSON.parse(Buffer.from(row.itemKey.slice(4), 'base64url').toString('utf8'));
    if (!Array.isArray(values) || values.length !== 4 || values.some((value) => typeof value !== 'string')) return null;
    const canonicalItemKey = buildGrindingPlanningBoardRowItemId({
      FSEIBAN: values[0],
      FHINCD: values[1],
      FSIGENCD: values[2],
      FKOJUN: values[3]
    });
    if (canonicalItemKey !== row.itemKey) return null;
    return {
      itemKind: 'row',
      fseiban: values[0],
      fhincd: values[1],
      resourceCd: values[2],
      processOrder: values[3],
      splitId: null,
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
  params: ReadGrindingPlanningBoardLoadSummaryParams
): GrindingPlanningBoardLoadSummaryRow {
  const rowData = buildSourceRowData(row);
  const originalResourceCd = row.resourceCd == null ? null : normalizeProductionScheduleResourceCd(row.resourceCd);
  if (originalResourceCd == null) {
    return {
      itemId: buildGrindingPlanningBoardRowItemId(rowData),
      sourceRowId: row.id,
      kind: 'row',
      originalResourceCd: null,
      effectiveResourceCd: null,
      requiredMinutes: null,
      requiredMinutesKnown: false,
      isCompleted: row.isCompleted
    };
  }

  const parentItemId = buildGrindingPlanningBoardRowItemId(rowData);
  const itemId = row.splitId == null ? parentItemId : `${SPLIT_PREFIX}${row.splitId}`;
  const overrideKey = itemId;
  const effectiveResourceCd = resolveOverrideResource(overrideByItemKey, overrideKey, originalResourceCd);
  if (row.splitId == null || !params.splitEnabled) {
    return {
      itemId: parentItemId,
      sourceRowId: row.id,
      kind: 'row',
      originalResourceCd,
      effectiveResourceCd,
      requiredMinutes: row.requiredMinutes,
      requiredMinutesKnown: row.requiredMinutes != null,
      isCompleted: row.isCompleted
    };
  }

  const splitFields = applySplitQuantityToProductionScheduleRowDisplayFields(
    {
      plannedQuantity: row.plannedQuantity,
      machineRequiredMinutes: row.requiredMinutes ?? undefined,
      laborRequiredMinutes: undefined,
      rowData: rowData as Prisma.JsonValue
    },
    row.splitQuantity ?? 0
  );
  const splitMinutes = splitFields.machineRequiredMinutes ?? null;
  return {
    itemId,
    sourceRowId: row.id,
    kind: 'split',
    originalResourceCd,
    effectiveResourceCd,
    requiredMinutes: splitMinutes,
    requiredMinutesKnown: splitMinutes != null,
    isCompleted: row.isCompleted
  };
}

function addAggregateMinutes(
  entry: GrindingPlanningBoardLoad,
  field: 'originalRequiredMinutes' | 'alternateRequiredMinutes',
  minutes: number | null
): void {
  if (minutes == null) return;
  entry[field] = (entry[field] ?? 0) + minutes;
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
      addAggregateMinutes(originalEntry, 'originalRequiredMinutes', aggregate.requiredMinutesSum);
      originalEntry.originalUnknownItemCount += unknownItemCount;
    }

    if (effectiveLoadResource != null) {
      const alternateEntry = ensure(effectiveLoadResource);
      alternateEntry.alternateItemCount += itemCount;
      alternateEntry.unfinishedItemCount += itemCount;
      addAggregateMinutes(alternateEntry, 'alternateRequiredMinutes', aggregate.requiredMinutesSum);
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
  splitEnabled: boolean;
  overrideRows: readonly LoadSummaryOverrideRow[];
  category: GrindingPlanningBoardCategory;
  isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => boolean;
}): Promise<GrindingPlanningBoardLoadSummary> {
  const overrideBindings = params.overrideRows.flatMap((row) => {
    const binding = decodeAggregateOverride(row);
    return binding == null ? [] : [binding];
  });
  const overrideJson = JSON.stringify(overrideBindings);
  const splitItems = params.splitEnabled
    ? Prisma.sql`
      UNION ALL
      SELECT
        b."id" AS "sourceRowId",
        b."fseiban",
        b."fhincd",
        b."processOrder",
        b."resourceCd" AS "originalResourceCd",
        s."id"::text AS "splitId",
        s."splitNo",
        'split'::text AS "itemKind",
        CASE
          WHEN b."requiredMinutes" IS NULL
            OR b."plannedQuantity" IS NULL
            OR b."plannedQuantity" <= 0
            OR s."splitQuantity" <= 0
          THEN NULL::double precision
          ELSE GREATEST(
            0::double precision,
            FLOOR(
              b."requiredMinutes" * (
                s."splitQuantity"::double precision
                / b."plannedQuantity"::double precision
              ) + 0.5
            )
          )
        END AS "requiredMinutes",
        s."splitNo" AS "splitOrder"
      FROM "baseRows" AS b
      INNER JOIN "ProductionScheduleOrderSplit" AS s
        ON s."csvDashboardId" = ${params.dashboardId}
        AND s."parentCsvDashboardRowId" = b."id"
    `
    : Prisma.empty;

  const aggregateRows = await params.client.$queryRaw<LoadSummaryAggregateRow[]>(Prisma.sql`
    WITH "baseRows" AS (
      SELECT
        "CsvDashboardRow"."id",
        "CsvDashboardRow"."rowData"->>'FSEIBAN' AS "fseiban",
        "CsvDashboardRow"."rowData"->>'FHINCD' AS "fhincd",
        "CsvDashboardRow"."rowData"->>'FSIGENCD' AS "resourceCd",
        "CsvDashboardRow"."rowData"->>'FKOJUN' AS "processOrder",
        CASE
          WHEN ("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO') ~ '^\\s*-?\\d+(\\.\\d+)?\\s*$'
            AND (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::numeric >= 0
          THEN (("CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO'))::double precision
          ELSE NULL
        END AS "requiredMinutes",
        "supplement"."plannedQuantity"
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
      WHERE ${params.leaderboardMaterializedBaseWhere}
        AND NOT (
          COALESCE("p"."isCompleted", FALSE)
          OR COALESCE("ext"."isExternallyCompleted", FALSE)
        )
    ),
    "items" AS (
      SELECT
        b."id" AS "sourceRowId",
        b."fseiban",
        b."fhincd",
        b."processOrder",
        b."resourceCd" AS "originalResourceCd",
        NULL::text AS "splitId",
        NULL::int AS "splitNo",
        'row'::text AS "itemKind",
        b."requiredMinutes",
        NULL::int AS "splitOrder"
      FROM "baseRows" AS b
      ${params.splitEnabled
        ? Prisma.sql`WHERE NOT EXISTS (
            SELECT 1
            FROM "ProductionScheduleOrderSplit" AS "parentSplit"
            WHERE "parentSplit"."csvDashboardId" = ${params.dashboardId}
              AND "parentSplit"."parentCsvDashboardRowId" = b."id"
          )`
        : Prisma.empty}
      ${splitItems}
    ),
    "deduplicatedItems" AS (
      SELECT *
      FROM (
        SELECT
          "items".*,
          ROW_NUMBER() OVER (
            PARTITION BY
              "items"."itemKind",
              COALESCE("items"."fseiban", ''),
              COALESCE("items"."fhincd", ''),
              COALESCE("items"."processOrder", ''),
              COALESCE("items"."originalResourceCd", ''),
              "items"."splitId",
              "items"."splitNo"
            ORDER BY "items"."sourceRowId", "items"."splitOrder" NULLS FIRST
          ) AS "itemRowNumber"
        FROM "items"
      ) AS "rankedItems"
      WHERE "rankedItems"."itemRowNumber" = 1
    ),
    "overrides" AS (
      SELECT *
      FROM jsonb_to_recordset(${overrideJson}::jsonb) AS "overrideRows"(
        "itemKind" text,
        "fseiban" text,
        "fhincd" text,
        "resourceCd" text,
        "processOrder" text,
        "splitId" text,
        "overrideResourceCd" text
      )
    ),
    "effectiveItems" AS (
      SELECT
        "deduplicatedItems"."sourceRowId",
        "deduplicatedItems"."splitOrder",
        "deduplicatedItems"."originalResourceCd",
        CASE
          WHEN "overrides"."overrideResourceCd" IS NULL
          THEN "deduplicatedItems"."originalResourceCd"
          ELSE "overrides"."overrideResourceCd"
        END AS "effectiveResourceCd",
        "deduplicatedItems"."requiredMinutes"
      FROM "deduplicatedItems"
      LEFT JOIN "overrides"
        ON (
          "deduplicatedItems"."itemKind" = 'row'
          AND "overrides"."itemKind" = 'row'
          AND "overrides"."fseiban" = COALESCE("deduplicatedItems"."fseiban", '')
          AND "overrides"."fhincd" = COALESCE("deduplicatedItems"."fhincd", '')
          AND "overrides"."resourceCd" = COALESCE("deduplicatedItems"."originalResourceCd", '')
          AND "overrides"."processOrder" = COALESCE("deduplicatedItems"."processOrder", '')
        )
        OR (
          "deduplicatedItems"."itemKind" = 'split'
          AND "overrides"."itemKind" = 'split'
          AND "overrides"."splitId" = "deduplicatedItems"."splitId"
        )
    )
    SELECT
      "originalResourceCd",
      "effectiveResourceCd",
      COUNT(*)::bigint AS "itemCount",
      COUNT(*) FILTER (WHERE "requiredMinutes" IS NULL)::bigint AS "unknownItemCount",
      SUM("requiredMinutes" ORDER BY "sourceRowId", "splitOrder" NULLS FIRST)::double precision AS "requiredMinutesSum"
    FROM "effectiveItems"
    GROUP BY "originalResourceCd", "effectiveResourceCd"
  `);

  return buildGrindingPlanningBoardLoadSummaryFromAggregates(aggregateRows, params);
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
  const winnerRowIds = [...new Set((params.winnerRowIds ?? []).map((id) => id.trim()).filter(Boolean))];
  if (params.leaderboardMaterializedBaseWhere === undefined && winnerRowIds.length === 0) {
    return { load: [], unknownRequiredMinutesCount: 0 };
  }
  const dashboardId = params.dashboardId ?? PRODUCTION_SCHEDULE_DASHBOARD_ID;
  if (params.leaderboardMaterializedBaseWhere !== undefined) {
    const overrideRows = await params.client.$queryRaw<LoadSummaryOverrideRow[]>(Prisma.sql`
      SELECT "itemKey", "overrideResourceCd"
      FROM "ProductionScheduleGrindingPlanningBoardOverride"
      WHERE "csvDashboardId" = ${dashboardId}
        AND "siteKey" = ${params.siteKey}
    `);
    return readAggregatedLoadSummary({
      client: params.client,
      dashboardId,
      leaderboardMaterializedBaseWhere: params.leaderboardMaterializedBaseWhere,
      splitEnabled: params.splitEnabled,
      overrideRows,
      category: params.category,
      isResourceInCategory: params.isResourceInCategory
    });
  }
  const splitSelect = params.splitEnabled
    ? Prisma.sql`"split"."id" AS "splitId", "split"."splitQuantity" AS "splitQuantity"`
    : Prisma.sql`NULL::text AS "splitId", NULL::int AS "splitQuantity"`;
  const splitJoin = params.splitEnabled
    ? Prisma.sql`
      LEFT JOIN "ProductionScheduleOrderSplit" AS "split"
        ON "split"."csvDashboardId" = ${dashboardId}
        AND "split"."parentCsvDashboardRowId" = "CsvDashboardRow"."id"
    `
    : Prisma.empty;
  const splitOrder = params.splitEnabled
    ? Prisma.sql`, "split"."splitNo" NULLS FIRST`
    : Prisma.empty;
  const rows: LoadSummarySourceRow[] = [];
  const readSourceRows = async (where: Prisma.Sql, orderBy: Prisma.Sql) => {
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
        (COALESCE("p"."isCompleted", FALSE) OR COALESCE("ext"."isExternallyCompleted", FALSE)) AS "isCompleted",
        "supplement"."plannedQuantity" AS "plannedQuantity",
        ${splitSelect}
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
      ${splitJoin}
      WHERE ${where}
        AND NOT (
          COALESCE("p"."isCompleted", FALSE)
          OR COALESCE("ext"."isExternallyCompleted", FALSE)
        )
      ORDER BY ${orderBy} ${splitOrder}
    `));
  };

  if (params.leaderboardMaterializedBaseWhere !== undefined) {
    await readSourceRows(
      params.leaderboardMaterializedBaseWhere,
      Prisma.sql`"CsvDashboardRow"."id"`
    );
  } else {
    for (const ids of chunk(winnerRowIds, SOURCE_ROW_CHUNK_SIZE)) {
      const idParts = ids.map((id) => Prisma.sql`${id}`);
      await readSourceRows(
        Prisma.sql`
          "CsvDashboardRow"."csvDashboardId" = ${dashboardId}
          AND "CsvDashboardRow"."id"::text = ANY(ARRAY[${Prisma.join(idParts)}]::text[])
        `,
        Prisma.sql`array_position(ARRAY[${Prisma.join(idParts)}]::text[], "CsvDashboardRow"."id"::text)`
      );
    }
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
    return [toSummaryRow(row, overrideByItemKey, params)];
  });
  return buildGrindingPlanningBoardLoadSummary(summaryRows);
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
 * completion resolution, or split-minute calculation; those stay in the
 * existing source pipeline. A split parent is ignored when at least one split
 * item exists for the same source row, which prevents parent/split double count
 * when a SQL summary combines both shapes.
 */
export function buildGrindingPlanningBoardLoadSummary(
  inputRows: readonly GrindingPlanningBoardLoadSummaryRow[]
): GrindingPlanningBoardLoadSummary {
  const splitParents = new Set(
    inputRows
      .filter((row) => row.kind === 'split')
      .map((row) => row.sourceRowId)
  );
  const rows: GrindingPlanningBoardLoadSummaryRow[] = [];
  const seen = new Set<string>();
  for (const row of inputRows) {
    if (row.kind === 'row' && splitParents.has(row.sourceRowId)) continue;
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
