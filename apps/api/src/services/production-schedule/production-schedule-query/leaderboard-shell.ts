import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
} from '../constants.js';
import {
  buildProductionScheduleDashboardBaseWhereWithCorrelatedMaxProductNoWinner,
  resolveLeaderboardMaterializedBaseWhere,
} from '../row-resolver/index.js';
import {
  buildLeaderboardShellListWhereSql,
  fetchLeaderboardShellMergedPrefixRows,
  fetchLeaderboardShellRowsContinuationChunk
} from '../leaderboard/leaderboard-row-selection.service.js';
import { buildLeaderboardShellFilterFingerprint } from '../leaderboard/leaderboard-shell-snapshot-fingerprint.js';
import { resolveLeaderboardShellSnapshotGenerationToken } from '../leaderboard/leaderboard-shell-snapshot-generation.js';
import type { LeaderboardShellSnapshotStore } from '../leaderboard/leaderboard-shell-snapshot.store.js';
import {
  isLeaderboardShellSnapshotStaleForContinue,
  sliceLeaderboardSnapshotIdsByCursor,
  sliceLeaderboardSnapshotIdsByExcludePrefix
} from '../leaderboard/leaderboard-shell-continue.slice.js';
import { resolveLeaderboardShellDisplayItemPrefix } from '../leaderboard/leaderboard-shell-display-item-prefix.service.js';
import {
  expandLeaderboardParentRowIdsForSnapshot,
  expandLeaderboardParentRowsForResponse,
  fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds,
  fetchPartiallyReturnedDisplayItemsForLegacyContinue,
  resolveFullyExcludedParentRowIdsForLegacyContinue,
  resolvePartiallyReturnedParentRowIdsForLegacyContinue,
  resolveParentRowIdsExcludedFromLeaderboardContinuation
} from '../leaderboard/leaderboard-split-expansion.service.js';
import { isProductionScheduleOrderSplitEnabled } from '../order-split/production-schedule-order-split-feature.js';
import {
  filterProductionScheduleDisplayRowsByDueDate,
  sortExpandedProductionScheduleRowsByManualOrder
} from '../order-split/production-schedule-order-split.service.js';
import {
  countProductionScheduleDashboardVisibleLeaderboardUnits,
} from '../production-schedule-list-count.service.js';
import { prepareProductionScheduleDashboardFilters } from './filters.js';
import type { ProductionScheduleListParams, ProductionScheduleListResult, ProductionScheduleRow } from './types.js';

/** 順位ボード phased read（shell / continue）の共通レスポンス形（snapshotId は shell・正常 continue で付与） */
export type LeaderboardShellPhasedReadResult = Pick<ProductionScheduleListResult, 'page' | 'pageSize' | 'rows'> & {
  snapshotId?: string;
  snapshotExpired?: boolean;
  /** 次の continue で送る cursor（既に返した行数）。shell・snapshot continue で付与。 */
  nextCursor?: number;
  /** さらに続きがあるか（snapshot 経路で確実。無 snapshot フォールバックでは省略可） */
  hasMore?: boolean;
};

/**
 * `resourceCds` がちょうど 1 件のときはカード単位選定とみなし、同一製番の他資源への展開を行わない。
 * 0 件・2 件以上は従来どおり展開あり（後方互換）。
 */
export function shouldExpandLeaderboardSeibanAcrossResources(resourceCds: readonly string[]): boolean {
  return resourceCds.length !== 1;
}

/** 順位ボード段階取得: COUNT・装飾なしの leaderboard 選定のみ（初回は先頭 page 件の並びを確定し snapshot を発行。全件マージは遅延可） */
export async function listLeaderboardShellProductionScheduleRows(
  params: ProductionScheduleListParams,
  options: {
    snapshotStore: LeaderboardShellSnapshotStore;
    /** 集約 shell 等で同一 HTTP リクエスト内 1 回 resolve した値を渡す */
    leaderboardMaterializedBaseWhere?: Prisma.Sql;
    /** 単一資源 shell で資源 filter を先に効かせる winner 判定。 */
    leaderboardWinnerBaseStrategy?: 'materialized' | 'correlated';
    /** 集約 board shell/continue 等で同一 HTTP リクエスト内 1 回読んだ世代トークンを渡す */
    generationToken?: string;
  }
): Promise<LeaderboardShellPhasedReadResult> {
  const { page, pageSize, locationKey } = params;

  const filters = await prepareProductionScheduleDashboardFilters({
    queryText: params.queryText,
    productNos: params.productNos,
    machineName: params.machineName,
    resourceCds: params.resourceCds,
    assignedOnlyCds: params.assignedOnlyCds,
    resourceCategory: params.resourceCategory,
    hasNoteOnly: params.hasNoteOnly,
    hasDueDateOnly: params.hasDueDateOnly,
    allowResourceOnly: params.allowResourceOnly ?? false,
    locationKey,
    siteKey: params.siteKey
  });

  if (filters.kind === 'blocked_empty_search') {
    return { page, pageSize, rows: [] };
  }

  const { queryWhere, leaderboardExpansionWhere, siteScopedGlobalRankLocation } = filters;

  const useCorrelatedWinnerBase =
    options.leaderboardWinnerBaseStrategy === 'correlated' && params.resourceCds.length === 1;
  const leaderboardMaterializedBaseWhere = useCorrelatedWinnerBase
    ? buildProductionScheduleDashboardBaseWhereWithCorrelatedMaxProductNoWinner(PRODUCTION_SCHEDULE_DASHBOARD_ID)
    : await resolveLeaderboardMaterializedBaseWhere(prisma, options.leaderboardMaterializedBaseWhere);

  const seibanExpansion = shouldExpandLeaderboardSeibanAcrossResources(params.resourceCds);

  const leaderboardShellListWhere = buildLeaderboardShellListWhereSql({
    leaderboardMaterializedBaseWhere,
    queryWhere,
    completionFilter: params.completionFilter,
    processChangeResidualMode: params.processChangeResidualMode,
    processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
  });

  const { mergedPrefix: mergedPrefixInitial, mergeFullyCompleted } = await fetchLeaderboardShellMergedPrefixRows({
    leaderboardMaterializedBaseWhere,
    queryWhere,
    expansionWhere: leaderboardExpansionWhere,
    locationKey,
    siteScopedGlobalRankLocation,
    seibanExpansion,
    prefixLimit: pageSize,
    completionFilter: params.completionFilter,
    processChangeResidualMode: params.processChangeResidualMode,
    processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
  });

  const { expandedDisplayItems: expandedDisplayItemsRaw } = await resolveLeaderboardShellDisplayItemPrefix({
    mergedPrefixInitial,
    mergeFullyCompletedInitial: mergeFullyCompleted,
    pageSize,
    locationKey,
    siteScopedGlobalRankLocation,
    leaderboardMaterializedBaseWhere,
    leaderboardShellListWhere
  });
  const expandedDisplayItems = filterProductionScheduleDisplayRowsByDueDate(
    expandedDisplayItemsRaw,
    params.hasDueDateOnly
  );

  const orderedRowIds = expandedDisplayItems.map((row) => row.id);
  const generationToken = await resolveLeaderboardShellSnapshotGenerationToken(options.generationToken);

  const filterFingerprint = buildLeaderboardShellFilterFingerprint({
    locationKey,
    siteKey: params.siteKey,
    queryText: params.queryText,
    productNos: params.productNos,
    machineName: params.machineName,
    resourceCds: params.resourceCds,
    assignedOnlyCds: params.assignedOnlyCds,
    resourceCategory: params.resourceCategory,
    hasNoteOnly: params.hasNoteOnly,
    hasDueDateOnly: params.hasDueDateOnly,
    allowResourceOnly: params.allowResourceOnly ?? false,
    completionFilter: params.completionFilter
  });

  const snapshotId = options.snapshotStore.create({
    orderedRowIds,
    partialOrdering: !mergeFullyCompleted,
    filterFingerprint,
    generationToken,
    locationKey,
    siteKey: params.siteKey
  });

  const rows = expandedDisplayItems.slice(0, pageSize);
  const nextCursor = rows.length;
  const hasMore = nextCursor < expandedDisplayItems.length || !mergeFullyCompleted;

  return { page, pageSize, rows, snapshotId, nextCursor, hasMore };
}

/** 順位ボード段階取得: shell の続き（snapshot がある場合は再計算せずスライス＋hydrate） */
export async function listLeaderboardShellContinuationProductionScheduleRows(
  params: Omit<ProductionScheduleListParams, 'page' | 'pageSize'> & {
    page?: number;
    excludeRowIds?: readonly string[];
    cursor?: number;
    chunkSize: number;
    snapshotId?: string;
  },
  options: {
    snapshotStore: LeaderboardShellSnapshotStore;
    generationToken?: string;
    /** 集約 board continue 等で同一 HTTP リクエスト内 1 回 resolve した値を渡す */
    leaderboardMaterializedBaseWhere?: Prisma.Sql;
  }
): Promise<LeaderboardShellPhasedReadResult> {
  const page = params.page ?? 1;
  const { locationKey } = params;
  const excludeRowIds = params.excludeRowIds ?? [];
  const appliedChunk = Math.min(160, Math.max(1, Math.floor(params.chunkSize)));

  const filters = await prepareProductionScheduleDashboardFilters({
    queryText: params.queryText,
    productNos: params.productNos,
    machineName: params.machineName,
    resourceCds: params.resourceCds,
    assignedOnlyCds: params.assignedOnlyCds,
    resourceCategory: params.resourceCategory,
    hasNoteOnly: params.hasNoteOnly,
    hasDueDateOnly: params.hasDueDateOnly,
    allowResourceOnly: params.allowResourceOnly ?? false,
    locationKey,
    siteKey: params.siteKey
  });

  if (filters.kind === 'blocked_empty_search') {
    return { page, pageSize: appliedChunk, rows: [] };
  }

  const filterFingerprint = buildLeaderboardShellFilterFingerprint({
    locationKey,
    siteKey: params.siteKey,
    queryText: params.queryText,
    productNos: params.productNos,
    machineName: params.machineName,
    resourceCds: params.resourceCds,
    assignedOnlyCds: params.assignedOnlyCds,
    resourceCategory: params.resourceCategory,
    hasNoteOnly: params.hasNoteOnly,
    hasDueDateOnly: params.hasDueDateOnly,
    allowResourceOnly: params.allowResourceOnly ?? false,
    completionFilter: params.completionFilter
  });

  const snapshotId = params.snapshotId?.trim();

  if (snapshotId && snapshotId.length > 0) {
    return options.snapshotStore.withContinueLock(snapshotId, async () => {
      const snap = options.snapshotStore.get(snapshotId);
      if (!snap) {
        return { page, pageSize: appliedChunk, rows: [], snapshotExpired: true };
      }

      const stale = isLeaderboardShellSnapshotStaleForContinue({
        snap,
        filterFingerprint,
        locationKey,
        siteKey: params.siteKey,
        currentGenerationToken: await resolveLeaderboardShellSnapshotGenerationToken(options.generationToken)
      });
      if (stale === 'generation') {
        options.snapshotStore.delete(snapshotId);
      }
      if (stale != null) {
        return { page, pageSize: appliedChunk, rows: [], snapshotExpired: true };
      }

      const { siteScopedGlobalRankLocation, queryWhere, leaderboardExpansionWhere } = filters;
      const leaderboardMaterializedBaseWhere =
        options.leaderboardMaterializedBaseWhere ?? (await resolveLeaderboardMaterializedBaseWhere(prisma));
      const seibanExpansion = shouldExpandLeaderboardSeibanAcrossResources(params.resourceCds);

      const materializeNextSnapshotChunk = async () => {
        const live = options.snapshotStore.get(snapshotId);
        if (!live?.partialOrdering) return;
        const excludeParentRowIds = await resolveParentRowIdsExcludedFromLeaderboardContinuation(
          live.orderedRowIds
        );
        const { rows: chunkRows, mergeFullyCompleted } = await fetchLeaderboardShellRowsContinuationChunk({
          leaderboardMaterializedBaseWhere,
          queryWhere,
          expansionWhere: leaderboardExpansionWhere,
          locationKey,
          siteScopedGlobalRankLocation,
          excludeRowIds: excludeParentRowIds,
          chunkSize: appliedChunk,
          seibanExpansion,
          completionFilter: params.completionFilter,
          processChangeResidualMode: params.processChangeResidualMode,
          processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
        });
        const appendedDisplayIds = await expandLeaderboardParentRowIdsForSnapshot({
          parentRows: chunkRows.map((r): ProductionScheduleRow => ({
            ...r,
            actualPerPieceMinutes: null,
            customerName: null
          })),
          locationKey,
          hasDueDateOnly: params.hasDueDateOnly
        });
        options.snapshotStore.appendSnapshotOrderingChunk(snapshotId, appendedDisplayIds, mergeFullyCompleted);
      };

      const useCursor = params.cursor !== undefined;
      let resolved:
        | { sliceIds: readonly string[]; nextCursor: number; hasMore: boolean }
        | undefined;

      let liveSnap = options.snapshotStore.get(snapshotId);
      if (!liveSnap) {
        return { page, pageSize: appliedChunk, rows: [], snapshotExpired: true };
      }

      /** snapshot がカーソル先をまだマテリアライズしていないときの上限（暴走防止） */
      const MAX_SNAPSHOT_MATERIALIZE_ROUNDS = 40;
      for (let round = 0; round < MAX_SNAPSHOT_MATERIALIZE_ROUNDS; round++) {
        if (useCursor) {
          const sliced = sliceLeaderboardSnapshotIdsByCursor(
            liveSnap.orderedRowIds,
            params.cursor!,
            appliedChunk
          );
          if (sliced.kind === 'cursor_overflow') {
            return { page, pageSize: appliedChunk, rows: [], snapshotExpired: true };
          }
          if (sliced.sliceIds.length > 0 || !liveSnap.partialOrdering) {
            resolved = {
              sliceIds: sliced.sliceIds,
              nextCursor: sliced.nextCursor,
              hasMore: sliced.hasMore
            };
            break;
          }
          await materializeNextSnapshotChunk();
        } else {
          const sliced = sliceLeaderboardSnapshotIdsByExcludePrefix(
            liveSnap.orderedRowIds,
            excludeRowIds,
            appliedChunk
          );
          if (sliced.kind === 'expired') {
            return { page, pageSize: appliedChunk, rows: [], snapshotExpired: true };
          }
          if (sliced.sliceIds.length > 0 || !liveSnap.partialOrdering) {
            resolved = {
              sliceIds: sliced.sliceIds,
              nextCursor: sliced.nextCursor,
              hasMore: sliced.hasMore
            };
            break;
          }
          await materializeNextSnapshotChunk();
        }

        const refreshed = options.snapshotStore.get(snapshotId);
        if (!refreshed) {
          return { page, pageSize: appliedChunk, rows: [], snapshotExpired: true };
        }
        liveSnap = refreshed;
      }

      if (resolved == null) {
        return { page, pageSize: appliedChunk, rows: [], snapshotExpired: true };
      }

      const { sliceIds, nextCursor } = resolved;
      let { hasMore } = resolved;

      const snapForHasMore = options.snapshotStore.get(snapshotId);
      if (snapForHasMore && sliceIds.length > 0) {
        hasMore =
          nextCursor < snapForHasMore.orderedRowIds.length || snapForHasMore.partialOrdering;
      }

      if (sliceIds.length === 0) {
        return { page, pageSize: appliedChunk, rows: [], snapshotId, nextCursor, hasMore };
      }

      const leaderboardRows = await fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds({
        orderedDisplayItemIds: sliceIds,
        locationKey,
        siteScopedGlobalRankLocation,
        leaderboardMaterializedBaseWhere
      });

      const rows: ProductionScheduleRow[] = leaderboardRows.map((r) => ({
        ...r,
        actualPerPieceMinutes: null,
        customerName: null
      }));

      return { page, pageSize: appliedChunk, rows, snapshotId, nextCursor, hasMore };
    });
  }

  if (excludeRowIds.length === 0) {
    return { page, pageSize: appliedChunk, rows: [] };
  }

  const { queryWhere, leaderboardExpansionWhere, siteScopedGlobalRankLocation } = filters;
  const leaderboardMaterializedBaseWhere =
    options.leaderboardMaterializedBaseWhere ?? (await resolveLeaderboardMaterializedBaseWhere(prisma));

  const seibanExpansion = shouldExpandLeaderboardSeibanAcrossResources(params.resourceCds);

  const excludeDisplayItemIds = excludeRowIds;
  const excludeDisplayItemIdSet = new Set(
    excludeDisplayItemIds.map((id) => id.trim()).filter((id) => id.length > 0)
  );

  const fullyExcludedParentRowIds = await resolveFullyExcludedParentRowIdsForLegacyContinue({
    excludeDisplayItemIds,
    locationKey
  });

  const partialRowsRaw = await fetchPartiallyReturnedDisplayItemsForLegacyContinue({
    excludeDisplayItemIds,
    locationKey,
    siteScopedGlobalRankLocation,
    leaderboardMaterializedBaseWhere
  });
  const partialRows = filterProductionScheduleDisplayRowsByDueDate(partialRowsRaw, params.hasDueDateOnly);

  const partiallyExcludedParentRowIds = await resolvePartiallyReturnedParentRowIdsForLegacyContinue({
    excludeDisplayItemIds,
    locationKey
  });

  const leaderboardResult = await fetchLeaderboardShellRowsContinuationChunk({
    leaderboardMaterializedBaseWhere,
    queryWhere,
    expansionWhere: leaderboardExpansionWhere,
    locationKey,
    siteScopedGlobalRankLocation,
    excludeRowIds: [...fullyExcludedParentRowIds, ...partiallyExcludedParentRowIds],
    chunkSize: appliedChunk,
    seibanExpansion,
    completionFilter: params.completionFilter,
    processChangeResidualMode: params.processChangeResidualMode,
    processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
  });

  const newExpandedRows: ProductionScheduleRow[] = await expandLeaderboardParentRowsForResponse({
    rows: leaderboardResult.rows.map((r) => ({
      ...r,
      actualPerPieceMinutes: null,
      customerName: null
    })),
    locationKey,
    hasDueDateOnly: params.hasDueDateOnly
  });

  const filteredNewRows = newExpandedRows.filter((row) => !excludeDisplayItemIdSet.has(row.id));

  const candidateRows: ProductionScheduleRow[] = [];
  const combinedSeen = new Set<string>(excludeDisplayItemIdSet);
  for (const row of partialRows) {
    if (combinedSeen.has(row.id)) continue;
    combinedSeen.add(row.id);
    candidateRows.push(row);
  }
  for (const row of filteredNewRows) {
    if (combinedSeen.has(row.id)) continue;
    combinedSeen.add(row.id);
    candidateRows.push(row);
  }

  const parentSequenceBySourceRowId = new Map<string, number>();
  let parentSequence = 0;
  for (const row of candidateRows) {
    const sourceRowId = row.sourceRowId ?? row.id;
    if (!parentSequenceBySourceRowId.has(sourceRowId)) {
      parentSequenceBySourceRowId.set(sourceRowId, parentSequence);
      parentSequence += 1;
    }
  }

  const combinedRows = isProductionScheduleOrderSplitEnabled()
    ? sortExpandedProductionScheduleRowsByManualOrder(candidateRows, parentSequenceBySourceRowId)
    : candidateRows;
  const rows = combinedRows.slice(0, appliedChunk);

  return { page, pageSize: appliedChunk, rows };
}

/** leaderboard 一覧と同一フィルタ条件での可視行件数のみ */
export async function countProductionScheduleDashboardVisibleRowsFromListFilters(
  params: Omit<ProductionScheduleListParams, 'page' | 'pageSize' | 'responseProfile'>,
  options?: {
    /** 集約 board shell/continue 等で同一 HTTP リクエスト内 1 回 resolve した値を渡す */
    leaderboardMaterializedBaseWhere?: Prisma.Sql;
  }
): Promise<number> {
  const filters = await prepareProductionScheduleDashboardFilters(params);
  if (filters.kind === 'blocked_empty_search') {
    return 0;
  }
  const { queryWhere } = filters;
  const leaderboardMaterializedBaseWhere = await resolveLeaderboardMaterializedBaseWhere(
    prisma,
    options?.leaderboardMaterializedBaseWhere
  );
  const totalBig = await countProductionScheduleDashboardVisibleLeaderboardUnits({
    baseWhere: leaderboardMaterializedBaseWhere,
    queryWhere,
    hasDueDateOnly: params.hasDueDateOnly,
    completionFilter: params.completionFilter,
    processChangeResidualMode: params.processChangeResidualMode,
    processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
  });
  return Number(totalBig);
}
