import { type ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import type { GrindingPlanningBoardCategory, GrindingPlanningBoardItem, GrindingPlanningBoardLoad, GrindingPlanningBoardLoadResponse, GrindingPlanningBoardResponse, GrindingPlanningBoardView } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
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

type PlanningPayloadRequest = { siteKey: string; category: GrindingPlanningBoardCategory; view: GrindingPlanningBoardView; fseibans?: string[]; completionFilter?: 'all' | 'complete' | 'incomplete'; includeLoad?: boolean; snapshotStore?: LeaderboardShellSnapshotStore };
type PlanningPayloadBuild = { orderedIds: readonly string[]; payload: PlanningSnapshotPayload; generationToken: string };
const inFlightPlanningPayloads = new WeakMap<LeaderboardShellSnapshotStore, Map<string, Promise<PlanningPayloadBuild>>>();

async function preparePlanningPayload(params: PlanningPayloadRequest, perf: ReturnType<typeof createGrindingPlanningBoardPerformance>) {
  // Capture the state returned by the ensure/read and then compare it with the
  // state fields in the generation token. A final token after the source/load
  // work still rejects CSV, state, or override updates during the request.
  const stateForRead = await perf.measure('state', () => getOrCreateState(params.siteKey, [], prisma));
  const generationBeforeRead = await perf.measure('generationBefore', () => readPlanningSnapshotGenerationDetails(params.siteKey));
  if (!isPlanningStateAlignedWithGeneration(stateForRead, generationBeforeRead)) {
    throw new ApiError(409, '一覧の元データが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_SNAPSHOT');
  }
  const order = stateOrder(stateForRead);
  const requestedFseibans = params.fseibans && params.fseibans.length > 0 ? uniqueFseibans(params.fseibans) : undefined;
  const requested = requestedFseibans ? new Set(requestedFseibans) : undefined;
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
  const request: ReusablePlanningPayload['request'] = { category: params.category, view: params.view, requestedFseibans, completionFilter, includeLoad };
  return { params, perf, stateForRead, generationBeforeRead, order, selected, completionFilter, includeLoad, filterFingerprint, store, reusablePayloads, request };
}

type PlanningPayloadContext = Awaited<ReturnType<typeof preparePlanningPayload>>;

async function findReusablePlanningPayload(context: PlanningPayloadContext): Promise<ReusablePlanningPayload | undefined> {
  const { params, perf, reusablePayloads, filterFingerprint, generationBeforeRead } = context;
  const candidate = reusablePayloads.get(filterFingerprint);
  if (candidate && candidate.siteKey === params.siteKey && candidate.expiresAtMs > Date.now() &&
    candidate.generationToken === generationBeforeRead.generationToken) {
    const generation = await perf.measure('generationSnapshot', () => readPlanningSnapshotGenerationToken(params.siteKey));
    if (candidate.generationToken === generation) return candidate;
  }
  return undefined;
}

async function buildPlanningPayload(context: PlanningPayloadContext): Promise<{ orderedIds: readonly string[]; payload: PlanningSnapshotPayload }> {
  const { params, perf, stateForRead, generationBeforeRead, order, selected, completionFilter, includeLoad } = context;
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
  const orderedIds = filtered.map((item) => item.itemId);
  const payload: PlanningSnapshotPayload = {
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
  return { orderedIds, payload };
}

function retainPlanningPayload(entries: Map<string, ReusablePlanningPayload>, key: string, entry: ReusablePlanningPayload): void {
  entries.delete(key);
  entries.set(key, entry);
  if (entries.size > MAX_REUSABLE_PLANNING_PAYLOADS) entries.delete(entries.keys().next().value!);
}

async function getOrBuildPlanningPayload(context: PlanningPayloadContext, lastUsedAtMs = Date.now()): Promise<PlanningPayloadBuild> {
  const { store, filterFingerprint, generationBeforeRead, reusablePayloads, params, request } = context;
  const generationToken = generationBeforeRead.generationToken;
  const key = JSON.stringify([filterFingerprint, generationToken]);
  let builds = inFlightPlanningPayloads.get(store);
  if (!builds) {
    builds = new Map();
    inFlightPlanningPayloads.set(store, builds);
  }
  const pending = builds.get(key);
  if (pending) {
    try {
      return await pending;
    } catch {
      // A failed shared build must not prevent this caller from trying once.
    }
  }
  const build = buildPlanningPayload(context).then(({ orderedIds, payload }) => {
    retainPlanningPayload(reusablePayloads, filterFingerprint, {
      siteKey: params.siteKey, generationToken, orderedRowIds: orderedIds, payload, request,
      expiresAtMs: Date.now() + REUSABLE_PLANNING_PAYLOAD_TTL_MS, lastUsedAtMs
    });
    return { orderedIds, payload, generationToken };
  }).finally(() => {
    if (builds.get(key) === build) builds.delete(key);
  });
  builds.set(key, build);
  return build;
}

const MAX_PLANNING_REWARM_ENTRIES = 3;
type PlanningRewarm = { promise: Promise<void>; timer?: ReturnType<typeof setTimeout>; running: boolean; rerun: boolean; finish: () => void };
const planningRewarms = new WeakMap<LeaderboardShellSnapshotStore, Map<string, PlanningRewarm>>();

async function rewarmPlanningPayloads(siteKey: string, store: LeaderboardShellSnapshotStore): Promise<void> {
  const entries = [...(reusablePlanningPayloads.get(store)?.entries() ?? [])]
    .filter(([, entry]) => entry.siteKey === siteKey && entry.expiresAtMs > Date.now())
    .sort((a, b) => b[1].lastUsedAtMs - a[1].lastUsedAtMs)
    .slice(0, MAX_PLANNING_REWARM_ENTRIES);
  for (const [previousFingerprint, entry] of entries) {
    try {
      const { requestedFseibans, ...request } = entry.request;
      const context = await preparePlanningPayload({ siteKey, ...request, fseibans: requestedFseibans, snapshotStore: store }, createGrindingPlanningBoardPerformance('grinding-planning-board/rewarm'));
      if (!await findReusablePlanningPayload(context)) await getOrBuildPlanningPayload(context, entry.lastUsedAtMs);
      if (previousFingerprint !== context.filterFingerprint && context.reusablePayloads.get(previousFingerprint) === entry) {
        context.reusablePayloads.delete(previousFingerprint);
      }
    } catch (error) {
      logger.debug({ err: error, siteKey }, 'Grinding planning board rewarm failed');
    }
  }
}

export function scheduleGrindingPlanningBoardRewarm(params: { siteKey: string; snapshotStore?: LeaderboardShellSnapshotStore; delayMs?: number }): Promise<void> {
  const store = params.snapshotStore ?? fallbackPlanningSnapshotStore;
  let sites = planningRewarms.get(store);
  if (!sites) {
    sites = new Map();
    planningRewarms.set(store, sites);
  }
  const existing = sites.get(params.siteKey);
  if (existing?.running) {
    existing.rerun = true;
    return existing.promise;
  }
  if (existing?.timer) clearTimeout(existing.timer);
  let finish!: () => void;
  const pending = existing ?? { promise: new Promise<void>((resolve) => { finish = resolve; }), running: false, rerun: false, finish };
  // A rescheduled timer uses the same completion promise, including follow-up runs.
  const run = async () => {
    pending.running = true;
    try {
      do {
        pending.rerun = false;
        await rewarmPlanningPayloads(params.siteKey, store);
      } while (pending.rerun);
    } catch (error) {
      logger.debug({ err: error, siteKey: params.siteKey }, 'Grinding planning board rewarm failed');
    } finally {
      sites.delete(params.siteKey);
      pending.finish();
    }
  };
  pending.timer = setTimeout(() => { void run(); }, params.delayMs ?? 200);
  sites.set(params.siteKey, pending);
  return pending.promise;
}

async function findPlacementByProductNo(items: readonly GrindingPlanningBoardItem[]) {
  const productNos = [...new Set(items.map((item) => item.productNo.trim()).filter(Boolean))];
  const placements = new Map<string, NonNullable<GrindingPlanningBoardItem['placement']>>();
  if (!productNos.length) return placements;
  const states = await prisma.orderPlacementBranchState.findMany({
    where: { slipKind: 'manufacturing_order', manufacturingOrderBarcodeRaw: { in: productNos } },
    select: { manufacturingOrderBarcodeRaw: true, shelfCodeRaw: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' }
  });
  if (!states.length) return placements;
  const shelves = await prisma.mobilePlacementShelf.findMany({
    where: { shelfCodeRaw: { in: [...new Set(states.map((state) => state.shelfCodeRaw))] } },
    select: { shelfCodeRaw: true, displayLabel: true }
  });
  const labels = new Map(shelves.map((shelf) => [shelf.shelfCodeRaw, shelf.displayLabel]));
  for (const state of states) {
    const placement = placements.get(state.manufacturingOrderBarcodeRaw) ?? { shelves: [] };
    if (!placement.shelves.some((shelf) => shelf.shelfCodeRaw === state.shelfCodeRaw)) {
      placement.shelves.push({ shelfCodeRaw: state.shelfCodeRaw, label: labels.get(state.shelfCodeRaw) || state.shelfCodeRaw,
        placedAt: state.updatedAt.toISOString() });
    }
    placements.set(state.manufacturingOrderBarcodeRaw, placement);
  }
  return placements;
}

export async function getGrindingPlanningBoard(params: { siteKey: string; category: GrindingPlanningBoardCategory; view: GrindingPlanningBoardView; fseibans?: string[]; cursor?: number; pageSize?: number; snapshotId?: string; completionFilter?: 'all' | 'complete' | 'incomplete'; includeLoad?: boolean; snapshotStore?: LeaderboardShellSnapshotStore }): Promise<GrindingPlanningBoardResponse> {
  if ((params.cursor ?? 0) > 0 && !params.snapshotId) throw new ApiError(400, '続きの cursor には snapshotId が必要です', undefined, 'INVALID_PLANNING_BOARD_CURSOR');
  const perf = createGrindingPlanningBoardPerformance('grinding-planning-board');
  const context = await preparePlanningPayload(params, perf);
  const { stateForRead, generationBeforeRead, order, selected, includeLoad, filterFingerprint, store, reusablePayloads } = context;
  let snapshotId = params.snapshotId ?? '';
  let reusablePayload: ReusablePlanningPayload | undefined;
  if (!snapshotId) {
    reusablePayload = await findReusablePlanningPayload(context);
    if (!reusablePayload) reusablePayloads.delete(filterFingerprint);
  }
  let orderedIds: readonly string[];
  let payload: PlanningSnapshotPayload;
  if (snapshotId) {
    const snapshot = store.get(snapshotId);
    const sameScope = snapshot != null && snapshot.siteKey === params.siteKey && snapshot.locationKey === params.siteKey && snapshot.filterFingerprint === filterFingerprint;
    const generation = generationBeforeRead.generationToken;
    if (!snapshot || !sameScope || snapshot.generationToken !== generation || snapshot.partialOrdering || !isPlanningSnapshotPayload(snapshot.payload)) {
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
    ({ orderedIds, payload } = await getOrBuildPlanningPayload(context));
  }
  if (!params.snapshotId) {
    // Give every first-page request a full cursor lifetime, even when its
    // payload was reused. Keep previous IDs valid for readers already paging.
    snapshotId = store.create({ orderedRowIds: orderedIds, partialOrdering: false, filterFingerprint, generationToken: generationBeforeRead.generationToken, locationKey: params.siteKey, siteKey: params.siteKey, payload });
    // Refresh recency without extending the completed payload's fixed age.
    const completed = reusablePayloads.get(filterFingerprint);
    if (completed?.generationToken === generationBeforeRead.generationToken) {
      completed.lastUsedAtMs = Date.now();
      completed.request = context.request;
      retainPlanningPayload(reusablePayloads, filterFingerprint, completed);
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
  // 配膳先も随時変わるため、保存済みの projection を変更せず応答にだけ付ける。
  const placementByProductNo = await perf.measure('placement', () => findPlacementByProductNo(page));
  const pageWithMaterialArrival = page.map((item) => {
    const arrival = materialArrivalByPart.get(materialArrivalLookupKey(item.fseiban, item.fhincd));
    const placement = placementByProductNo.get(item.productNo.trim());
    return {
      ...item,
      ...(arrival ? { materialArrivalStatus: arrival.status,
        ...(arrival.basis === 'part' ? { materialArrivalBasis: arrival.basis } : {}) } : {}),
      ...(placement ? { placement } : {})
    };
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
