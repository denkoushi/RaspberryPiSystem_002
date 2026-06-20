import { Prisma } from '@prisma/client';
import {
  type ProductionScheduleResourceCategory
} from '@raspi-system/shared-types';

import { prisma } from '../../lib/prisma.js';
import { loadActualHoursReadContext } from './actual-hours/actual-hours-read-context.service.js';
import {
  COMPLETED_PROGRESS_VALUE,
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
} from './constants.js';
import {
  buildFkojunstProductionScheduleListRowDataFkojunstSql,
  buildFkojunstProductionScheduleListVisibilityWhereSql,
} from './policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildProductionScheduleEffectiveCompletedSql } from './production-schedule-effective-completion.sql.js';
import { GLOBAL_SHARED_LOCATION_KEY } from './due-management-ranking-scope-policy.service.js';
import {
  filterProductionScheduleResourceCdsByCategoryWithPolicy,
  getResourceCategoryPolicy,
  isProductionScheduleExcludedCuttingResourceCd,
  normalizeProductionScheduleResourceCd,
  resolvePartMeasurementProcessGroupForApi,
  type ResourceCategoryPolicy
} from './policies/resource-category-policy.service.js';
import {
  getResourceNameMapByResourceCds,
  type ProductionScheduleResourceNameMap
} from './resource-master.service.js';
import {
  buildMaxProductNoWinnerCondition,
  resolveLeaderboardMaterializedBaseWhere
} from './row-resolver/index.js';
import { normalizeMachineNameForCompare } from './machine-name-compare.js';
import { resolveMatchingFseibansByNormalizedMachineName } from './machine-name-fseiban-match.service.js';
import { enrichProductionScheduleRowsWithResolvedMachineName } from './production-schedule-machine-name-enrichment.service.js';
import { enrichProductionScheduleRowsWithCustomerName } from './production-schedule-customer-name-enrichment.service.js';
import { buildLeaderboardFooterChipsByPartKeyForScheduleRows } from './leaderboard/leaderboard-part-footer-processes.service.js';
import {
  SelfInspectionService,
  createSelfInspectionDecorationCache,
  ensureSelfInspectionSessionsInCache,
  ensureSelfInspectionTemplatesForRows,
  type SelfInspectionDecorationCache
} from '../part-measurement/self-inspection.service.js';
import type { LeaderboardPartFooterProcessItem } from './leaderboard/leaderboard-part-footer-processes.service.js';
import {
  buildLeaderboardShellListWhereSql,
  fetchLeaderboardScheduleRowsWithSeibanAwarePriority,
  fetchLeaderboardShellMergedPrefixRows,
  fetchLeaderboardShellRowsContinuationChunk
} from './leaderboard/leaderboard-row-selection.service.js';
import type { ProcessChangeResidualMode } from './leaderboard/leaderboard-process-change-residual.types.js';
import { normalizeLeaderboardDisplayRowIdScope } from './leaderboard/leaderboard-display-row-scope.js';
import { buildLeaderboardShellFilterFingerprint } from './leaderboard/leaderboard-shell-snapshot-fingerprint.js';
import { resolveLeaderboardShellSnapshotGenerationToken } from './leaderboard/leaderboard-shell-snapshot-generation.js';
import type { LeaderboardShellSnapshotStore } from './leaderboard/leaderboard-shell-snapshot.store.js';
import {
  isLeaderboardShellSnapshotStaleForContinue,
  sliceLeaderboardSnapshotIdsByCursor,
  sliceLeaderboardSnapshotIdsByExcludePrefix
} from './leaderboard/leaderboard-shell-continue.slice.js';
import { resolveLeaderboardShellDisplayItemPrefix } from './leaderboard/leaderboard-shell-display-item-prefix.service.js';
import {
  expandLeaderboardParentRowIdsForSnapshot,
  expandLeaderboardParentRowsForResponse,
  fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds,
  fetchPartiallyReturnedDisplayItemsForLegacyContinue,
  resolveFullyExcludedParentRowIdsForLegacyContinue,
  resolvePartiallyReturnedParentRowIdsForLegacyContinue,
  resolveParentRowIdsExcludedFromLeaderboardContinuation
} from './leaderboard/leaderboard-split-expansion.service.js';
import { isProductionScheduleOrderSplitEnabled } from './order-split/production-schedule-order-split-feature.js';
import {
  filterProductionScheduleDisplayRowsByDueDate,
  sortExpandedProductionScheduleRowsByManualOrder
} from './order-split/production-schedule-order-split.service.js';
import {
  countProductionScheduleDashboardVisibleLeaderboardUnits,
  countProductionScheduleDashboardVisibleRows
} from './production-schedule-list-count.service.js';
import {
  filterSelfInspectionEligibleProductionScheduleRows,
  hasSelfInspectionCandidateListFilters
} from './self-inspection-schedule-eligibility.js';

const SELF_INSPECTION_SCHEDULE_SCAN_CHUNK_SIZE = 200;
/** 1 リクエストあたりの生産日程スキャン上限（200 × 50 行） */
const SELF_INSPECTION_SCHEDULE_MAX_SCAN_PAGES = 50;

export { normalizeMachineNameForCompare } from './machine-name-compare.js';

export type ProductionScheduleRow = {
  id: string;
  /** 生産日程一覧と progress-overview を製番単位で突合するための専用キー。 */
  seibanJoinKey: string | null;
  occurredAt: Date;
  rowData: Prisma.JsonValue;
  processingOrder: number | null;
  globalRank: number | null;
  actualPerPieceMinutes: number | null;
  note: string | null;
  processingType: string | null;
  dueDate: Date | null;
  plannedQuantity: number | null;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  resolvedMachineName?: string | null;
  customerName: string | null;
  /** `responseProfile=leaderboard` のとき。部品測定/自主検査テンプレ突合せ用（拠点別 resource policy） */
  partMeasurementProcessGroup?: 'cutting' | 'grinding';
  /** `responseProfile=leaderboard` のとき。自主検査開始に使う active テンプレ ID */
  selfInspectionTemplateId?: string | null;
  hasSelfInspectionDrawing?: boolean;
  selfInspectionStatus?: 'not_started' | 'in_progress' | 'completed' | null;
  selfInspectionEntryPath?: string | null;
  /** 順位ボード: 機械行の FSIGENSHOYORYO（分）。`+人` OFF 時の表示基準。 */
  machineRequiredMinutes?: number;
  /** 順位ボード: 同一 ProductNo + FKOJUN の FSIGENCD=10 人工数（分）。 */
  laborRequiredMinutes?: number;
  /** display item 契約: 親 CsvDashboardRow.id（未分割・分割共通） */
  sourceRowId?: string;
  /** 分割片 ID。未分割時は null */
  splitId?: string | null;
  splitNo?: number | null;
  splitQuantity?: number | null;
  isSplit?: boolean;
};

export type ProductionScheduleListParams = {
  page: number;
  pageSize: number;
  queryText: string;
  productNos: string[];
  machineName?: string;
  resourceCds: string[];
  assignedOnlyCds: string[];
  resourceCategory?: ProductionScheduleResourceCategory;
  hasNoteOnly: boolean;
  hasDueDateOnly: boolean;
  allowResourceOnly?: boolean;
  locationKey: string;
  siteKey?: string;
  /**
   * `leaderboard`: actual-hours を省略。手動割当を優先し、`resourceCds` がちょうど1件のときは**同一製番の他資源へ展開しない**（カード単位）。2件以上または0件のときは従来どおり製番展開あり。残り枠は納期（補完）で埋める。
   * `resolvedMachineName` は full と同様にバッチ解決する（省略時は full）。
   */
  responseProfile?: 'full' | 'leaderboard';
  /** true のとき自主検査開始可能行だけを返す（生産日程をチャンク走査） */
  selfInspectionEligibleOnly?: boolean;
  /** キオスク順位ボード専用。公開 API ではなくサービス内部で設定する。 */
  processChangeResidualMode?: ProcessChangeResidualMode;
  /** {@link materializeProcessChangeResidualStrongEvidence} を同一リクエスト内 1 回だけ実行した結果。 */
  processChangeResidualStrongEvidenceKeys?: ReadonlySet<string>;
};

/** 順位ボード phased read（shell / continue）の共通レスポンス形（snapshotId は shell・正常 continue で付与） */
export type LeaderboardShellPhasedReadResult = Pick<ProductionScheduleListResult, 'page' | 'pageSize' | 'rows'> & {
  snapshotId?: string;
  snapshotExpired?: boolean;
  /** 次の continue で送る cursor（既に返した行数）。shell・snapshot continue で付与。 */
  nextCursor?: number;
  /** さらに続きがあるか（snapshot 経路で確実。無 snapshot フォールバックでは省略可） */
  hasMore?: boolean;
};

export type PreparedProductionScheduleDashboardFilters =
  | { kind: 'blocked_empty_search' }
  | {
      kind: 'ready';
      baseWhere: Prisma.Sql;
      queryWhere: Prisma.Sql;
      leaderboardExpansionWhere: Prisma.Sql;
      /** `siteKey` 優先。global rank 選択に使用。 */
      siteScopedGlobalRankLocation: string;
    };

export async function prepareProductionScheduleDashboardFilters(
  params: Omit<ProductionScheduleListParams, 'page' | 'pageSize' | 'responseProfile'>
): Promise<PreparedProductionScheduleDashboardFilters> {
  const {
    queryText,
    productNos,
    machineName,
    resourceCds,
    assignedOnlyCds,
    resourceCategory,
    hasNoteOnly,
    hasDueDateOnly,
    allowResourceOnly = false,
    locationKey,
    siteKey
  } = params;

  const textConditions = buildTextConditions(queryText);
  const resourceCategoryPolicy = await getResourceCategoryPolicy({
    siteKey,
    deviceScopeKey: locationKey
  });
  const filteredResourceCds = filterProductionScheduleResourceCdsByCategoryWithPolicy(
    resourceCds,
    resourceCategory,
    resourceCategoryPolicy
  );
  const filteredAssignedOnlyCds = filterProductionScheduleResourceCdsByCategoryWithPolicy(
    assignedOnlyCds,
    resourceCategory,
    resourceCategoryPolicy
  );
  const resourceConditions = buildResourceConditions({
    resourceCds: filteredResourceCds,
    assignedOnlyCds: filteredAssignedOnlyCds,
    locationKey
  });
  const resourceCategoryCondition = buildResourceCategoryCondition(resourceCategory, resourceCategoryPolicy);
  const machineNameCondition = await buildMachineNameCondition(machineName);
  const productNoCondition = buildProductNoCondition(productNos);

  const hasOnlyResourceFilters =
    textConditions.length === 0 &&
    normalizeMachineNameForCompare(machineName).length === 0 &&
    productNos.length === 0 &&
    filteredAssignedOnlyCds.length === 0 &&
    (filteredResourceCds.length > 0 || resourceCategory !== undefined);

  if (hasOnlyResourceFilters && !allowResourceOnly) {
    return { kind: 'blocked_empty_search' };
  }

  const baseWhere = Prisma.sql`
    "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
  `;
  const queryWhere = Prisma.sql`${buildQueryWhere({
    textConditions,
    resourceConditions,
    resourceCategoryCondition,
    machineNameCondition,
    hasNoteOnly,
    hasDueDateOnly
  })} ${productNoCondition}`;
  const leaderboardExpansionWhere = buildQueryWhere({
    textConditions: [],
    resourceConditions,
    resourceCategoryCondition,
    machineNameCondition: Prisma.empty,
    hasNoteOnly: false,
    hasDueDateOnly: false
  });

  const siteScopedGlobalRankLocation = siteKey?.trim().length ? siteKey.trim() : locationKey;

  return {
    kind: 'ready',
    baseWhere,
    queryWhere,
    leaderboardExpansionWhere,
    siteScopedGlobalRankLocation
  };
}

/**
 * `resourceCds` がちょうど 1 件のときはカード単位選定とみなし、同一製番の他資源への展開を行わない。
 * 0 件・2 件以上は従来どおり展開あり（後方互換）。
 */
function shouldExpandLeaderboardSeibanAcrossResources(resourceCds: readonly string[]): boolean {
  return resourceCds.length !== 1;
}

/** 順位ボード段階取得: COUNT・装飾なしの leaderboard 選定のみ（初回は先頭 page 件の並びを確定し snapshot を発行。全件マージは遅延可） */
export async function listLeaderboardShellProductionScheduleRows(
  params: ProductionScheduleListParams,
  options: {
    snapshotStore: LeaderboardShellSnapshotStore;
    /** 集約 shell 等で同一 HTTP リクエスト内 1 回 resolve した値を渡す */
    leaderboardMaterializedBaseWhere?: Prisma.Sql;
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

  const leaderboardMaterializedBaseWhere = await resolveLeaderboardMaterializedBaseWhere(
    prisma,
    options.leaderboardMaterializedBaseWhere
  );

  const seibanExpansion = shouldExpandLeaderboardSeibanAcrossResources(params.resourceCds);

  const leaderboardShellListWhere = buildLeaderboardShellListWhereSql({
    leaderboardMaterializedBaseWhere,
    queryWhere,
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
    allowResourceOnly: params.allowResourceOnly ?? false
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
    allowResourceOnly: params.allowResourceOnly ?? false
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
    processChangeResidualMode: params.processChangeResidualMode,
    processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
  });
  return Number(totalBig);
}

/** 既に hydrate 済みの shell 行へ kiosk 向け装飾のみ適用（compose continue で二重 hydrate を避ける） */
export async function decorateLeaderboardShellRowsForKioskFromHydratedRows(params: {
  hydratedRows: ProductionScheduleRow[];
  locationKey: string;
  siteKey?: string;
  /**
   * 装飾対象の表示スコープ rowId（省略時は hydrate 済み行の id から導出）。
   * shell/board のリクエスト境界とフッタ winner 選定を揃えるために渡す。
   */
  preferredDisplayRowIds?: readonly string[];
}): Promise<ProductionScheduleLeaderboardDecorationPayload> {
  const { hydratedRows, locationKey, siteKey, preferredDisplayRowIds } = params;

  const preferredFooterScope =
    preferredDisplayRowIds !== undefined
      ? normalizeLeaderboardDisplayRowIdScope(preferredDisplayRowIds)
      : normalizeLeaderboardDisplayRowIdScope(hydratedRows.map((r) => r.id));

  if (hydratedRows.length === 0) {
    return {
      rowDecorations: [],
      leaderboardFooterChipsByPartKey: {}
    };
  }

  const lightRows = hydratedRows.map((r) => ({
    ...r,
    actualPerPieceMinutes: null as number | null,
    customerName: null as string | null
  }));

  const rowsWithResolvedMachineName = await enrichProductionScheduleRowsWithResolvedMachineName(lightRows);
  const enrichedRows = await enrichProductionScheduleRowsWithCustomerName(rowsWithResolvedMachineName);
  const selfInspectionService = new SelfInspectionService();
  const selfInspectionDecorations = await selfInspectionService.buildLeaderboardDecorations(enrichedRows, {
    siteKey
  });
  const selfInspectionById = new Map(selfInspectionDecorations.map((row) => [row.id, row]));

  const leaderboardFooterChipsByPartKey = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
    rows: enrichedRows,
    locationKey,
    siteKey,
    preferredDisplayRowIds: preferredFooterScope
  });

  return {
    rowDecorations: enrichedRows.map((r) => ({
      id: r.id,
      resolvedMachineName: r.resolvedMachineName ?? null,
      customerName: r.customerName ?? null,
      hasSelfInspectionDrawing: selfInspectionById.get(r.id)?.hasSelfInspectionDrawing ?? false,
      selfInspectionTemplateId: selfInspectionById.get(r.id)?.selfInspectionTemplateId ?? null,
      selfInspectionStatus: selfInspectionById.get(r.id)?.selfInspectionStatus ?? null,
      selfInspectionEntryPath: selfInspectionById.get(r.id)?.selfInspectionEntryPath ?? null
    })),
    leaderboardFooterChipsByPartKey: leaderboardFooterChipsByPartKey ?? {}
  };
}

/** rowIds 順で leaderboard 選定クエリと同形の行を hydrate し、装飾用ペイロードを返す */
export async function decorateLeaderboardShellRowsForKiosk(params: {
  orderedRowIds: string[];
  locationKey: string;
  siteKey?: string;
}): Promise<ProductionScheduleLeaderboardDecorationPayload> {
  const { orderedRowIds, locationKey, siteKey } = params;

  const preferredDisplayRowIds = normalizeLeaderboardDisplayRowIdScope(orderedRowIds);

  if (preferredDisplayRowIds.length === 0) {
    return {
      rowDecorations: [],
      leaderboardFooterChipsByPartKey: {}
    };
  }

  const leaderboardMaterializedBaseWhere = await resolveLeaderboardMaterializedBaseWhere(prisma);

  const rawRows = await fetchLeaderboardScheduleHydratedRowsOrderedByDisplayItemIds({
    orderedDisplayItemIds: preferredDisplayRowIds,
    locationKey,
    siteScopedGlobalRankLocation: siteKey?.trim().length ? siteKey.trim() : locationKey,
    leaderboardMaterializedBaseWhere
  });

  const lightRows = rawRows.map((r) => ({
    ...r,
    actualPerPieceMinutes: null as number | null,
    customerName: null as string | null
  }));

  return decorateLeaderboardShellRowsForKioskFromHydratedRows({
    hydratedRows: lightRows,
    locationKey,
    siteKey,
    preferredDisplayRowIds
  });
}

export type ProductionScheduleLeaderboardDecorationPayload = {
  rowDecorations: Array<{
    id: string;
    resolvedMachineName: string | null;
    customerName: string | null;
    hasSelfInspectionDrawing: boolean;
    selfInspectionTemplateId: string | null;
    selfInspectionStatus: 'not_started' | 'in_progress' | 'completed' | null;
    selfInspectionEntryPath: string | null;
  }>;
  leaderboardFooterChipsByPartKey: Record<string, LeaderboardPartFooterProcessItem[]>;
};

export type ProductionScheduleOrderUsageParams = {
  locationKey: string;
  resourceCds: string[];
};

const buildTextConditions = (queryText: string): Prisma.Sql[] => {
  const tokens = Array.from(
    new Set(
      queryText
        .split(',')
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    )
  ).slice(0, 8);

  const textConditions: Prisma.Sql[] = [];
  for (const token of tokens) {
    const isEightCharSeibanToken = /^[A-Za-z0-9*]{8}$/.test(token);
    const isNumeric = /^\d+$/.test(token);
    const likeValue = `%${token}%`;
    if (isEightCharSeibanToken) {
      textConditions.push(
        Prisma.sql`(("CsvDashboardRow"."rowData"->>'FSEIBAN') = ${token} OR ("CsvDashboardRow"."rowData"->>'ProductNo') ILIKE ${likeValue} OR ("CsvDashboardRow"."rowData"->>'FHINCD') ILIKE ${likeValue})`
      );
    } else if (isNumeric) {
      textConditions.push(
        Prisma.sql`(("CsvDashboardRow"."rowData"->>'ProductNo') ILIKE ${likeValue} OR ("CsvDashboardRow"."rowData"->>'FHINCD') ILIKE ${likeValue})`
      );
    } else {
      textConditions.push(
        Prisma.sql`(("CsvDashboardRow"."rowData"->>'ProductNo') ILIKE ${likeValue} OR ("CsvDashboardRow"."rowData"->>'FSEIBAN') ILIKE ${likeValue} OR ("CsvDashboardRow"."rowData"->>'FHINCD') ILIKE ${likeValue})`
      );
    }
  }
  return textConditions;
};

const buildResourceConditions = (params: {
  resourceCds: string[];
  assignedOnlyCds: string[];
  locationKey: string;
}): Prisma.Sql[] => {
  const { locationKey, resourceCds, assignedOnlyCds } = params;
  const normalizedResourceExpr = Prisma.sql`UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'))`;
  const normalizedResourceCds = resourceCds.map((cd) => normalizeProductionScheduleResourceCd(cd));
  const normalizedAssignedOnlyCds = assignedOnlyCds.map((cd) => normalizeProductionScheduleResourceCd(cd));
  const resourceConditions: Prisma.Sql[] = [];

  if (normalizedResourceCds.length > 0) {
    resourceConditions.push(
      Prisma.sql`${normalizedResourceExpr} IN (${Prisma.join(
        normalizedResourceCds.map((cd) => Prisma.sql`${cd}`),
        ','
      )})`
    );
  }

  if (normalizedAssignedOnlyCds.length > 0) {
    const resourceCdFilter = Prisma.join(
      normalizedAssignedOnlyCds.map((cd) => Prisma.sql`${cd}`),
      ','
    );
    const parentAssignmentSubquery = Prisma.sql`
      SELECT "csvDashboardRowId"
      FROM "ProductionScheduleOrderAssignment"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND (
          "location" = ${locationKey}
          OR "siteKey" = ${locationKey}
        )
        AND "resourceCd" IN (${resourceCdFilter})
    `;
    const assignedOnlyParentRowSubquery = isProductionScheduleOrderSplitEnabled()
      ? Prisma.sql`
        ${parentAssignmentSubquery}
        UNION
        SELECT "s"."parentCsvDashboardRowId"
        FROM "ProductionScheduleOrderSplitAssignment" AS "sa"
        INNER JOIN "ProductionScheduleOrderSplit" AS "s"
          ON "s"."id" = "sa"."splitId"
          AND "s"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        WHERE "sa"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND (
            "sa"."location" = ${locationKey}
            OR "sa"."siteKey" = ${locationKey}
          )
          AND "sa"."resourceCd" IN (${resourceCdFilter})
      `
      : parentAssignmentSubquery;

    resourceConditions.push(
      Prisma.sql`"CsvDashboardRow"."id" IN (${assignedOnlyParentRowSubquery})`
    );
  }

  return resourceConditions;
};

const buildResourceCategoryCondition = (
  resourceCategory: ProductionScheduleResourceCategory | undefined,
  policy: ResourceCategoryPolicy
): Prisma.Sql => {
  const normalizedResourceExpr = Prisma.sql`UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'))`;
  if (!resourceCategory) {
    return Prisma.empty;
  }

  const grindingCds = policy.grindingResourceCds.map((cd) => Prisma.sql`${cd}`);
  if (resourceCategory === 'grinding') {
    return Prisma.sql`AND ${normalizedResourceExpr} IN (${Prisma.join(grindingCds, ',')})`;
  }

  const excludedCds = policy.cuttingExcludedResourceCds.map((cd) => Prisma.sql`${cd}`);
  if (excludedCds.length === 0) {
    return Prisma.sql`AND ${normalizedResourceExpr} NOT IN (${Prisma.join(grindingCds, ',')})`;
  }

  return Prisma.sql`AND ${normalizedResourceExpr} NOT IN (${Prisma.join(grindingCds, ',')}) AND ${normalizedResourceExpr} NOT IN (${Prisma.join(excludedCds, ',')})`;
};

const buildQueryWhere = (params: {
  textConditions: Prisma.Sql[];
  resourceConditions: Prisma.Sql[];
  resourceCategoryCondition: Prisma.Sql;
  machineNameCondition: Prisma.Sql;
  hasNoteOnly: boolean;
  hasDueDateOnly: boolean;
}): Prisma.Sql => {
  const {
    textConditions,
    resourceConditions,
    resourceCategoryCondition,
    machineNameCondition,
    hasNoteOnly,
    hasDueDateOnly
  } = params;

  const textWhere =
    textConditions.length > 0 ? Prisma.sql`(${Prisma.join(textConditions, ' OR ')})` : Prisma.empty;
  const resourceWhere =
    resourceConditions.length > 0
      ? Prisma.sql`(${Prisma.join(resourceConditions, ' OR ')})`
      : Prisma.empty;

  let queryWhere =
    textConditions.length > 0 && resourceConditions.length > 0
      ? Prisma.sql`AND ${textWhere} AND ${resourceWhere}`
      : textConditions.length > 0
        ? Prisma.sql`AND ${textWhere}`
        : resourceConditions.length > 0
          ? Prisma.sql`AND ${resourceWhere}`
          : Prisma.empty;

  queryWhere = Prisma.sql`${queryWhere} ${resourceCategoryCondition} ${machineNameCondition}`;

  if (hasNoteOnly) {
    queryWhere = Prisma.sql`${queryWhere} AND "CsvDashboardRow"."id" IN (
      SELECT "csvDashboardRowId" FROM "ProductionScheduleRowNote"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND TRIM("note") <> ''
    )`;
  }
  if (hasDueDateOnly) {
    const parentDueDateExists = Prisma.sql`"CsvDashboardRow"."id" IN (
      SELECT "csvDashboardRowId" FROM "ProductionScheduleRowNote"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND "dueDate" IS NOT NULL
    )`;
    const splitDueDateExists = isProductionScheduleOrderSplitEnabled()
      ? Prisma.sql` OR "CsvDashboardRow"."id" IN (
          SELECT "parentCsvDashboardRowId" FROM "ProductionScheduleOrderSplit"
          WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
            AND "dueDate" IS NOT NULL
        )`
      : Prisma.empty;
    queryWhere = Prisma.sql`${queryWhere} AND (${parentDueDateExists}${splitDueDateExists})`;
  }
  return queryWhere;
};

const buildProductNoCondition = (productNos: string[]): Prisma.Sql => {
  const normalized = Array.from(
    new Set(
      productNos
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    )
  );
  if (normalized.length === 0) {
    return Prisma.empty;
  }
  return Prisma.sql`AND ("CsvDashboardRow"."rowData"->>'ProductNo') IN (${Prisma.join(
    normalized.map((value) => Prisma.sql`${value}`),
    ','
  )})`;
};

const listMatchingFseibansByMachineName = async (normalizedMachineName: string): Promise<string[]> =>
  resolveMatchingFseibansByNormalizedMachineName(normalizedMachineName);

const buildMachineNameCondition = async (machineName: string | undefined): Promise<Prisma.Sql> => {
  const normalizedMachineName = normalizeMachineNameForCompare(machineName);
  if (normalizedMachineName.length === 0) {
    return Prisma.empty;
  }
  const matchingFseibans = await listMatchingFseibansByMachineName(normalizedMachineName);
  if (matchingFseibans.length === 0) {
    return Prisma.sql`AND 1 = 0`;
  }
  return Prisma.sql`AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') IN (${Prisma.join(
    matchingFseibans.map((value) => Prisma.sql`${value}`),
    ','
  )})`;
};

export type ProductionScheduleListResult = {
  page: number;
  pageSize: number;
  /** 自主検査候補一覧では全件数を算出しないため省略可 */
  total?: number;
  rows: ProductionScheduleRow[];
  /** `responseProfile=leaderboard` のときのみ。progress-overview を二重取得せず行下工程チップへ供給する。 */
  leaderboardFooterChipsByPartKey?: Record<string, LeaderboardPartFooterProcessItem[]>;
  /** `selfInspectionEligibleOnly` のとき。さらに候補がありうる（走査上限または未走査の日程が残る） */
  hasMore?: boolean;
};

async function enrichLeaderboardListRowsAndFooter(params: {
  page: number;
  pageSize: number;
  total: number;
  rows: ProductionScheduleRow[];
  locationKey: string;
  siteKey: string | undefined;
}): Promise<ProductionScheduleListResult> {
  const { page, pageSize, total, rows, locationKey, siteKey } = params;

  const lightRows = rows.map((row) => ({
    ...row,
    actualPerPieceMinutes: null as number | null
  }));

  const rowsWithResolvedMachineName = await enrichProductionScheduleRowsWithResolvedMachineName(lightRows);
  const enrichedRows = await enrichProductionScheduleRowsWithCustomerName(rowsWithResolvedMachineName);
  const resourcePolicy = await getResourceCategoryPolicy({ siteKey });
  const rowsWithProcessGroup = enrichedRows.map((row) => {
    const rowData = (row.rowData ?? {}) as Record<string, unknown>;
    const resourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    return {
      ...row,
      partMeasurementProcessGroup: resourceCd
        ? resolvePartMeasurementProcessGroupForApi(resourceCd, resourcePolicy)
        : undefined
    };
  });

  const selfInspectionService = new SelfInspectionService();
  const selfInspectionByRowId = new Map(
    (
      await selfInspectionService.buildLeaderboardDecorations(
        rowsWithProcessGroup.map((row) => ({
          id: row.id,
          rowData: row.rowData,
          plannedQuantity: row.plannedQuantity
        })),
        { siteKey }
      )
    ).map((decoration) => [decoration.id, decoration])
  );
  const rowsWithSelfInspection = rowsWithProcessGroup.map((row) => {
    const decoration = selfInspectionByRowId.get(row.id);
    return {
      ...row,
      hasSelfInspectionDrawing: decoration?.hasSelfInspectionDrawing ?? false,
      selfInspectionTemplateId: decoration?.selfInspectionTemplateId ?? null,
      selfInspectionStatus: decoration?.selfInspectionStatus ?? null,
      selfInspectionEntryPath: decoration?.selfInspectionEntryPath ?? null
    };
  });

  const leaderboardFooterChipsByPartKey = await buildLeaderboardFooterChipsByPartKeyForScheduleRows({
    rows: rowsWithSelfInspection,
    locationKey,
    siteKey,
    preferredDisplayRowIds: normalizeLeaderboardDisplayRowIdScope(rowsWithSelfInspection.map((r) => r.id))
  });

  return {
    page,
    pageSize,
    total,
    rows: rowsWithSelfInspection,
    ...(leaderboardFooterChipsByPartKey ? { leaderboardFooterChipsByPartKey } : {})
  };
}

async function fetchProductionScheduleDashboardRowsRawPage(params: {
  baseWhere: Prisma.Sql;
  queryWhere: Prisma.Sql;
  locationKey: string;
  siteScopedGlobalRankLocation: string;
  offset: number;
  limit: number;
}): Promise<ProductionScheduleRow[]> {
  const { baseWhere, queryWhere, locationKey, siteScopedGlobalRankLocation, offset, limit } = params;
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.max(1, Math.floor(limit));

  return prisma.$queryRaw<ProductionScheduleRow[]>`
    SELECT
      "CsvDashboardRow"."id",
      NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSEIBAN'), '') AS "seibanJoinKey",
      "CsvDashboardRow"."occurredAt",
      jsonb_build_object(
        'ProductNo', "CsvDashboardRow"."rowData"->>'ProductNo',
        'FSEIBAN', "CsvDashboardRow"."rowData"->>'FSEIBAN',
        'FHINCD', "CsvDashboardRow"."rowData"->>'FHINCD',
        'FHINMEI', "CsvDashboardRow"."rowData"->>'FHINMEI',
        'FSIGENCD', "CsvDashboardRow"."rowData"->>'FSIGENCD',
        'FSIGENSHOYORYO', "CsvDashboardRow"."rowData"->>'FSIGENSHOYORYO',
        'FKOJUN', "CsvDashboardRow"."rowData"->>'FKOJUN',
        'FKOJUNST', ( ${buildFkojunstProductionScheduleListRowDataFkojunstSql()} ),
        'progress', (CASE WHEN ${buildProductionScheduleEffectiveCompletedSql()} THEN ${COMPLETED_PROGRESS_VALUE} ELSE '' END)
      ) AS "rowData",
      (
        SELECT "orderNumber"
        FROM "ProductionScheduleOrderAssignment"
        WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
          AND (
            "location" = ${locationKey}
            OR "siteKey" = ${locationKey}
          )
        ORDER BY
          CASE WHEN "location" = ${locationKey} THEN 0 ELSE 1 END ASC,
          "updatedAt" DESC
        LIMIT 1
      ) AS "processingOrder",
      (
        SELECT "globalRank"
        FROM "ProductionScheduleGlobalRowRank"
        WHERE "csvDashboardRowId" = "CsvDashboardRow"."id"
          AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
          AND "location" IN (${siteScopedGlobalRankLocation}, ${GLOBAL_SHARED_LOCATION_KEY}, ${locationKey})
        ORDER BY CASE
          WHEN "location" = ${siteScopedGlobalRankLocation} THEN 0
          WHEN "location" = ${GLOBAL_SHARED_LOCATION_KEY} THEN 1
          ELSE 2
        END ASC
        LIMIT 1
      ) AS "globalRank",
      NULLIF(TRIM("n"."note"), '') AS "note",
      COALESCE("pp"."processingType", "n"."processingType") AS "processingType",
      "n"."dueDate" AS "dueDate",
      "supplement"."plannedQuantity" AS "plannedQuantity",
      "supplement"."plannedStartDate" AS "plannedStartDate",
      "supplement"."plannedEndDate" AS "plannedEndDate"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleRowNote" AS "n"
      ON "n"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "n"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionSchedulePartProcessingType" AS "pp"
      ON "pp"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "pp"."fhincd" = ("CsvDashboardRow"."rowData"->>'FHINCD')
    LEFT JOIN "ProductionScheduleOrderSupplement" AS "supplement"
      ON "supplement"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "supplement"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstStatus" AS "fkst"
      ON "fkst"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkst"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE ${baseWhere} ${queryWhere} ${buildFkojunstProductionScheduleListVisibilityWhereSql()}
    ORDER BY
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') ASC,
      ("CsvDashboardRow"."rowData"->>'ProductNo') ASC,
      (CASE
        WHEN ("CsvDashboardRow"."rowData"->>'FKOJUN') ~ '^\\d+$' THEN (("CsvDashboardRow"."rowData"->>'FKOJUN'))::int
        ELSE NULL
      END) ASC,
      ("CsvDashboardRow"."rowData"->>'FHINCD') ASC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `;
}

async function enrichProductionScheduleRowsForSelfInspectionCandidate(
  rows: ProductionScheduleRow[],
  locationKey: string,
  siteKey: string | undefined,
  decorationCache: SelfInspectionDecorationCache
): Promise<ProductionScheduleRow[]> {
  if (rows.length === 0) {
    return rows;
  }

  const rowsWithProcessGroup = rows.map((row) => {
    const rowData = (row.rowData ?? {}) as Record<string, unknown>;
    const resourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    return {
      ...row,
      actualPerPieceMinutes: null,
      customerName: null,
      partMeasurementProcessGroup: resourceCd
        ? resolvePartMeasurementProcessGroupForApi(resourceCd, decorationCache.policy)
        : undefined
    };
  });

  const selfInspectionService = new SelfInspectionService();
  const selfInspectionDecorations = await selfInspectionService.buildLeaderboardDecorations(
    rowsWithProcessGroup.map((row) => ({
      id: row.id,
      rowData: row.rowData,
      plannedQuantity: row.plannedQuantity
    })),
    { siteKey },
    decorationCache
  );
  const selfInspectionById = new Map(selfInspectionDecorations.map((row) => [row.id, row]));

  return rowsWithProcessGroup.map((row) => {
    const decoration = selfInspectionById.get(row.id);
    return {
      ...row,
      plannedQuantity: decoration?.resolvedPlannedQuantity ?? row.plannedQuantity ?? null,
      hasSelfInspectionDrawing: decoration?.hasSelfInspectionDrawing ?? false,
      selfInspectionTemplateId: decoration?.selfInspectionTemplateId ?? null,
      selfInspectionStatus: decoration?.selfInspectionStatus ?? null,
      selfInspectionEntryPath: decoration?.selfInspectionEntryPath ?? null
    };
  });
}

/**
 * 自主検査開始可能行のみ返す。生産日程を `fetchProductionScheduleDashboardRowsRawPage` で
 * LIMIT/OFFSET チャンク走査し、各行に自主検査装飾を付与してから eligibility で絞る。
 * `responseProfile=leaderboard` は page/offset を持たないため、ここでは使用しない。
 */
export async function listSelfInspectionEligibleProductionScheduleRows(
  params: Omit<ProductionScheduleListParams, 'responseProfile' | 'selfInspectionEligibleOnly'>
): Promise<ProductionScheduleListResult> {
  const page = Math.max(1, params.page);
  const pageSize = Math.max(1, Math.min(params.pageSize, 200));
  const skip = (page - 1) * pageSize;
  const needThrough = skip + pageSize;

  if (
    !hasSelfInspectionCandidateListFilters({
      queryText: params.queryText,
      resourceCds: params.resourceCds,
      productNos: params.productNos
    })
  ) {
    return {
      page,
      pageSize,
      rows: [],
      hasMore: false
    };
  }

  const filters = await prepareProductionScheduleDashboardFilters(params);
  if (filters.kind === 'blocked_empty_search') {
    return {
      page,
      pageSize,
      rows: [],
      hasMore: false
    };
  }

  const { baseWhere, queryWhere, siteScopedGlobalRankLocation } = filters;
  const decorationCache = await createSelfInspectionDecorationCache({
    siteKey: params.siteKey,
    resourceCds: params.resourceCds
  });
  const eligibleCollected: ProductionScheduleRow[] = [];
  const seenRowIds = new Set<string>();
  let scheduleOffset = 0;
  let scheduleExhausted = false;
  let hitScanCap = false;
  let scanIterations = 0;

  while (eligibleCollected.length < needThrough && scanIterations < SELF_INSPECTION_SCHEDULE_MAX_SCAN_PAGES) {
    scanIterations += 1;
    const rawRows = await fetchProductionScheduleDashboardRowsRawPage({
      baseWhere,
      queryWhere,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation,
      offset: scheduleOffset,
      limit: SELF_INSPECTION_SCHEDULE_SCAN_CHUNK_SIZE
    });
    if (rawRows.length === 0) {
      scheduleExhausted = true;
      break;
    }

    await ensureSelfInspectionTemplatesForRows(decorationCache, rawRows);
    await ensureSelfInspectionSessionsInCache(
      decorationCache,
      rawRows.map((row) => row.id)
    );
    const enrichedRows = await enrichProductionScheduleRowsForSelfInspectionCandidate(
      rawRows,
      params.locationKey,
      params.siteKey,
      decorationCache
    );
    for (const row of filterSelfInspectionEligibleProductionScheduleRows(enrichedRows)) {
      if (seenRowIds.has(row.id)) {
        continue;
      }
      seenRowIds.add(row.id);
      eligibleCollected.push(row);
    }

    scheduleOffset += rawRows.length;
    if (rawRows.length < SELF_INSPECTION_SCHEDULE_SCAN_CHUNK_SIZE) {
      scheduleExhausted = true;
      break;
    }
    if (scanIterations >= SELF_INSPECTION_SCHEDULE_MAX_SCAN_PAGES) {
      hitScanCap = true;
      break;
    }
  }

  const pageRows = eligibleCollected.slice(skip, skip + pageSize);
  const hasMore = eligibleCollected.length > needThrough || !scheduleExhausted || hitScanCap;

  return {
    page,
    pageSize,
    rows: pageRows,
    hasMore
  };
}

function toSelfInspectionEligibleListParams(
  params: ProductionScheduleListParams
): Parameters<typeof listSelfInspectionEligibleProductionScheduleRows>[0] {
  const rest = { ...params };
  delete rest.selfInspectionEligibleOnly;
  delete rest.responseProfile;
  return rest;
}

export type SignageMachineBoardScheduleRow = Pick<
  ProductionScheduleRow,
  'id' | 'rowData' | 'dueDate' | 'plannedQuantity'
>;

export type SignageMachineBoardScheduleFetchResult = {
  rows: SignageMachineBoardScheduleRow[];
  /** 機種に紐づく生産日程行を最後まで走査した */
  scheduleExhausted: boolean;
  /** 安全上限により走査を打ち切った */
  hitScanCap: boolean;
  /** ボード表示件数上限（UI メタデータ。取得打ち切りには使わない） */
  maxRows: number;
};

/** 1 リクエストあたりの機種別生産日程スキャン上限（pageSize × この値） */
const SIGNAGE_MACHINE_BOARD_SCHEDULE_MAX_SCAN_PAGES = 50;

export type SignageMachineBoardScheduleScanMeta = {
  /** 機種に紐づく生産日程行を最後まで走査した */
  scheduleExhausted: boolean;
  /** 安全上限により走査を打ち切った */
  hitScanCap: boolean;
  /** ボード表示件数上限（UI メタデータ） */
  maxRows: number;
};

function mapSignageMachineBoardScheduleRows(
  rows: ProductionScheduleRow[]
): SignageMachineBoardScheduleRow[] {
  return rows.map((row) => ({
    id: row.id,
    rowData: row.rowData,
    dueDate: row.dueDate,
    plannedQuantity: row.plannedQuantity,
  }));
}

/** サイネージ自主検査ボード向け: 生産日程行をページ単位で走査（全件メモリ保持しない） */
export async function scanProductionScheduleRowsForSignageMachineBoard(
  params: {
    machineName: string;
    locationKey: string;
    siteKey?: string;
    maxRows: number;
    pageSize?: number;
    /** テスト用。省略時は SIGNAGE_MACHINE_BOARD_SCHEDULE_MAX_SCAN_PAGES */
    maxScanPages?: number;
  },
  onPage: (rows: SignageMachineBoardScheduleRow[]) => Promise<void> | void
): Promise<SignageMachineBoardScheduleScanMeta> {
  const displayCap = Math.max(1, Math.min(Math.floor(params.maxRows), 2000));
  const safePageSize = Math.max(1, Math.min(Math.floor(params.pageSize ?? 500), 2000));
  const maxScanPages = Math.max(
    1,
    Math.floor(params.maxScanPages ?? SIGNAGE_MACHINE_BOARD_SCHEDULE_MAX_SCAN_PAGES)
  );
  const filters = await prepareProductionScheduleDashboardFilters({
    queryText: '',
    productNos: [],
    machineName: params.machineName,
    resourceCds: [],
    assignedOnlyCds: [],
    hasNoteOnly: false,
    hasDueDateOnly: false,
    allowResourceOnly: true,
    locationKey: params.locationKey,
    siteKey: params.siteKey,
  });
  if (filters.kind === 'blocked_empty_search') {
    return {
      scheduleExhausted: true,
      hitScanCap: false,
      maxRows: displayCap,
    };
  }

  const { baseWhere, queryWhere, siteScopedGlobalRankLocation } = filters;
  let offset = 0;
  let scanIterations = 0;
  let scheduleExhausted = false;
  let hitScanCap = false;

  while (scanIterations < maxScanPages) {
    scanIterations += 1;
    const pageRows = await fetchProductionScheduleDashboardRowsRawPage({
      baseWhere,
      queryWhere,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation,
      offset,
      limit: safePageSize,
    });
    if (pageRows.length > 0) {
      await onPage(mapSignageMachineBoardScheduleRows(pageRows));
    }
    if (pageRows.length < safePageSize) {
      scheduleExhausted = true;
      break;
    }
    offset += pageRows.length;
  }

  if (!scheduleExhausted && scanIterations >= maxScanPages) {
    hitScanCap = true;
  }

  return {
    scheduleExhausted,
    hitScanCap,
    maxRows: displayCap,
  };
}

/** サイネージ自主検査 auto 候補選定向けの装飾入力行（full 一覧の実績時間・顧客名は省略） */
export type SignageAutoTargetSelectorScheduleRow = Pick<
  ProductionScheduleRow,
  | 'id'
  | 'seibanJoinKey'
  | 'occurredAt'
  | 'rowData'
  | 'dueDate'
  | 'plannedQuantity'
  | 'processingOrder'
  | 'globalRank'
  | 'note'
  | 'processingType'
  | 'plannedStartDate'
  | 'plannedEndDate'
>;

function mapSignageAutoTargetSelectorScheduleRows(
  rows: ProductionScheduleRow[]
): SignageAutoTargetSelectorScheduleRow[] {
  return rows.map((row) => ({
    id: row.id,
    seibanJoinKey: row.seibanJoinKey,
    occurredAt: row.occurredAt,
    rowData: row.rowData,
    dueDate: row.dueDate,
    plannedQuantity: row.plannedQuantity,
    processingOrder: row.processingOrder,
    globalRank: row.globalRank,
    note: row.note,
    processingType: row.processingType,
    plannedStartDate: row.plannedStartDate,
    plannedEndDate: row.plannedEndDate,
  }));
}

export type SignageAutoTargetSelectorScanMeta = {
  scheduleExhausted: boolean;
  /** 走査上限到達後の 1 件プローブで後続行が存在する */
  hitScanCap: boolean;
  scannedRowCount: number;
  maxRows: number;
};

export type SelfInspectionMachineTargetSelectorRowDecoration = {
  id: string;
  resolvedMachineName: string | null;
  hasSelfInspectionDrawing: boolean;
  selfInspectionStatus: 'not_started' | 'in_progress' | 'completed' | null;
};

/**
 * サイネージ自主検査 auto 候補選定向け: resourceCds フィルタで raw page 走査。
 * full 一覧（実績時間・顧客名）を避け、上限到達時は 1 件プローブで hitScanCap を確定する。
 */
export async function scanProductionScheduleRowsForSignageAutoTargetSelector(
  params: {
    resourceCds: string[];
    locationKey: string;
    siteKey?: string;
    maxRows: number;
    pageSize?: number;
  },
  onPage: (rows: SignageAutoTargetSelectorScheduleRow[]) => Promise<void> | void
): Promise<SignageAutoTargetSelectorScanMeta> {
  const scanCap = Math.max(1, Math.min(Math.floor(params.maxRows), 2000));
  const safePageSize = Math.max(1, Math.min(Math.floor(params.pageSize ?? 500), 2000));
  const filters = await prepareProductionScheduleDashboardFilters({
    queryText: '',
    productNos: [],
    resourceCds: params.resourceCds,
    assignedOnlyCds: [],
    hasNoteOnly: false,
    hasDueDateOnly: false,
    allowResourceOnly: true,
    locationKey: params.locationKey,
    siteKey: params.siteKey,
  });
  if (filters.kind === 'blocked_empty_search') {
    return {
      scheduleExhausted: true,
      hitScanCap: false,
      scannedRowCount: 0,
      maxRows: scanCap,
    };
  }

  const { baseWhere, queryWhere, siteScopedGlobalRankLocation } = filters;
  let offset = 0;
  let scannedRowCount = 0;
  let scheduleExhausted = false;
  let lastPageWasFull = false;

  while (scannedRowCount < scanCap) {
    const remaining = scanCap - scannedRowCount;
    const limit = Math.min(safePageSize, remaining);
    const pageRows = await fetchProductionScheduleDashboardRowsRawPage({
      baseWhere,
      queryWhere,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation,
      offset,
      limit,
    });
    if (pageRows.length === 0) {
      scheduleExhausted = true;
      lastPageWasFull = false;
      break;
    }

    await onPage(mapSignageAutoTargetSelectorScheduleRows(pageRows));
    scannedRowCount += pageRows.length;
    offset += pageRows.length;
    lastPageWasFull = pageRows.length === limit;

    if (pageRows.length < limit) {
      scheduleExhausted = true;
      break;
    }
    if (scannedRowCount >= scanCap) {
      break;
    }
  }

  let hitScanCap = false;
  if (!scheduleExhausted && scannedRowCount >= scanCap && lastPageWasFull) {
    const probeRows = await fetchProductionScheduleDashboardRowsRawPage({
      baseWhere,
      queryWhere,
      locationKey: params.locationKey,
      siteScopedGlobalRankLocation,
      offset,
      limit: 1,
    });
    if (probeRows.length > 0) {
      hitScanCap = true;
    } else {
      scheduleExhausted = true;
    }
  }

  return {
    scheduleExhausted,
    hitScanCap,
    scannedRowCount,
    maxRows: scanCap,
  };
}

/** auto 候補選定に必要な rowDecorations のみ（顧客名・フッタチップ・実績時間を省略） */
export async function decorateRowsForSelfInspectionMachineTargetSelector(params: {
  rows: SignageAutoTargetSelectorScheduleRow[];
  locationKey: string;
  siteKey?: string;
  decorationCache: SelfInspectionDecorationCache;
}): Promise<SelfInspectionMachineTargetSelectorRowDecoration[]> {
  if (params.rows.length === 0) {
    return [];
  }

  const productionRows: ProductionScheduleRow[] = params.rows.map((row) => ({
    ...row,
    actualPerPieceMinutes: null,
    customerName: null,
  }));

  await ensureSelfInspectionTemplatesForRows(params.decorationCache, productionRows);
  await ensureSelfInspectionSessionsInCache(
    params.decorationCache,
    productionRows.map((row) => row.id)
  );
  const withSelfInspection = await enrichProductionScheduleRowsForSelfInspectionCandidate(
    productionRows,
    params.locationKey,
    params.siteKey,
    params.decorationCache
  );
  const withMachineName = await enrichProductionScheduleRowsWithResolvedMachineName(
    withSelfInspection.map((row) => ({
      ...row,
      actualPerPieceMinutes: null,
      customerName: null,
    }))
  );

  return withMachineName.map((row) => ({
    id: row.id,
    resolvedMachineName: row.resolvedMachineName ?? null,
    hasSelfInspectionDrawing: row.hasSelfInspectionDrawing ?? false,
    selfInspectionStatus: row.selfInspectionStatus ?? null,
  }));
}

/** サイネージ自主検査ボード向け: total count / 実績時間 / 機種名・顧客名補完を省略した軽量一覧 */
export async function listProductionScheduleRowsForSignageMachineBoard(params: {
  machineName: string;
  locationKey: string;
  siteKey?: string;
  maxRows: number;
  pageSize?: number;
  /** テスト用。省略時は SIGNAGE_MACHINE_BOARD_SCHEDULE_MAX_SCAN_PAGES */
  maxScanPages?: number;
}): Promise<SignageMachineBoardScheduleFetchResult> {
  const rows: SignageMachineBoardScheduleRow[] = [];
  const meta = await scanProductionScheduleRowsForSignageMachineBoard(params, (pageRows) => {
    rows.push(...pageRows);
  });

  return {
    rows,
    ...meta,
  };
}

export async function listProductionScheduleRows(params: ProductionScheduleListParams): Promise<ProductionScheduleListResult> {
  if (params.selfInspectionEligibleOnly) {
    return listSelfInspectionEligibleProductionScheduleRows(toSelfInspectionEligibleListParams(params));
  }

  const {
    page,
    pageSize,
    queryText,
    productNos,
    machineName,
    resourceCds,
    assignedOnlyCds,
    resourceCategory,
    hasNoteOnly,
    hasDueDateOnly,
    allowResourceOnly = false,
    locationKey,
    siteKey,
    responseProfile = 'full'
  } = params;
  const isLeaderboardProfile = responseProfile === 'leaderboard';

  const filters = await prepareProductionScheduleDashboardFilters({
    queryText,
    productNos,
    machineName,
    resourceCds,
    assignedOnlyCds,
    resourceCategory,
    hasNoteOnly,
    hasDueDateOnly,
    allowResourceOnly,
    locationKey,
    siteKey
  });

  if (filters.kind === 'blocked_empty_search') {
    return {
      page,
      pageSize,
      total: 0,
      rows: []
    };
  }

  const { baseWhere, queryWhere, leaderboardExpansionWhere, siteScopedGlobalRankLocation } = filters;

  const offset = (page - 1) * pageSize;

  const leaderboardMaterializedBaseWhere = isLeaderboardProfile
    ? await resolveLeaderboardMaterializedBaseWhere(prisma)
    : null;

  const leaderboardCountParams = {
    baseWhere: leaderboardMaterializedBaseWhere ?? baseWhere,
    queryWhere,
    hasDueDateOnly,
    processChangeResidualMode: params.processChangeResidualMode,
    processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
  };

  const totalPromise = isLeaderboardProfile
    ? countProductionScheduleDashboardVisibleLeaderboardUnits(leaderboardCountParams)
    : countProductionScheduleDashboardVisibleRows({
        baseWhere,
        queryWhere,
        processChangeResidualMode: params.processChangeResidualMode,
        processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
      });

  if (isLeaderboardProfile) {
    const leaderboardRowsPromise = fetchLeaderboardScheduleRowsWithSeibanAwarePriority({
      leaderboardMaterializedBaseWhere: leaderboardMaterializedBaseWhere!,
      queryWhere,
      expansionWhere: leaderboardExpansionWhere,
      locationKey,
      siteScopedGlobalRankLocation,
      pageSize,
      seibanExpansion: shouldExpandLeaderboardSeibanAcrossResources(resourceCds),
      processChangeResidualMode: params.processChangeResidualMode,
      processChangeResidualStrongEvidenceKeys: params.processChangeResidualStrongEvidenceKeys
    }).then(async (rawRows) =>
      expandLeaderboardParentRowsForResponse({
        rows: rawRows.map(
          (r): ProductionScheduleRow => ({
            ...r,
            actualPerPieceMinutes: null,
            customerName: null
          })
        ),
        locationKey,
        hasDueDateOnly
      })
    );

    const [totalBig, leaderboardRows] = await Promise.all([totalPromise, leaderboardRowsPromise]);

    return enrichLeaderboardListRowsAndFooter({
      page,
      pageSize,
      total: Number(totalBig),
      rows: leaderboardRows,
      locationKey,
      siteKey
    });
  }

  const rowsPromiseFull = fetchProductionScheduleDashboardRowsRawPage({
    baseWhere,
    queryWhere,
    locationKey,
    siteScopedGlobalRankLocation,
    offset,
    limit: pageSize
  });

  const [totalBig, fullRows] = await Promise.all([totalPromise, rowsPromiseFull]);
  const total = Number(totalBig);

  const rowResourceCds = fullRows
    .map((row) => {
      const rowData = (row.rowData ?? {}) as Record<string, unknown>;
      return typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    })
    .filter((resourceCd) => resourceCd.length > 0);
  const actualHoursReadContext = await loadActualHoursReadContext({
    locationKey,
    resourceCds: rowResourceCds
  });

  const rowsWithActualHours = fullRows.map((row) => {
    const rowData = (row.rowData ?? {}) as Record<string, unknown>;
    const fhincd = typeof rowData.FHINCD === 'string' ? rowData.FHINCD.trim() : '';
    const resourceCd = typeof rowData.FSIGENCD === 'string' ? rowData.FSIGENCD.trim() : '';
    const perPieceMinutes = actualHoursReadContext.resolver.resolve({ fhincd, resourceCd }).perPieceMinutes;
    return {
      ...row,
      actualPerPieceMinutes: perPieceMinutes
    };
  });
  const rowsWithResolvedMachineName = await enrichProductionScheduleRowsWithResolvedMachineName(rowsWithActualHours);
  const enrichedRows = await enrichProductionScheduleRowsWithCustomerName(rowsWithResolvedMachineName);

  return {
    page,
    pageSize,
    total,
    rows: enrichedRows
  };
}

export type ProductionScheduleOrderSearchParams = {
  locationKey: string;
  siteKey?: string;
  resourceCds: string[];
  resourceCategory?: ProductionScheduleResourceCategory;
  machineName?: string;
  productNoPrefix: string;
  partName?: string;
};

export type ProductionScheduleOrderSearchResult = {
  partNameOptions: string[];
  orders: string[];
};

export async function searchProductionScheduleOrders(
  params: ProductionScheduleOrderSearchParams
): Promise<ProductionScheduleOrderSearchResult> {
  const {
    locationKey,
    siteKey,
    resourceCds,
    resourceCategory,
    machineName,
    productNoPrefix,
    partName
  } = params;
  const resourceCategoryPolicy = await getResourceCategoryPolicy({
    siteKey,
    deviceScopeKey: locationKey
  });
  const filteredResourceCds = filterProductionScheduleResourceCdsByCategoryWithPolicy(
    resourceCds,
    resourceCategory,
    resourceCategoryPolicy
  );
  const resourceConditions = buildResourceConditions({
    resourceCds: filteredResourceCds,
    assignedOnlyCds: [],
    locationKey
  });
  const resourceCategoryCondition = buildResourceCategoryCondition(resourceCategory, resourceCategoryPolicy);
  const machineNameCondition = await buildMachineNameCondition(machineName);
  const partNameCondition =
    typeof partName === 'string' && partName.trim().length > 0
      ? Prisma.sql`AND ("CsvDashboardRow"."rowData"->>'FHINMEI') = ${partName.trim()}`
      : Prisma.empty;

  const resourceWhere =
    resourceConditions.length > 0
      ? Prisma.sql`AND (${Prisma.join(resourceConditions, ' OR ')})`
      : Prisma.empty;

  const rows = await prisma.$queryRaw<Array<{ productNo: string | null; partName: string | null }>>`
    SELECT
      "CsvDashboardRow"."rowData"->>'ProductNo' AS "productNo",
      "CsvDashboardRow"."rowData"->>'FHINMEI' AS "partName"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("CsvDashboardRow"."rowData"->>'ProductNo') IS NOT NULL
      AND ("CsvDashboardRow"."rowData"->>'ProductNo') LIKE ${`${productNoPrefix}%`}
      AND (
        UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'MH%'
        AND UPPER(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')) NOT LIKE 'SH%'
      )
      ${resourceWhere}
      ${resourceCategoryCondition}
      ${machineNameCondition}
      ${partNameCondition}
    ORDER BY ("CsvDashboardRow"."rowData"->>'ProductNo') ASC
  `;

  const partNameMap = new Map<string, string>();
  rows.forEach((row) => {
    const currentPartName = String(row.partName ?? '').trim();
    if (currentPartName.length === 0) return;
    const key = normalizeMachineNameForCompare(currentPartName);
    if (!partNameMap.has(key)) {
      partNameMap.set(key, currentPartName);
    }
  });
  const partNameOptions = Array.from(partNameMap.values()).sort((a, b) => a.localeCompare(b, 'ja'));

  const orders =
    typeof partName === 'string' && partName.trim().length > 0
      ? rows
          .map((row) => String(row.productNo ?? '').trim())
          .filter((value) => value.length > 0)
      : [];

  return {
    partNameOptions,
    orders
  };
}

export type ProductionScheduleResourceListResult = {
  resources: string[];
  resourceItems: Array<{
    resourceCd: string;
    excluded: boolean;
  }>;
  resourceNameMap: ProductionScheduleResourceNameMap;
};

export async function listProductionScheduleResources(scope: {
  siteKey?: string;
  deviceScopeKey?: string;
}): Promise<ProductionScheduleResourceListResult> {
  const resources = await prisma.$queryRaw<Array<{ resourceCd: string }>>`
    SELECT DISTINCT ("rowData"->>'FSIGENCD') AS "resourceCd"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("rowData"->>'FSIGENCD') IS NOT NULL
      AND ("rowData"->>'FSIGENCD') <> ''
    ORDER BY ("rowData"->>'FSIGENCD') ASC
  `;
  const resourceCds = resources.map((row) => row.resourceCd);
  const policy = await getResourceCategoryPolicy(scope);
  const resourceNameMap = await getResourceNameMapByResourceCds(resourceCds);
  const resourceItems = resourceCds.map((resourceCd) => ({
    resourceCd,
    excluded: isProductionScheduleExcludedCuttingResourceCd(resourceCd, policy)
  }));
  return {
    resources: resourceCds,
    resourceItems,
    resourceNameMap
  };
}

export async function getProductionScheduleOrderUsage(
  params: ProductionScheduleOrderUsageParams
): Promise<Record<string, number[]>> {
  const { locationKey, resourceCds } = params;
  const resourceCdFilter =
    resourceCds.length > 0
      ? Prisma.sql`AND "resourceCd" IN (${Prisma.join(
          resourceCds.map((cd) => Prisma.sql`${cd}`),
          ','
        )})`
      : Prisma.empty;
  const splitAssignmentUnion = Prisma.sql`
      UNION ALL
      SELECT
        "resourceCd",
        "orderNumber"
      FROM "ProductionScheduleOrderSplitAssignment"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND (
          "location" = ${locationKey}
          OR "siteKey" = ${locationKey}
        )
        ${resourceCdFilter}
    `;

  const usageRows = await prisma.$queryRaw<Array<{ resourceCd: string; orderNumbers: number[] }>>`
    WITH scoped AS (
      SELECT
        "resourceCd",
        "orderNumber"
      FROM "ProductionScheduleOrderAssignment"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND (
          "location" = ${locationKey}
          OR "siteKey" = ${locationKey}
        )
        ${resourceCdFilter}
      ${splitAssignmentUnion}
    )
    SELECT
      "resourceCd" AS "resourceCd",
      array_agg(DISTINCT "orderNumber" ORDER BY "orderNumber") AS "orderNumbers"
    FROM scoped
    GROUP BY "resourceCd"
  `;

  return usageRows.reduce<Record<string, number[]>>((acc, row) => {
    acc[row.resourceCd] = row.orderNumbers ?? [];
    return acc;
  }, {});
}
