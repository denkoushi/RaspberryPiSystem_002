import { type ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import type { GrindingPlanningBoardCategory, GrindingPlanningBoardItem, GrindingPlanningBoardLoad, GrindingPlanningBoardLoadResponse, GrindingPlanningBoardResponse, GrindingPlanningBoardView } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { createGrindingPlanningBoardPerformance } from '../grinding-planning-board-performance.js';
import type { LeaderboardShellSnapshotStore } from '../leaderboard/leaderboard-shell-snapshot.store.js';
import { findMaterialArrivalStatusByPart, materialArrivalLookupKey } from '../../purchase-order-lookup/material-arrival-status.service.js';
import { getResourceCategoryPolicy, isProductionScheduleGrindingResourceCd } from '../policies/resource-category-policy.service.js';
import { isProductionScheduleOrderSplitEnabled } from '../order-split/production-schedule-order-split-feature.js';
import { projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
import { resolveLeaderboardMaterializedBaseWhereWithGenerationCache } from '../leaderboard/leaderboard-materialized-winner-cache.js';
import { readGrindingPlanningBoardLoadSummary } from '../grinding-planning-board-load-summary.js';
import { resolveSeibanMachineDisplayNamesBatched } from '../seiban-machine-display-names.service.js';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, asRowData, isCategoryResource, progressMapToRecord, type DbClient, type PlanningSnapshotPayload, type PlanningSource, type PlanningState, type ReusablePlanningPayload, type RowDetail, type WinnerRow, uniqueFseibans, valueAsString } from './shared.js';
import { readOverrides, readPlanningResourceCandidates, readPlanningSource, readRanks } from './source.js';
import { MAX_REUSABLE_PLANNING_PAYLOADS, REUSABLE_PLANNING_PAYLOAD_TTL_MS, boardRevision, fallbackPlanningSnapshotStore, getOrCreateState, isPlanningSnapshotPayload, isPlanningStateAlignedWithGeneration, readPlanningSnapshotGenerationDetails, readPlanningSnapshotGenerationToken, reusablePlanningPayloads, stateOrder } from './state.js';


async function projectCurrentBoard(params: { client: DbClient; siteKey: string; category: GrindingPlanningBoardCategory; view: GrindingPlanningBoardView; state: PlanningState; selectedFseibans?: ReadonlySet<string>; machineNames?: ReadonlyMap<string, string | null>; source?: PlanningSource }): Promise<{ allItems: GrindingPlanningBoardItem[]; items: GrindingPlanningBoardItem[]; load: GrindingPlanningBoardLoad[]; unknownRequiredMinutesCount: number; progress: ReturnType<typeof projectGrindingPlanningBoard>['progress']; policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>; overrides: Map<string, ProductionScheduleGrindingPlanningBoardOverride>; sourceRows: WinnerRow[]; details: Map<string, RowDetail> }> {
  const source = params.source ?? await readPlanningSource({
    siteKey: params.siteKey,
    category: params.category,
    fseibans: stateOrder(params.state)
  });
  const [policy, overrides] = await Promise.all([getResourceCategoryPolicy({ siteKey: params.siteKey }), readOverrides(params.client, params.siteKey)]);
  const rows = source.rows;
  const details = source.details;
  const displayRowIds = rows.filter((row) => {
    if (!params.selectedFseibans) return true;
    return params.selectedFseibans.has(valueAsString(asRowData(row.rowData), 'FSEIBAN'));
  }).map((row) => row.id);
  const splitIds = displayRowIds.flatMap((rowId) => details.get(rowId)?.orderSplits.map((split) => split.id) ?? []);
  const ranks = await readRanks(params.client, displayRowIds, splitIds, params.siteKey);
  const projection = projectGrindingPlanningBoard({ rows, details, ranks, overrides, progressRows: source.progressRows, splitEnabled: isProductionScheduleOrderSplitEnabled(), category: params.category, view: params.view, seibanOrder: stateOrder(params.state), selectedFseibans: params.selectedFseibans, machineNameBySeiban: params.machineNames, isResourceInCategory: (resourceCd, category) => isCategoryResource(resourceCd, category, policy) });
  return { allItems: projection.allItems, items: projection.items, load: projection.load, unknownRequiredMinutesCount: projection.unknownRequiredMinutesCount, progress: projection.progress, policy, overrides, sourceRows: rows, details };
}

export async function getGrindingPlanningBoard(params: { siteKey: string; category: GrindingPlanningBoardCategory; view: GrindingPlanningBoardView; fseibans?: string[]; cursor?: number; pageSize?: number; snapshotId?: string; completionFilter?: 'all' | 'complete' | 'incomplete'; includeLoad?: boolean; snapshotStore?: LeaderboardShellSnapshotStore }): Promise<GrindingPlanningBoardResponse> {
  if ((params.cursor ?? 0) > 0 && !params.snapshotId) throw new ApiError(400, '続きの cursor には snapshotId が必要です', undefined, 'INVALID_PLANNING_BOARD_CURSOR');
  // Capture the state returned by the ensure/read and then compare it with the
  // state fields in the generation token. A final token after the source/load
  // work still rejects CSV, state, or override updates during the request.
  const perf = createGrindingPlanningBoardPerformance('grinding-planning-board');
  const stateForRead = await perf.measure('state', () => getOrCreateState(params.siteKey, [], prisma));
  const generationBeforeRead = await perf.measure('generationBefore', () => readPlanningSnapshotGenerationDetails(params.siteKey));
  if (!isPlanningStateAlignedWithGeneration(stateForRead, generationBeforeRead)) {
    throw new ApiError(409, '一覧の元データが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_SNAPSHOT');
  }
  const order = stateOrder(stateForRead);
  const requested = params.fseibans && params.fseibans.length > 0 ? new Set(uniqueFseibans(params.fseibans)) : undefined;
  const selected = requested ? order.filter((value) => requested.has(value)) : order;
  const completionFilter = params.completionFilter ?? 'all';
  const includeLoad = params.includeLoad !== false;
  const filterFingerprint = JSON.stringify({ siteKey: params.siteKey, category: params.category, view: params.view, fseibans: selected, completionFilter, includeLoad });
  const store = params.snapshotStore ?? fallbackPlanningSnapshotStore;
  let reusablePayloads = reusablePlanningPayloads.get(store);
  if (!reusablePayloads) {
    reusablePayloads = new Map();
    reusablePlanningPayloads.set(store, reusablePayloads);
  }
  let snapshotId = params.snapshotId ?? '';
  let reusablePayload: ReusablePlanningPayload | undefined;
  if (!snapshotId) {
    const candidate = reusablePayloads.get(filterFingerprint);
    if (candidate && candidate.siteKey === params.siteKey && candidate.expiresAtMs > Date.now() &&
      candidate.generationToken === generationBeforeRead.generationToken) {
      const generation = await perf.measure('generationSnapshot', () => readPlanningSnapshotGenerationToken(params.siteKey));
      if (candidate.generationToken === generation) reusablePayload = candidate;
    }
    if (!reusablePayload) reusablePayloads.delete(filterFingerprint);
  }
  let orderedIds: readonly string[];
  let payload: PlanningSnapshotPayload;
  if (snapshotId) {
    const snapshot = store.get(snapshotId);
    const sameScope = snapshot != null && snapshot.siteKey === params.siteKey && snapshot.locationKey === params.siteKey && snapshot.filterFingerprint === filterFingerprint;
    const generation = await perf.measure('generationSnapshot', () => readPlanningSnapshotGenerationToken(params.siteKey));
    if (!snapshot || !sameScope || snapshot.generationToken !== generationBeforeRead.generationToken || snapshot.generationToken !== generation || snapshot.partialOrdering || !isPlanningSnapshotPayload(snapshot.payload)) {
      // A binding mismatch may refer to another terminal/site/filter. Do not
      // let one caller delete a valid snapshot owned by that scope.
      if (sameScope) store.delete(snapshotId);
      throw new ApiError(409, '一覧が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_SNAPSHOT');
    }
    orderedIds = snapshot.orderedRowIds;
    payload = snapshot.payload;
  } else if (reusablePayload) {
    orderedIds = reusablePayload.orderedRowIds;
    payload = reusablePayload.payload;
  } else {
    const source = await perf.measure('source', () => readPlanningSource({
      siteKey: params.siteKey,
      category: params.category,
      fseibans: selected,
      leaderboardGenerationToken: generationBeforeRead.leaderboardGenerationToken
    }));
    const names = await perf.measure('machineNames', () => resolveSeibanMachineDisplayNamesBatched(order));
    const projection = await perf.measure('projection', () => projectCurrentBoard({ client: prisma, siteKey: params.siteKey, category: params.category, view: params.view, state: stateForRead, selectedFseibans: new Set(selected), machineNames: new Map(Object.entries(names.machineNames)), source }));
    const filtered = completionFilter === 'complete' ? projection.items.filter((item) => item.isCompleted) : completionFilter === 'incomplete' ? projection.items.filter((item) => !item.isCompleted) : projection.items;
    const loadSummary = includeLoad ? await perf.measure('loadSummary', () => readGrindingPlanningBoardLoadSummary({
      client: prisma,
      leaderboardMaterializedBaseWhere: source.baseWhere,
      siteKey: params.siteKey,
      category: params.category,
      splitEnabled: isProductionScheduleOrderSplitEnabled(),
      isResourceInCategory: (resourceCd, category) => isCategoryResource(resourceCd, category, projection.policy),
      cache: {
        generationToken: generationBeforeRead.generationToken,
        readGenerationToken: () => readPlanningSnapshotGenerationToken(params.siteKey),
        performance: perf
      }
    })) : { load: [], unknownRequiredMinutesCount: 0 };
    const resources = await perf.measure('resources', () => readPlanningResourceCandidates(prisma, params.category, projection.policy));
    const generation = await perf.measure('generationAfter', () => readPlanningSnapshotGenerationToken(params.siteKey));
    if (generation !== generationBeforeRead.generationToken) {
      throw new ApiError(409, '一覧の元データが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_SNAPSHOT');
    }
    orderedIds = filtered.map((item) => item.itemId);
    payload = {
      items: filtered,
      load: loadSummary.load,
      unknownRequiredMinutesCount: loadSummary.unknownRequiredMinutesCount,
      seibanProgress: progressMapToRecord(projection.progress.bySeiban),
      machineNames: names.machineNames,
      resources,
      resourceCategories: Object.fromEntries([...new Set([...resources, ...filtered.flatMap((item) =>
        [item.originalResourceCd, item.effectiveResourceCd].filter((cd): cd is string => Boolean(cd)))])].map((cd) =>
        [cd, isProductionScheduleGrindingResourceCd(cd, projection.policy) ? 'grinding' : 'cutting']))
    };
  }
  if (!params.snapshotId) {
    // Give every first-page request a full cursor lifetime, even when its
    // payload was reused. Keep previous IDs valid for readers already paging.
    snapshotId = store.create({ orderedRowIds: orderedIds, partialOrdering: false, filterFingerprint, generationToken: generationBeforeRead.generationToken, locationKey: params.siteKey, siteKey: params.siteKey, payload });
    // Refresh recency without extending the completed payload's fixed age.
    reusablePayloads.delete(filterFingerprint);
    reusablePayloads.set(filterFingerprint, reusablePayload ?? {
      siteKey: params.siteKey,
      generationToken: generationBeforeRead.generationToken,
      orderedRowIds: orderedIds,
      payload,
      expiresAtMs: Date.now() + REUSABLE_PLANNING_PAYLOAD_TTL_MS
    });
    if (reusablePayloads.size > MAX_REUSABLE_PLANNING_PAYLOADS) {
      reusablePayloads.delete(reusablePayloads.keys().next().value!);
    }
  }
  if (!payload.resourceCategories) {
    const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
    payload.resourceCategories = Object.fromEntries([...new Set([...payload.resources, ...payload.items.flatMap((item) =>
      [item.originalResourceCd, item.effectiveResourceCd].filter((cd): cd is string => Boolean(cd)))])].map((cd) =>
      [cd, isProductionScheduleGrindingResourceCd(cd, policy) ? 'grinding' : 'cutting']));
  }
  const byId = new Map(payload.items.map((item) => [item.itemId, item]));
  const orderedItems = orderedIds.map((id) => byId.get(id)).filter((item): item is GrindingPlanningBoardItem => item != null);
  const cursor = Math.max(params.cursor ?? 0, 0);
  const pageSize = Math.min(Math.max(params.pageSize ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = orderedItems.slice(cursor, cursor + pageSize);
  // 材料の入荷状況は購買CSVの取込で変わるため、スナップショットや itemRevision に含めず応答のたびに付ける。
  const materialArrivalByPart = await perf.measure('materialArrival', () => findMaterialArrivalStatusByPart(page));
  const pageWithMaterialArrival = page.map((item) => {
    const arrival = materialArrivalByPart.get(materialArrivalLookupKey(item.fseiban, item.fhincd));
    return arrival
      ? {
          ...item,
          materialArrivalStatus: arrival.status,
          ...(arrival.basis === 'part' ? { materialArrivalBasis: arrival.basis } : {})
        }
      : item;
  });
  perf.flush({ snapshotReused: Boolean(params.snapshotId), itemCount: orderedItems.length, fseibanCount: selected.length });
  return {
    siteKey: params.siteKey,
    category: params.category,
    view: params.view,
    sourceRevision: boardRevision(stateForRead),
    boardVersion: stateForRead.version,
    registeredFseibans: order,
    seibanOrder: selected,
    resources: payload.resources,
    resourceCategories: payload.resourceCategories,
    items: pageWithMaterialArrival,
    ...(includeLoad ? {} : { loadDeferred: true }),
    load: payload.load,
    unknownRequiredMinutesCount: payload.unknownRequiredMinutesCount,
    seibanProgress: payload.seibanProgress,
    machineNames: payload.machineNames ?? {},
    snapshotId,
    nextCursor: cursor + page.length < orderedItems.length ? String(cursor + page.length) : null
  };
}

export async function getGrindingPlanningBoardLoad(params: {
  siteKey: string;
  category: GrindingPlanningBoardCategory;
}): Promise<GrindingPlanningBoardLoadResponse> {
  const perf = createGrindingPlanningBoardPerformance('grinding-planning-board/load');
  const generationBeforeRead = await perf.measure('generationBefore', () => readPlanningSnapshotGenerationDetails(params.siteKey));
  const generationBefore = generationBeforeRead.generationToken;
  const [baseWhere, policy] = await perf.measure('baseWhereAndPolicy', () => Promise.all([
    resolveLeaderboardMaterializedBaseWhereWithGenerationCache(prisma, { generationToken: generationBeforeRead.leaderboardGenerationToken }),
    getResourceCategoryPolicy({ siteKey: params.siteKey })
  ]));
  const summary = await perf.measure('loadSummary', () => readGrindingPlanningBoardLoadSummary({
    client: prisma,
    leaderboardMaterializedBaseWhere: baseWhere,
    siteKey: params.siteKey,
    category: params.category,
    splitEnabled: isProductionScheduleOrderSplitEnabled(),
    isResourceInCategory: (resourceCd, category) => isCategoryResource(resourceCd, category, policy),
    cache: {
      generationToken: generationBefore,
      readGenerationToken: () => readPlanningSnapshotGenerationToken(params.siteKey),
      performance: perf
    }
  }));
  const generationAfter = await perf.measure('generationAfter', () => readPlanningSnapshotGenerationToken(params.siteKey));
  if (generationBefore !== generationAfter) {
    throw new ApiError(409, '一覧の元データが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_SNAPSHOT');
  }
  perf.flush();
  return summary;
}
