import { Prisma } from '@prisma/client';

import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
} from '../constants.js';
import {
  buildFkojunstProductionScheduleListVisibilityWhereSql,
} from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import {
  buildProductionScheduleCompletionFilterWhereSql,
  type ProductionScheduleCompletionFilter
} from '../production-schedule-effective-completion.sql.js';
import { buildLeaderboardProcessChangeResidualFilterWhereSql } from './leaderboard-process-change-residual.sql.js';
import type { ProcessChangeResidualMode } from './leaderboard-process-change-residual.types.js';
import {
  computeLeaderboardShellFillerBudget
} from './leaderboard-shell-filler-budget.js';
import {
  computeLeaderboardShellPriorityFetchPlan,
  resolveLeaderboardShellSkipExpansionAfterManual,
  trimLeaderboardShellManualProbeRows,
} from './leaderboard-shell-priority-fetch-policy.js';
import { buildLeaderboardShellRankJoinContext } from './leaderboard-shell-rank-join.sql.js';
import { isProductionScheduleOrderSplitEnabled } from '../order-split/production-schedule-order-split-feature.js';
import {
  buildLeaderboardShellFillerOrderBy,
  buildLeaderboardShellManualOrderBy,
} from './leaderboard-shell-row-projection.sql.js';
import { queryLeaderboardShellScheduleRows } from './leaderboard-shell-row-query.sql.js';
import type { LeaderboardScheduleRowSql } from './leaderboard-schedule-row.types.js';

export type { LeaderboardScheduleRowSql } from './leaderboard-schedule-row.types.js';

function readFseibanFromRow(row: LeaderboardScheduleRowSql): string {
  const data = (row.rowData ?? {}) as Record<string, unknown>;
  const raw = data.FSEIBAN;
  return typeof raw === 'string' ? raw.trim() : '';
}

export type LeaderboardShellPriorityContext = {
  commonWhere: Prisma.Sql;
  rankJoins: ReturnType<typeof buildLeaderboardShellRankJoinContext>;
  pSorted: LeaderboardScheduleRowSql[];
};

/** shell 一覧・prefix 補完・hydrate で共有する行スコープ WHERE（winner + query + 可視 + 残骸除外）。 */
export function buildLeaderboardShellListWhereSql(params: {
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  completionFilter?: ProductionScheduleCompletionFilter;
  processChangeResidualMode?: ProcessChangeResidualMode;
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
}): Prisma.Sql {
  const visibilitySql = buildFkojunstProductionScheduleListVisibilityWhereSql();
  const completionSql = buildProductionScheduleCompletionFilterWhereSql(params.completionFilter);
  const residualFilterSql = buildLeaderboardProcessChangeResidualFilterWhereSql(
    params.processChangeResidualMode,
    params.processChangeResidualStrongEvidenceKeys
  );
  return Prisma.sql`${params.leaderboardMaterializedBaseWhere} ${params.queryWhere} ${visibilitySql} ${completionSql} ${residualFilterSql}`;
}

async function buildLeaderboardShellPriorityContext(params: {
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  expansionWhere: Prisma.Sql;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  completionFilter?: ProductionScheduleCompletionFilter;
  /** キオスク順位ボード通常表示のみ `normal`。省略時は `include`（除外なし）。 */
  processChangeResidualMode?: ProcessChangeResidualMode;
  /**
   * `true`（既定）: 手動割当の製番に一致する行を `expansionWhere` 集合から追加（従来の「同一製番展開」）。
   * `false`: 展開しない（`resourceCd` 1件カードなど、カード単位で候補を独立させる）。
   */
  seibanExpansion?: boolean;
  /** shell 初回 prefix のみ。manual LIMIT + expansion スキップに使用 */
  prefixLimit?: number;
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
}): Promise<LeaderboardShellPriorityContext> {
  const {
    leaderboardMaterializedBaseWhere,
    queryWhere,
    expansionWhere,
    locationKey,
    siteScopedGlobalRankLocation,
    completionFilter,
    seibanExpansion = true,
    prefixLimit,
    processChangeResidualMode
  } = params;

  const commonWhere = buildLeaderboardShellListWhereSql({
    leaderboardMaterializedBaseWhere,
    queryWhere,
    completionFilter,
    processChangeResidualMode,
    processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
  });
  const rankJoins = buildLeaderboardShellRankJoinContext({ locationKey, siteScopedGlobalRankLocation });
  const fetchPlan = computeLeaderboardShellPriorityFetchPlan({ prefixLimit });

  const manualLimitSql =
    fetchPlan.manualSqlLimit != null
      ? Prisma.sql`LIMIT ${fetchPlan.manualSqlLimit}`
      : Prisma.empty;

  const manualWhere = Prisma.sql`${commonWhere}
      AND (
        EXISTS (
          SELECT 1
          FROM "ProductionScheduleOrderAssignment" AS "ord_m"
          WHERE "ord_m"."csvDashboardRowId" = "CsvDashboardRow"."id"
            AND "ord_m"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND (
              "ord_m"."location" = ${locationKey}
              OR "ord_m"."siteKey" = ${locationKey}
            )
        )
        ${
          isProductionScheduleOrderSplitEnabled()
            ? Prisma.sql`
        OR EXISTS (
          SELECT 1
          FROM "ProductionScheduleOrderSplitAssignment" AS "sa_m"
          INNER JOIN "ProductionScheduleOrderSplit" AS "s_m"
            ON "s_m"."id" = "sa_m"."splitId"
            AND "s_m"."parentCsvDashboardRowId" = "CsvDashboardRow"."id"
            AND "s_m"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          WHERE "sa_m"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND (
              "sa_m"."location" = ${locationKey}
              OR "sa_m"."siteKey" = ${locationKey}
            )
        )`
            : Prisma.empty
        }
      )`;

  const manualRowsRaw = await queryLeaderboardShellScheduleRows({
    rankJoins,
    whereSql: manualWhere,
    orderBySql: buildLeaderboardShellManualOrderBy(rankJoins),
    limitSql: manualLimitSql
  });

  const skipExpansion = resolveLeaderboardShellSkipExpansionAfterManual({
    prefixLimit,
    manualRowCount: manualRowsRaw.length
  });

  const manualRows = trimLeaderboardShellManualProbeRows({
    prefixLimit,
    rows: manualRowsRaw
  });

  const seibanSet = new Set<string>();
  for (const row of manualRows) {
    const fs = readFseibanFromRow(row);
    if (fs.length > 0) seibanSet.add(fs);
  }

  const idToRow = new Map<string, LeaderboardScheduleRowSql>();
  for (const r of manualRows) {
    idToRow.set(r.id, r);
  }

  if (seibanExpansion && !skipExpansion && seibanSet.size > 0) {
    const seibanList = Array.from(seibanSet);
    const seibanCondition = Prisma.sql`NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') IN (${Prisma.join(
      seibanList.map((s) => Prisma.sql`${s}`)
    )})`;

    const expansionWhereSql = Prisma.sql`${buildLeaderboardShellListWhereSql({
      leaderboardMaterializedBaseWhere,
      queryWhere: expansionWhere,
      completionFilter,
      processChangeResidualMode,
      processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
    })}
        AND ${seibanCondition}`;

    const expansionRows = await queryLeaderboardShellScheduleRows({
      rankJoins,
      whereSql: expansionWhereSql,
      orderBySql: buildLeaderboardShellFillerOrderBy()
    });

    for (const r of expansionRows) {
      if (!idToRow.has(r.id)) {
        idToRow.set(r.id, r);
      }
    }
  }

  const pSorted = sortLeaderboardFetchRows(Array.from(idToRow.values()));
  return { commonWhere, rankJoins, pSorted };
}

async function queryLeaderboardShellFillerRows(params: {
  commonWhere: Prisma.Sql;
  rankJoins: ReturnType<typeof buildLeaderboardShellRankJoinContext>;
  pSorted: LeaderboardScheduleRowSql[];
  takeLimit?: number;
  /** priority 集合外で SQL から除く id（返却済み行・既取得フィラーなど） */
  additionalExcludeIds?: readonly string[];
}): Promise<LeaderboardScheduleRowSql[]> {
  const { commonWhere, rankJoins, pSorted, takeLimit, additionalExcludeIds } = params;

  const priorityIdParts = pSorted.map((r) => Prisma.sql`${r.id}`);
  const priorityExcludeSql =
    priorityIdParts.length > 0
      ? Prisma.sql`AND NOT ("CsvDashboardRow"."id" IN (${Prisma.join(priorityIdParts)}))`
      : Prisma.empty;

  const extraIds = Array.from(
    new Set(
      (additionalExcludeIds ?? [])
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
    )
  );
  const additionalExcludeSql =
    extraIds.length > 0
      ? Prisma.sql`AND NOT ("CsvDashboardRow"."id" IN (${Prisma.join(extraIds.map((id) => Prisma.sql`${id}`))}))`
      : Prisma.empty;

  const takeLimitSql =
    takeLimit != null ? Prisma.sql`LIMIT ${Math.max(1, Math.floor(takeLimit))}` : Prisma.empty;

  const fillerWhere = Prisma.sql`${commonWhere}
      ${priorityExcludeSql}
      ${additionalExcludeSql}`;

  return queryLeaderboardShellScheduleRows({
    rankJoins,
    whereSql: fillerWhere,
    orderBySql: buildLeaderboardShellFillerOrderBy(),
    limitSql: takeLimitSql
  });
}

/**
 * priority（手動+製番展開）とフィラーを {@link compareLeaderboardFetchedRows} で終端までマージする。
 */
function mergeLeaderboardShellPriorityAndFillerFully(
  pSorted: LeaderboardScheduleRowSql[],
  fillerRows: LeaderboardScheduleRowSql[]
): LeaderboardScheduleRowSql[] {
  let pIdx = 0;
  let fIdx = 0;
  const out: LeaderboardScheduleRowSql[] = [];

  while (pIdx < pSorted.length || fIdx < fillerRows.length) {
    const nextP = pIdx < pSorted.length ? pSorted[pIdx]! : null;
    const nextF = fIdx < fillerRows.length ? fillerRows[fIdx]! : null;
    if (nextP == null && nextF == null) break;

    let pick: LeaderboardScheduleRowSql;
    if (nextP == null) {
      pick = nextF!;
      fIdx++;
    } else if (nextF == null) {
      pick = nextP;
      pIdx++;
    } else if (compareLeaderboardFetchedRows(nextP, nextF) <= 0) {
      pick = nextP;
      pIdx++;
    } else {
      pick = nextF;
      fIdx++;
    }
    out.push(pick);
  }

  return out;
}

/**
 * priority（手動+製番展開）とフィラーを {@link compareLeaderboardFetchedRows} でマージし、
 * 先頭 `prefixLimit` 件（またはストリーム枯渇まで）を返す。
 *
 * @internal 単体テストで full merge の prefix 一致を検証するため export。
 */
export function mergeLeaderboardShellPriorityAndFillerUpTo(
  pSorted: LeaderboardScheduleRowSql[],
  fillerRows: LeaderboardScheduleRowSql[],
  prefixLimit: number
): { rows: LeaderboardScheduleRowSql[]; mergeFullyCompleted: boolean } {
  const limit = Math.max(0, Math.floor(prefixLimit));
  let pIdx = 0;
  let fIdx = 0;
  const out: LeaderboardScheduleRowSql[] = [];

  while (pIdx < pSorted.length || fIdx < fillerRows.length) {
    if (out.length >= limit) {
      const exhausted = pIdx >= pSorted.length && fIdx >= fillerRows.length;
      return { rows: out, mergeFullyCompleted: exhausted };
    }

    const nextP = pIdx < pSorted.length ? pSorted[pIdx]! : null;
    const nextF = fIdx < fillerRows.length ? fillerRows[fIdx]! : null;
    if (nextP == null && nextF == null) break;

    let pick: LeaderboardScheduleRowSql;
    if (nextP == null) {
      pick = nextF!;
      fIdx++;
    } else if (nextF == null) {
      pick = nextP;
      pIdx++;
    } else if (compareLeaderboardFetchedRows(nextP, nextF) <= 0) {
      pick = nextP;
      pIdx++;
    } else {
      pick = nextF;
      fIdx++;
    }
    out.push(pick);
  }

  return { rows: out, mergeFullyCompleted: true };
}

/**
 * 順位ボード shell 初回: 先頭 N 件だけグローバル順の正しい prefix として返す（全件マージ完了は保証しない）。
 */
export async function fetchLeaderboardShellMergedPrefixRows(params: {
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  expansionWhere: Prisma.Sql;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  seibanExpansion?: boolean;
  prefixLimit: number;
  completionFilter?: ProductionScheduleCompletionFilter;
  processChangeResidualMode?: ProcessChangeResidualMode;
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
}): Promise<{ mergedPrefix: LeaderboardScheduleRowSql[]; mergeFullyCompleted: boolean }> {
  const limit = Math.max(1, Math.floor(params.prefixLimit));
  const ctx = await buildLeaderboardShellPriorityContext({
    ...params,
    prefixLimit: limit
  });

  if (ctx.pSorted.length >= limit) {
    if (ctx.pSorted.length > limit) {
      return {
        mergedPrefix: ctx.pSorted.slice(0, limit),
        mergeFullyCompleted: false
      };
    }

    const fillerProbe = await queryLeaderboardShellFillerRows({
      commonWhere: ctx.commonWhere,
      rankJoins: ctx.rankJoins,
      pSorted: ctx.pSorted,
      takeLimit: 1
    });
    return {
      mergedPrefix: ctx.pSorted.slice(0, limit),
      mergeFullyCompleted: fillerProbe.length === 0
    };
  }

  const { rows, mergeFullyCompleted } = await takeLeaderboardShellMergedRowsAfterExclude({
    commonWhere: ctx.commonWhere,
    rankJoins: ctx.rankJoins,
    pSorted: ctx.pSorted,
    excludeRowIds: new Set(),
    takeCount: limit
  });
  return { mergedPrefix: rows, mergeFullyCompleted };
}

/**
 * shell 初回で並びを固定するため、モノリシック順位ボードと同一のマージ結果を全件返す。
 * （フィラーは単一クエリで全件。段階取得の hot path では使わない）
 */
export async function fetchFullLeaderboardShellMergedOrderedRows(params: {
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  expansionWhere: Prisma.Sql;
  completionFilter?: ProductionScheduleCompletionFilter;
  processChangeResidualMode?: ProcessChangeResidualMode;
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  seibanExpansion?: boolean;
}): Promise<LeaderboardScheduleRowSql[]> {
  const ctx = await buildLeaderboardShellPriorityContext(params);
  const fillerRows = await queryLeaderboardShellFillerRows({
    commonWhere: ctx.commonWhere,
    rankJoins: ctx.rankJoins,
    pSorted: ctx.pSorted
  });
  return mergeLeaderboardShellPriorityAndFillerFully(ctx.pSorted, fillerRows);
}

/**
 * 手動+製番展開を除くフィラー候補をバッチで読み、priority と {@link compareLeaderboardFetchedRows} でマージした
 * グローバル順序で exclude を飛ばし takeCount 件を返す（段階取得の続きき用）。
 * 1 呼び出しあたりのフィラー読み込み行数に上限があり、上限到達時は mergeFullyCompleted=false になる。
 */
export async function takeLeaderboardShellMergedRowsAfterExclude(params: {
  commonWhere: Prisma.Sql;
  rankJoins: ReturnType<typeof buildLeaderboardShellRankJoinContext>;
  pSorted: LeaderboardScheduleRowSql[];
  excludeRowIds: ReadonlySet<string>;
  takeCount: number;
}): Promise<{ rows: LeaderboardScheduleRowSql[]; mergeFullyCompleted: boolean }> {
  const { commonWhere, rankJoins, pSorted, excludeRowIds, takeCount } = params;
  const nTake = Math.max(0, Math.floor(takeCount));
  if (nTake === 0) return { rows: [], mergeFullyCompleted: true };

  const pSortedIds = new Set(pSorted.map((r) => r.id));
  const fillerChunks: LeaderboardScheduleRowSql[] = [];
  const fillerIdsEverLoaded = new Set<string>();

  const { maxFillerTotal, batchTakeSoftCap } = computeLeaderboardShellFillerBudget({
    takeCount: nTake,
    excludeRowIdCount: excludeRowIds.size
  });
  let totalFillerLoaded = 0;
  let hitFillerCap = false;
  let lastFillerBatchSize = 0;
  let lastRequestedFillerTake = 0;
  let fillerFetchExhausted = false;

  const loadNextFillerBatch = async (): Promise<void> => {
    if (fillerFetchExhausted) {
      lastFillerBatchSize = 0;
      return;
    }
    if (totalFillerLoaded >= maxFillerTotal) {
      hitFillerCap = true;
      lastFillerBatchSize = 0;
      fillerFetchExhausted = true;
      return;
    }
    const batchTake = Math.min(batchTakeSoftCap, maxFillerTotal - totalFillerLoaded);
    lastRequestedFillerTake = batchTake;
    const excludeForSql: string[] = [];
    for (const id of excludeRowIds) {
      const t = id.trim();
      if (!t || pSortedIds.has(t)) continue;
      excludeForSql.push(t);
    }
    for (const id of fillerIdsEverLoaded) {
      excludeForSql.push(id);
    }

    const batch = await queryLeaderboardShellFillerRows({
      commonWhere,
      rankJoins,
      pSorted,
      takeLimit: batchTake,
      additionalExcludeIds: excludeForSql.length > 0 ? excludeForSql : undefined
    });

    lastFillerBatchSize = batch.length;
    if (batch.length === 0) {
      fillerFetchExhausted = true;
    }
    for (const r of batch) {
      fillerIdsEverLoaded.add(r.id);
    }
    totalFillerLoaded += batch.length;
    fillerChunks.push(...batch);
  };

  let pIdx = 0;
  let fIdx = 0;
  const out: LeaderboardScheduleRowSql[] = [];

  const skipExcludedP = () => {
    while (pIdx < pSorted.length && excludeRowIds.has(pSorted[pIdx]!.id)) {
      pIdx++;
    }
  };
  const skipExcludedF = () => {
    while (fIdx < fillerChunks.length && excludeRowIds.has(fillerChunks[fIdx]!.id)) {
      fIdx++;
    }
  };

  const ensureFillerHead = async () => {
    while (fIdx >= fillerChunks.length) {
      const before = fillerChunks.length;
      await loadNextFillerBatch();
      if (fillerChunks.length === before) return;
    }
  };

  skipExcludedP();
  skipExcludedF();

  while (out.length < nTake) {
    await ensureFillerHead();

    const nextP = pIdx < pSorted.length ? pSorted[pIdx]! : null;
    const nextF = fIdx < fillerChunks.length ? fillerChunks[fIdx]! : null;

    if (nextP == null && nextF == null) break;

    let pick: LeaderboardScheduleRowSql;
    if (nextP == null) {
      pick = nextF!;
      fIdx++;
    } else if (nextF == null) {
      pick = nextP;
      pIdx++;
    } else if (compareLeaderboardFetchedRows(nextP, nextF) <= 0) {
      pick = nextP;
      pIdx++;
    } else {
      pick = nextF;
      fIdx++;
    }

    if (!excludeRowIds.has(pick.id)) {
      out.push(pick);
    }
    skipExcludedP();
    skipExcludedF();
  }

  const hasMorePriorityNotExcluded = (): boolean => {
    let i = pIdx;
    while (i < pSorted.length) {
      if (!excludeRowIds.has(pSorted[i]!.id)) return true;
      i++;
    }
    return false;
  };

  const hasMoreFillerNotExcluded = (): boolean => {
    let j = fIdx;
    while (j < fillerChunks.length) {
      if (!excludeRowIds.has(fillerChunks[j]!.id)) return true;
      j++;
    }
    return false;
  };

  const exhaustedDbFiller =
    lastFillerBatchSize === 0 ||
    (lastFillerBatchSize < lastRequestedFillerTake && !hasMoreFillerNotExcluded());

  const mergeFullyCompleted =
    !hitFillerCap && !hasMorePriorityNotExcluded() && !hasMoreFillerNotExcluded() && exhaustedDbFiller;

  return { rows: out, mergeFullyCompleted };
}

/**
 * `leaderboard-shell` 続き取得: 既に返却済み id を除外し chunkSize 件を返す。
 */
export async function fetchLeaderboardShellRowsContinuationChunk(params: {
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  expansionWhere: Prisma.Sql;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  excludeRowIds: readonly string[];
  chunkSize: number;
  completionFilter?: ProductionScheduleCompletionFilter;
  seibanExpansion?: boolean;
  processChangeResidualMode?: ProcessChangeResidualMode;
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
}): Promise<{ rows: LeaderboardScheduleRowSql[]; mergeFullyCompleted: boolean }> {
  const ctx = await buildLeaderboardShellPriorityContext(params);
  const exclude = new Set(params.excludeRowIds.map((id) => id.trim()).filter((id) => id.length > 0));
  return takeLeaderboardShellMergedRowsAfterExclude({
    commonWhere: ctx.commonWhere,
    rankJoins: ctx.rankJoins,
    pSorted: ctx.pSorted,
    excludeRowIds: exclude,
    takeCount: params.chunkSize
  });
}

/**
 * 順位ボード: 手動割当つき行を必ず含め、同一製番はまとめて取得し、
 * 残り枠を納期（表示納期に近い COALESCE）昇順で補完する。
 *
 * - `pageSize` を超えるよう手動+製番展開が膨らんだ場合でも、手動側は切り捨てない。
 * - `pageSize` 未満のときはフィラーとマージしたグローバル順で先頭 `pageSize` 件を返す。
 */
export async function fetchLeaderboardScheduleRowsWithSeibanAwarePriority(params: {
  leaderboardMaterializedBaseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  expansionWhere: Prisma.Sql;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  pageSize: number;
  completionFilter?: ProductionScheduleCompletionFilter;
  seibanExpansion?: boolean;
  processChangeResidualMode?: ProcessChangeResidualMode;
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
}): Promise<LeaderboardScheduleRowSql[]> {
  const pageSize = Math.max(1, params.pageSize);

  const { commonWhere, rankJoins, pSorted } = await buildLeaderboardShellPriorityContext(params);

  if (pSorted.length >= pageSize) {
    return pSorted;
  }

  const { rows } = await takeLeaderboardShellMergedRowsAfterExclude({
    commonWhere,
    rankJoins,
    pSorted,
    excludeRowIds: new Set(),
    takeCount: pageSize
  });
  return rows;
}

/** @internal exported for tests */
export function compareLeaderboardFetchedRows(
  a: LeaderboardScheduleRowSql,
  b: LeaderboardScheduleRowSql
): number {
  const aMan = a.processingOrder != null;
  const bMan = b.processingOrder != null;
  if (aMan !== bMan) return aMan ? -1 : 1;
  if (aMan && bMan && a.processingOrder !== b.processingOrder) {
    return (a.processingOrder ?? 0) - (b.processingOrder ?? 0);
  }
  const aDue = dueTime(a);
  const bDue = dueTime(b);
  if (aDue !== bDue) {
    if (aDue == null) return 1;
    if (bDue == null) return -1;
    return aDue - bDue;
  }
  const af = readFseibanFromRow(a);
  const bf = readFseibanFromRow(b);
  const c = af.localeCompare(bf, 'ja');
  if (c !== 0) return c;
  const ad = (a.rowData ?? {}) as Record<string, unknown>;
  const bd = (b.rowData ?? {}) as Record<string, unknown>;
  const ap = typeof ad.ProductNo === 'string' ? ad.ProductNo : '';
  const bp = typeof bd.ProductNo === 'string' ? bd.ProductNo : '';
  const pc = ap.localeCompare(bp, 'ja');
  if (pc !== 0) return pc;
  const afkojun = numericFkojun(ad.FKOJUN);
  const bfkojun = numericFkojun(bd.FKOJUN);
  if (afkojun !== bfkojun) {
    if (afkojun == null) return 1;
    if (bfkojun == null) return -1;
    return afkojun - bfkojun;
  }
  const ah = typeof ad.FHINCD === 'string' ? ad.FHINCD : '';
  const bh = typeof bd.FHINCD === 'string' ? bd.FHINCD : '';
  const hc = ah.localeCompare(bh, 'ja');
  if (hc !== 0) return hc;
  return a.id.localeCompare(b.id);
}

function dueTime(row: LeaderboardScheduleRowSql): number | null {
  const d = row.dueDate;
  if (d) return new Date(d).getTime();
  const e = row.plannedEndDate;
  if (e) return new Date(e).getTime();
  return null;
}

function numericFkojun(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  return Number(value);
}

function sortLeaderboardFetchRows(rows: LeaderboardScheduleRowSql[]): LeaderboardScheduleRowSql[] {
  return [...rows].sort(compareLeaderboardFetchedRows);
}
