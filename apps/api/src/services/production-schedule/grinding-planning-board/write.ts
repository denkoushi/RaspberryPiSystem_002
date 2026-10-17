import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import type { GrindingPlanningBoardCategory, GrindingPlanningBoardItem, GrindingPlanningBoardOverridesResponse, GrindingPlanningBoardRankResponse, GrindingPlanningBoardResourceOrderRequest, GrindingPlanningBoardResourceOrderBulkRequest, GrindingPlanningBoardResourceOrderResponse } from '@raspi-system/shared-types';
import { KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { getResourceCategoryPolicy, isProductionScheduleGrindingResourceCd, normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { isProductionScheduleOrderSplitEnabled } from '../order-split/production-schedule-order-split-feature.js';
import { acquireProductionScheduleParentRowLockInTransaction } from '../order-split/production-schedule-parent-row-lock.service.js';
import { projectGrindingPlanningBoard, buildGrindingPlanningBoardRowItemId, resolveGrindingPlanningBoardParentDueDate, sortGrindingPlanningBoardProjectionItems, type GrindingPlanningBoardProgressRow } from '../grinding-planning-board-projection.js';
import { buildWorkCalendarModeMap, listLoadBalancingWorkCalendarsResolved } from '../load-balancing/load-balancing-settings.service.js';
import { DEFAULT_WORK_CALENDAR_MODE, type WorkCalendarMode } from '../load-balancing/work-calendar-policy.js';
import { isGrindingPlanningBoardSpecialDueKind, resolveGrindingPlanningBoardSpecialDueExpiresAt } from '../grinding-planning-board-special-due.js';
import { MAX_ALTERNATE_RANK, SPLIT_PREFIX, asRowData, buildGrindingPlanningBoardLogicalKey, decodeRowItemId, isCategoryResource, logicalKeyFseiban, normalizeUniqueFseibans, resolvePlanningBoardDueRequest, type AppliedOverrides, type CurrentProjection, type OverrideRequest, type PersistedSpecialDue, type PlanningState, type WinnerRow, valueAsString, ymd } from './shared.js';
import { readMasterResourceCds, readOverrides, readRanks, readRowDetails, readWinnerRowsByFseibans, readWinnerRowsByIds, readWinnerRowsByLogicalKeyFseibans } from './source.js';
import { assertBoardRevision, boardRevision, ensurePlanningBoardState, getOrCreateState, lockState, readState, stateOrder } from './state.js';


async function discoverSourceRows(itemIds: readonly string[]): Promise<Map<string, string>> {
  const logicalKeyByItem = new Map<string, string>();
  for (const itemId of itemIds) {
    if (itemId.startsWith(SPLIT_PREFIX)) continue;
    const logicalKey = decodeRowItemId(itemId);
    if (logicalKey == null) throw new ApiError(400, '対象アイテムIDが不正です', undefined, 'INVALID_ITEM_ID');
    logicalKeyByItem.set(itemId, logicalKey);
  }
  // The logical key starts with the raw FSEIBAN, so saves read only the edited seibans instead of every winner row.
  const rows = await readWinnerRowsByLogicalKeyFseibans(prisma, [...logicalKeyByItem.values()].map(logicalKeyFseiban));
  const byLogicalKey = new Map(rows.map((row) => [buildGrindingPlanningBoardLogicalKey(asRowData(row.rowData)), row.id]));
  const splitIds = itemIds.filter((itemId) => itemId.startsWith(SPLIT_PREFIX)).map((itemId) => itemId.slice(SPLIT_PREFIX.length));
  const splits = splitIds.length === 0 ? [] : await prisma.productionScheduleOrderSplit.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, id: { in: splitIds } }, select: { id: true, parentCsvDashboardRowId: true } });
  const sourceByItem = new Map<string, string>();
  for (const itemId of itemIds) {
    if (itemId.startsWith(SPLIT_PREFIX)) {
      const split = splits.find((candidate) => `split:${candidate.id}` === itemId);
      if (split) sourceByItem.set(itemId, split.parentCsvDashboardRowId);
      continue;
    }
    const sourceRowId = byLogicalKey.get(logicalKeyByItem.get(itemId) ?? '');
    if (sourceRowId) sourceByItem.set(itemId, sourceRowId);
  }
  if (sourceByItem.size !== new Set(itemIds).size) throw new ApiError(409, '対象アイテムが消滅または更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  return sourceByItem;
}

async function resolveCurrentProjectionInTransaction(params: { client: Prisma.TransactionClient; siteKey: string; sourceRowIds: readonly string[]; itemIds: readonly string[]; policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>; includeAllOverrides?: boolean; preloaded?: { rows: WinnerRow[]; state: PlanningState; overrides: Map<string, ProductionScheduleGrindingPlanningBoardOverride> } }): Promise<CurrentProjection> {
  const state = params.preloaded?.state ?? await readState(params.client, params.siteKey);
  const rows = params.preloaded?.rows ?? await readWinnerRowsByIds(params.client, params.sourceRowIds);
  const details = await readRowDetails(params.client, rows.map((row) => row.id));
  const splitIds = rows.flatMap((row) => details.get(row.id)?.orderSplits.map((split) => split.id) ?? []);
  const ranks = await readRanks(params.client, rows.map((row) => row.id), splitIds, params.siteKey);
  // Include parent overrides when a split item inherits its parent's due date.
  // The scope writer invalidates the inherited split rank while leaving the
  // split override absent, so projection must see both keys together.
  const parentItemIds = rows.map((row) => buildGrindingPlanningBoardRowItemId(asRowData(row.rowData)));
  const overrides = params.preloaded?.overrides ?? await readOverrides(
    params.client,
    params.siteKey,
    params.includeAllOverrides ? undefined : [...new Set([...params.itemIds, ...parentItemIds])]
  );
  const masterResourceCds = await readMasterResourceCds(params.client);
  const progressRows: GrindingPlanningBoardProgressRow[] = rows.flatMap((row) => {
    const detail = details.get(row.id);
    if (!detail) return [];
    const data = asRowData(row.rowData);
    const fhincd = valueAsString(data, 'FHINCD').trim().toUpperCase();
    const resourceCd = normalizeProductionScheduleResourceCd(valueAsString(data, 'FSIGENCD'));
    if (fhincd.startsWith('MH') || fhincd.startsWith('SH') || (resourceCd != null && params.policy.cuttingExcludedResourceCds.includes(resourceCd))) return [];
    return [{ rowId: row.id, fseiban: valueAsString(data, 'FSEIBAN'), productNo: valueAsString(data, 'ProductNo'), fhincd: valueAsString(data, 'FHINCD'), isCompleted: Boolean(detail.productionScheduleProgress?.isCompleted || detail.productionScheduleExternalCompletion?.isExternallyCompleted) }];
  });
  const splitEnabled = isProductionScheduleOrderSplitEnabled();
  const common = { rows, details, ranks, overrides, progressRows, splitEnabled, seibanOrder: stateOrder(state), isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => isCategoryResource(resourceCd, category, params.policy) };
  const grinding = projectGrindingPlanningBoard({ ...common, category: 'grinding' });
  const cutting = projectGrindingPlanningBoard({ ...common, category: 'cutting' });
  const byItemId = new Map<string, GrindingPlanningBoardItem>();
  for (const item of [...grinding.allItems, ...cutting.allItems]) byItemId.set(item.itemId, item);
  const parentEffectiveDueBySourceRow = new Map<string, string | null>();
  const splitOriginalDueByItemId = new Map<string, string | null>();
  for (const row of rows) {
    const detail = details.get(row.id);
    if (!detail) continue;
    const parentItemId = buildGrindingPlanningBoardRowItemId(asRowData(row.rowData));
    parentEffectiveDueBySourceRow.set(row.id, resolveGrindingPlanningBoardParentDueDate({
      originalParentDueDate: detail.rowNotes[0]?.dueDate ?? detail.orderSupplements[0]?.plannedEndDate ?? null,
      plannedEndDate: detail.orderSupplements[0]?.plannedEndDate ?? null,
      override: overrides.get(parentItemId)
    }));
    for (const split of detail.orderSplits) splitOriginalDueByItemId.set(`${SPLIT_PREFIX}${split.id}`, ymd(split.dueDate));
  }
  for (const itemId of params.itemIds) {
    const item = byItemId.get(itemId);
    if (!item) throw new ApiError(409, '対象アイテムが消滅または工程区分が変わりました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
    if (!params.sourceRowIds.includes(item.sourceRowId)) throw new ApiError(409, 'CSVの勝者行が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  }
  return { state, byItemId, overrides, rows, details, ranks, progressRows, splitEnabled, policy: params.policy, sourceRowIds: new Map(), masterResourceCds, parentEffectiveDueBySourceRow, splitOriginalDueByItemId };
}

function assertItemRevision(expected: string, item: GrindingPlanningBoardItem, expectedVersion?: number): void {
  if (expected !== item.itemRevision || (expectedVersion != null && expectedVersion !== item.version)) throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
}

function sameDate(a: Date | null | undefined, b: Date | null | undefined): boolean { return ymd(a) === ymd(b); }

function sameTimestamp(a: Date | null | undefined, b: Date | null | undefined): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

async function writeOverrideIfChanged(client: Prisma.TransactionClient, siteKey: string, itemId: string, current: ProductionScheduleGrindingPlanningBoardOverride | undefined, next: { overrideResourceCd: string | null; overrideDueDate: Date | null; dueDateCleared: boolean | null; alternateRank: number | null; orderPinned?: boolean } & PersistedSpecialDue): Promise<ProductionScheduleGrindingPlanningBoardOverride | undefined> {
  const orderPinned = next.orderPinned ?? current?.orderPinned ?? false;
  const changed = current == null
    ? orderPinned || next.overrideResourceCd != null || next.overrideDueDate != null || next.dueDateCleared != null || next.alternateRank != null || next.specialDueKind != null || next.specialDueExpiresAt != null
    : (current.orderPinned ?? false) !== orderPinned || current.overrideResourceCd !== next.overrideResourceCd || !sameDate(current.overrideDueDate, next.overrideDueDate) || (current.dueDateCleared ?? null) !== next.dueDateCleared || current.alternateRank !== next.alternateRank || (current.specialDueKind ?? null) !== next.specialDueKind || !sameTimestamp(current.specialDueExpiresAt, next.specialDueExpiresAt);
  if (!changed) return current;
  return client.productionScheduleGrindingPlanningBoardOverride.upsert({
    where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: itemId } },
    create: { orderPinned, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: itemId, overrideResourceCd: next.overrideResourceCd, overrideDueDate: next.overrideDueDate, dueDateCleared: next.dueDateCleared, alternateRank: next.alternateRank, specialDueKind: next.specialDueKind, specialDueExpiresAt: next.specialDueExpiresAt },
    update: { orderPinned, overrideResourceCd: next.overrideResourceCd, overrideDueDate: next.overrideDueDate, dueDateCleared: next.dueDateCleared, alternateRank: next.alternateRank, specialDueKind: next.specialDueKind, specialDueExpiresAt: next.specialDueExpiresAt, version: { increment: 1 } }
  });
}

async function readSpecialDueCalendarModes(siteKey: string, requests: readonly OverrideRequest[]): Promise<ReadonlyMap<string, WorkCalendarMode>> {
  if (!requests.some((request) => request.specialDue === 'overnight')) return new Map();
  const settings = await listLoadBalancingWorkCalendarsResolved(siteKey);
  return buildWorkCalendarModeMap(settings.items);
}

async function applyOverridesInTransaction(params: { client: Prisma.TransactionClient; siteKey: string; sourceRevision: string; requests: readonly OverrideRequest[]; sourceRowIds: ReadonlyMap<string, string>; policy: Awaited<ReturnType<typeof getResourceCategoryPolicy>>; workCalendarModeByResource: ReadonlyMap<string, WorkCalendarMode> }): Promise<AppliedOverrides> {
  const rowsToLock = Array.from(new Set(params.sourceRowIds.values())).sort();
  for (const sourceRowId of rowsToLock) {
    await acquireProductionScheduleParentRowLockInTransaction(params.client, sourceRowId);
    const locked = await params.client.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${sourceRowId} AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} FOR UPDATE`;
    if (!locked[0]) throw new ApiError(409, '元行が消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  }
  const current = await resolveCurrentProjectionInTransaction({ client: params.client, siteKey: params.siteKey, sourceRowIds: rowsToLock, itemIds: params.requests.map((request) => request.itemId), policy: params.policy });
  // Item mutations are guarded by the target itemRevision/overrideVersion only.
  // The board order version belongs to seiban-order mutations and must not make an
  // unrelated item edit fail after another terminal reorders the left pane.
  const desired: Array<{ request: OverrideRequest; currentOverride: ProductionScheduleGrindingPlanningBoardOverride | undefined; next: { overrideResourceCd: string | null; overrideDueDate: Date | null; dueDateCleared: boolean | null; alternateRank: number | null; orderPinned?: boolean } & PersistedSpecialDue }> = [];
  for (const request of params.requests) {
    const item = current.byItemId.get(request.itemId);
    if (!item) throw new ApiError(409, '対象アイテムが消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
    if (item.isCompleted) throw new ApiError(409, '完了済みの工程は変更できません', undefined, 'COMPLETED_ITEM');
    if (item.sourceRowId !== params.sourceRowIds.get(request.itemId)) throw new ApiError(409, 'CSVの勝者行が更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
    assertItemRevision(request.itemRevision, item, request.overrideVersion);
    const currentOverride = current.overrides.get(request.itemId);
    let nextOverrideResource = currentOverride?.overrideResourceCd ?? null;
    let nextOverrideDue = currentOverride?.overrideDueDate ?? null;
    let nextDueDateCleared = currentOverride?.dueDateCleared ?? null;
    let nextSpecialDueKind = currentOverride?.specialDueKind ?? null;
    let nextSpecialDueExpiresAt = currentOverride?.specialDueExpiresAt ?? null;
    if (request.resourceCd !== undefined) {
      if (request.resourceCd == null) nextOverrideResource = null;
      else {
        const candidate = normalizeProductionScheduleResourceCd(request.resourceCd);
        const sourceCategory: GrindingPlanningBoardCategory = isProductionScheduleGrindingResourceCd(item.originalResourceCd ?? '', params.policy) ? 'grinding' : 'cutting';
        if (!current.masterResourceCds.has(candidate)) throw new ApiError(400, '資源マスタに存在しない資源CDです', undefined, 'UNKNOWN_RESOURCE');
        if (!isCategoryResource(candidate, sourceCategory, params.policy)) throw new ApiError(400, '同じ工程区分の資源CDを指定してください', undefined, 'RESOURCE_CATEGORY_MISMATCH');
        // Applying the original resource to an already-original item is a true
        // no-op. Preserve an existing override when it already represents the
        // effective value; explicit null remains the restore operation.
        if (candidate === item.effectiveResourceCd) {
          nextOverrideResource = currentOverride?.overrideResourceCd ?? null;
        } else {
          nextOverrideResource = candidate === item.originalResourceCd ? null : candidate;
        }
      }
    }
    if (request.due !== undefined) {
      const due = resolvePlanningBoardDueRequest({ request: request.due, currentEffectiveDueDate: item.effectiveDueDate, originalDueDate: item.originalDueDate });
      if (due !== undefined) {
        nextOverrideDue = due;
        nextDueDateCleared = false;
      }
    }
    if (request.specialDue !== undefined) {
      if (request.specialDue == null) {
        nextSpecialDueKind = null;
        nextSpecialDueExpiresAt = null;
      } else {
        if (!isGrindingPlanningBoardSpecialDueKind(request.specialDue)) throw new ApiError(400, '特別納期種別が不正です', undefined, 'INVALID_SPECIAL_DUE');
        const effectiveResourceCd = nextOverrideResource ?? item.originalResourceCd;
        nextSpecialDueKind = request.specialDue;
        nextSpecialDueExpiresAt = resolveGrindingPlanningBoardSpecialDueExpiresAt({
          kind: request.specialDue,
          workCalendarMode: params.workCalendarModeByResource.get(
            effectiveResourceCd == null ? '' : normalizeProductionScheduleResourceCd(effectiveResourceCd)
          ) ?? DEFAULT_WORK_CALENDAR_MODE
        });
      }
    }
    const resourceChanged = request.resourceCd !== undefined && (nextOverrideResource ?? item.originalResourceCd) !== item.effectiveResourceCd;
    const effectiveDueAfterOverride = nextOverrideDue != null
      ? ymd(nextOverrideDue)
      : item.kind === 'split'
        ? current.splitOriginalDueByItemId.get(item.itemId)
          ?? (current.parentEffectiveDueBySourceRow.has(item.sourceRowId)
            ? current.parentEffectiveDueBySourceRow.get(item.sourceRowId) ?? null
            : item.originalDueDate)
        : item.originalDueDate;
    const dueChanged = request.due !== undefined && effectiveDueAfterOverride !== item.effectiveDueDate;
    desired.push({ request, currentOverride, next: { orderPinned: request.orderPinned, overrideResourceCd: nextOverrideResource, overrideDueDate: nextOverrideDue, dueDateCleared: nextDueDateCleared, alternateRank: request.alternateRank !== undefined ? request.alternateRank : resourceChanged || dueChanged ? null : currentOverride?.alternateRank ?? null, specialDueKind: nextSpecialDueKind, specialDueExpiresAt: nextSpecialDueExpiresAt } });
  }
  const overrides = new Map(current.overrides);
  for (const update of desired) {
    const saved = await writeOverrideIfChanged(params.client, params.siteKey, update.request.itemId, update.currentOverride, update.next);
    if (saved) overrides.set(update.request.itemId, saved);
  }
  return { state: current.state, current, overrides };
}

function projectCurrentItems(current: CurrentProjection, overrides: ReadonlyMap<string, ProductionScheduleGrindingPlanningBoardOverride>): Map<string, GrindingPlanningBoardItem> {
  const common = {
    rows: current.rows,
    details: current.details,
    ranks: current.ranks,
    overrides,
    progressRows: current.progressRows,
    splitEnabled: current.splitEnabled,
    seibanOrder: stateOrder(current.state),
    isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => isCategoryResource(resourceCd, category, current.policy)
  };
  const byItemId = new Map<string, GrindingPlanningBoardItem>();
  for (const category of ['grinding', 'cutting'] as const) {
    for (const item of projectGrindingPlanningBoard({ ...common, category }).allItems) byItemId.set(item.itemId, item);
  }
  return byItemId;
}

function projectCurrentItem(current: CurrentProjection, overrides: ReadonlyMap<string, ProductionScheduleGrindingPlanningBoardOverride>, itemId: string): GrindingPlanningBoardItem {
  const common = {
    rows: current.rows,
    details: current.details,
    ranks: current.ranks,
    overrides,
    progressRows: current.progressRows,
    splitEnabled: current.splitEnabled,
    seibanOrder: stateOrder(current.state),
    isResourceInCategory: (resourceCd: string, category: GrindingPlanningBoardCategory) => isCategoryResource(resourceCd, category, current.policy)
  };
  const byItemId = new Map<string, GrindingPlanningBoardItem>();
  for (const category of ['grinding', 'cutting'] as const) {
    for (const item of projectGrindingPlanningBoard({ ...common, category }).allItems) byItemId.set(item.itemId, item);
  }
  const item = byItemId.get(itemId);
  if (!item) throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  return item;
}

export async function updateGrindingPlanningBoardPins(params: { siteKey: string; sourceRevision: string; items: Pick<OverrideRequest, 'itemId' | 'itemRevision' | 'overrideVersion'>[]; pinned: boolean }): Promise<GrindingPlanningBoardOverridesResponse> {
  return updateGrindingPlanningBoardOverrides({ ...params, items: params.items.map((item) => ({ ...item, orderPinned: params.pinned })) });
}

export async function updateGrindingPlanningBoardOverrides(params: { siteKey: string; sourceRevision: string; items: OverrideRequest[] }): Promise<GrindingPlanningBoardOverridesResponse> {
  const itemIds = params.items.map((item) => item.itemId);
  if (new Set(itemIds).size !== itemIds.length) throw new ApiError(400, '対象アイテムが重複しています', undefined, 'DUPLICATE_ITEM');
  const sourceRowIds = await discoverSourceRows(itemIds);
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  const workCalendarModeByResource = await readSpecialDueCalendarModes(params.siteKey, params.items);
  try {
    // Parent-row advisory/row locks and target item revisions provide the
    // write-conflict guarantee here. RepeatableRead avoids a PostgreSQL SSI
    // predicate lock on the small override table turning independent items
    // into a false serialization conflict.
    const result = await prisma.$transaction(async (client) => {
      const applied = await applyOverridesInTransaction({ client, siteKey: params.siteKey, sourceRevision: params.sourceRevision, requests: params.items, sourceRowIds, policy, workCalendarModeByResource });
      const projectedItems = projectCurrentItems(applied.current, applied.overrides);
      const items = params.items.map((request) => {
        const item = projectedItems.get(request.itemId);
        if (!item) throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
        return item;
      });
      return { ...applied, items };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return {
      sourceRevision: boardRevision(result.state),
      items: result.items
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
    throw error;
  }
}

export async function updateGrindingPlanningBoardRank(params: { siteKey: string; sourceRevision: string; itemId: string; itemRevision: string; overrideVersion?: number; alternateRank: number | null }): Promise<GrindingPlanningBoardRankResponse> {
  if (params.alternateRank != null && (!Number.isSafeInteger(params.alternateRank) || params.alternateRank < 1 || params.alternateRank > MAX_ALTERNATE_RANK)) throw new ApiError(400, '個別順位は1以上2147483647以下で指定してください', undefined, 'INVALID_ALTERNATE_RANK');
  const sourceRowIds = await discoverSourceRows([params.itemId]);
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  const workCalendarModeByResource = new Map<string, WorkCalendarMode>();
  try {
    const result = await prisma.$transaction((client) => applyOverridesInTransaction({ client, siteKey: params.siteKey, sourceRevision: params.sourceRevision, requests: [{ itemId: params.itemId, itemRevision: params.itemRevision, overrideVersion: params.overrideVersion, alternateRank: params.alternateRank }], sourceRowIds, policy, workCalendarModeByResource }), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const item = projectCurrentItem(result.current, result.overrides, params.itemId);
    return {
      sourceRevision: boardRevision(result.state),
      itemId: item.itemId,
      itemRevision: item.itemRevision,
      overrideVersion: item.version,
      alternateRank: item.alternateRank
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
    throw error;
  }
}

export async function updateGrindingPlanningBoardResourceOrder(params: {
  siteKey: string;
} & GrindingPlanningBoardResourceOrderRequest): Promise<GrindingPlanningBoardResourceOrderResponse> {
  if (params.itemId === params.targetItemId) {
    throw new ApiError(400, '同じアイテムの前後には移動できません', undefined, 'INVALID_RESOURCE_ORDER_TARGET');
  }
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  try {
    const result = await prisma.$transaction(async (client) => {
      const lockedState = await lockState(client, params.siteKey);
      assertBoardRevision(params.sourceRevision, lockedState);
      const registeredFseibans = new Set(stateOrder(lockedState));
      const winnerRows = await readWinnerRowsByFseibans(client, [...registeredFseibans]);
      const registeredRows = winnerRows.filter((row) => registeredFseibans.has(valueAsString(asRowData(row.rowData), 'FSEIBAN')));
      const allOverrides = await readOverrides(client, params.siteKey);
      // Select the resource's parents before hydrating details or calculating progress.
      // Split resource overrides can move children independently of their parent.
      const splits = await client.productionScheduleOrderSplit.findMany({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, parentCsvDashboardRowId: { in: registeredRows.map((row) => row.id) } },
        select: { id: true, parentCsvDashboardRowId: true }
      });
      const parentByItem = new Map(registeredRows.map((row) => [buildGrindingPlanningBoardRowItemId(asRowData(row.rowData)), row]));
      const rowById = new Map(registeredRows.map((row) => [row.id, row]));
      for (const split of splits) {
        const parent = rowById.get(split.parentCsvDashboardRowId);
        if (parent) parentByItem.set(`${SPLIT_PREFIX}${split.id}`, parent);
      }
      const sourceParent = parentByItem.get(params.itemId);
      const targetParent = parentByItem.get(params.targetItemId);
      if (!sourceParent || !targetParent) throw new ApiError(409, '対象アイテムが消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
      const originalResource = normalizeProductionScheduleResourceCd(valueAsString(asRowData(sourceParent.rowData), 'FSIGENCD'));
      const resource = allOverrides.get(params.itemId)?.overrideResourceCd ?? originalResource;
      const category: GrindingPlanningBoardCategory = isCategoryResource(originalResource, 'grinding', policy) ? 'grinding' : 'cutting';
      const candidateIds = new Set([sourceParent.id, targetParent.id]);
      for (const [itemId, row] of parentByItem) {
        const original = normalizeProductionScheduleResourceCd(valueAsString(asRowData(row.rowData), 'FSIGENCD'));
        if (isCategoryResource(original, category, policy) && (allOverrides.get(itemId)?.overrideResourceCd ?? original) === resource) candidateIds.add(row.id);
      }
      const candidateRows = registeredRows.filter((row) => candidateIds.has(row.id));
      const registeredRowIds = candidateRows.map((row) => row.id).sort();
      const beforeLock = await resolveCurrentProjectionInTransaction({
        client,
        siteKey: params.siteKey,
        sourceRowIds: registeredRowIds,
        itemIds: [params.itemId, params.targetItemId],
        policy,
        includeAllOverrides: true,
        preloaded: { rows: candidateRows, state: lockedState, overrides: allOverrides }
      });
      const sourceBeforeLock = beforeLock.byItemId.get(params.itemId);
      const targetBeforeLock = beforeLock.byItemId.get(params.targetItemId);
      if (!sourceBeforeLock || !targetBeforeLock) throw new ApiError(409, '対象アイテムが消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
      const sourceCategoryBeforeLock: GrindingPlanningBoardCategory = isCategoryResource(sourceBeforeLock.originalResourceCd, 'grinding', policy)
        ? 'grinding'
        : 'cutting';
      const sourceResourceBeforeLock = sourceBeforeLock.effectiveResourceCd ?? sourceBeforeLock.originalResourceCd;
      const targetResourceBeforeLock = targetBeforeLock.effectiveResourceCd ?? targetBeforeLock.originalResourceCd;
      const paneRowIds = [...new Set([...beforeLock.byItemId.values()]
        .filter((item) =>
          isCategoryResource(item.originalResourceCd, sourceCategoryBeforeLock, policy) &&
          sourceResourceBeforeLock != null &&
          (item.effectiveResourceCd ?? item.originalResourceCd) === sourceResourceBeforeLock
        )
        .map((item) => item.sourceRowId))].sort();
      if (targetResourceBeforeLock !== sourceResourceBeforeLock || paneRowIds.length === 0) {
        throw new ApiError(409, '同じ資源CDの中でのみ並べ替えできます', undefined, 'RESOURCE_ORDER_PANE_MISMATCH');
      }
      for (const sourceRowId of paneRowIds) {
        await acquireProductionScheduleParentRowLockInTransaction(client, sourceRowId);
        const locked = await client.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${sourceRowId} AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} FOR UPDATE`;
        if (!locked[0]) throw new ApiError(409, '元行が消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
      }
      // RepeatableRead keeps the projection stable. The parent locks above reject
      // concurrent parent writes; the board lock serializes override writers.
      const current = beforeLock;
      const source = current.byItemId.get(params.itemId);
      const target = current.byItemId.get(params.targetItemId);
      if (!source || !target) throw new ApiError(409, '対象アイテムが消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
      assertItemRevision(params.itemRevision, source, params.overrideVersion);
      assertItemRevision(params.targetItemRevision, target, params.targetOverrideVersion);
      if (source.isCompleted || target.isCompleted) throw new ApiError(409, '完了済みの工程は並べ替えできません', undefined, 'COMPLETED_ITEM');
      const sourceCategory: GrindingPlanningBoardCategory = isCategoryResource(source.originalResourceCd, 'grinding', policy)
        ? 'grinding'
        : 'cutting';
      if (!isCategoryResource(source.originalResourceCd, sourceCategory, policy) || !isCategoryResource(target.originalResourceCd, sourceCategory, policy)) {
        throw new ApiError(409, '工程区分が異なるため並べ替えできません', undefined, 'RESOURCE_CATEGORY_MISMATCH');
      }
      const sourceResource = source.effectiveResourceCd ?? source.originalResourceCd;
      const targetResource = target.effectiveResourceCd ?? target.originalResourceCd;
      if (!sourceResource || sourceResource !== targetResource) {
        throw new ApiError(409, '同じ資源CDの中でのみ並べ替えできます', undefined, 'RESOURCE_ORDER_PANE_MISMATCH');
      }
      const sourceSpecialDueBand = source.specialDue?.expiresAt ?? null;
      const targetSpecialDueBand = target.specialDue?.expiresAt ?? null;
      if (sourceSpecialDueBand !== targetSpecialDueBand) {
        throw new ApiError(409, '特別納期の優先帯をまたいで並べ替えできません', undefined, 'SPECIAL_DUE_ORDER_BAND_MISMATCH');
      }
      const pane = [...current.byItemId.values()].filter((item) =>
        isCategoryResource(item.originalResourceCd, sourceCategory, policy) &&
        (item.effectiveResourceCd ?? item.originalResourceCd) === sourceResource
      );
      const ordered = sortGrindingPlanningBoardProjectionItems(
        pane,
        stateOrder(current.state),
        'resource',
        'alternate'
      );
      const originalOrder = ordered.map((item) => item.itemId);
      const sourceIndex = ordered.findIndex((item) => item.itemId === source.itemId);
      const targetIndex = ordered.findIndex((item) => item.itemId === target.itemId);
      if (sourceIndex < 0 || targetIndex < 0) throw new ApiError(409, '対象アイテムが表示中の資源CDにありません', undefined, 'STALE_PLANNING_BOARD_ITEM');
      const [moved] = ordered.splice(sourceIndex, 1);
      const insertionIndex = ordered.findIndex((item) => item.itemId === target.itemId) + (params.placement === 'after' ? 1 : 0);
      ordered.splice(insertionIndex, 0, moved);

      const orderChanged = ordered.some((item, index) => item.itemId !== originalOrder[index]);
      if (!orderChanged) {
        return { state: lockedState, items: ordered };
      }

      const overrides = new Map(current.overrides);
      const bandItems = ordered.filter((item) => (item.specialDue?.expiresAt ?? null) === sourceSpecialDueBand);
      for (const [index, item] of bandItems.entries()) {
        if (index + 1 > MAX_ALTERNATE_RANK) throw new ApiError(400, '資源CD内のアイテム数が上限を超えています', undefined, 'RESOURCE_ORDER_LIMIT_EXCEEDED');
        const currentOverride = current.overrides.get(item.itemId);
        const saved = await writeOverrideIfChanged(client, params.siteKey, item.itemId, currentOverride, {
          overrideResourceCd: currentOverride?.overrideResourceCd ?? null,
          overrideDueDate: currentOverride?.overrideDueDate ?? null,
          dueDateCleared: currentOverride?.dueDateCleared ?? null,
          alternateRank: index + 1,
          specialDueKind: currentOverride?.specialDueKind ?? null,
          specialDueExpiresAt: currentOverride?.specialDueExpiresAt ?? null
        });
        if (saved) overrides.set(item.itemId, saved);
      }
      const projectedItems = projectCurrentItems(current, overrides);
      const items = ordered.map((item) => {
        const projected = projectedItems.get(item.itemId);
        if (!projected) throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
        return projected;
      });
      return { state: lockedState, items };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { sourceRevision: boardRevision(result.state), items: result.items };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
    throw error;
  }
}

export async function updateGrindingPlanningBoardResourceOrderBulk(params: {
  siteKey: string;
} & GrindingPlanningBoardResourceOrderBulkRequest): Promise<GrindingPlanningBoardResourceOrderResponse> {
  const itemIds = params.items.map((item) => item.itemId);
  if (itemIds.length < 1 || itemIds.length > 500 || new Set(itemIds).size !== itemIds.length) {
    throw new ApiError(400, '1〜500件の重複しないアイテムを指定してください', undefined, 'INVALID_RESOURCE_ORDER_ITEMS');
  }
  const sourceRows = await discoverSourceRows(itemIds);
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  const resource = params.resourceCd === '未設定' ? null : normalizeProductionScheduleResourceCd(params.resourceCd);
  try {
    const result = await prisma.$transaction(async (client) => {
      const state = await lockState(client, params.siteKey);
      assertBoardRevision(params.sourceRevision, state);
      const rowsToLock = [...new Set(sourceRows.values())].sort();
      for (const sourceRowId of rowsToLock) {
        await acquireProductionScheduleParentRowLockInTransaction(client, sourceRowId);
        const locked = await client.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${sourceRowId} AND "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} FOR UPDATE`;
        if (!locked[0]) throw new ApiError(409, '元行が消滅しています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
      }
      const current = await resolveCurrentProjectionInTransaction({ client, siteKey: params.siteKey, sourceRowIds: rowsToLock, itemIds, policy });
      const registered = new Set(stateOrder(state));
      for (const request of params.items) {
        const item = current.byItemId.get(request.itemId)!;
        if (!registered.has(item.fseiban) || item.sourceRowId !== sourceRows.get(item.itemId)) {
          throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
        }
        assertItemRevision(request.itemRevision, item, request.overrideVersion);
        if (item.isCompleted) throw new ApiError(409, '完了済みの工程は並べ替えできません', undefined, 'COMPLETED_ITEM');
        if ((item.effectiveResourceCd ?? item.originalResourceCd) !== resource) {
          throw new ApiError(409, '同じ資源CDの中でのみ並べ替えできます', undefined, 'RESOURCE_ORDER_PANE_MISMATCH');
        }
      }
      const overrides = new Map(current.overrides);
      for (const [index, itemId] of itemIds.entries()) {
        const previous = current.overrides.get(itemId);
        const saved = await writeOverrideIfChanged(client, params.siteKey, itemId, previous, {
          overrideResourceCd: previous?.overrideResourceCd ?? null,
          overrideDueDate: previous?.overrideDueDate ?? null,
          dueDateCleared: previous?.dueDateCleared ?? null,
          alternateRank: index + 1,
          specialDueKind: previous?.specialDueKind ?? null,
          specialDueExpiresAt: previous?.specialDueExpiresAt ?? null
        });
        if (saved) overrides.set(itemId, saved);
      }
      const projected = projectCurrentItems(current, overrides);
      return { sourceRevision: boardRevision(state), items: itemIds.map((itemId) => projected.get(itemId)!) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
    throw error;
  }
}

export async function updateGrindingPlanningBoardSeibanOrder(params: { siteKey: string; sourceRevision: string; fseibans: string[] }): Promise<{ sourceRevision: string; seibanOrder: string[] }> {
  const normalizedOrder = normalizeUniqueFseibans(params.fseibans);
  if (normalizedOrder.length > KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX) {
    throw new ApiError(400, `登録できる製番は${KIOSK_PRODUCTION_SCHEDULE_REGISTERED_SEIBAN_MAX}件までです`, undefined, 'SEIBAN_LIMIT_EXCEEDED');
  }
  const nextOrder = normalizedOrder;
  const rows = await readWinnerRowsByFseibans(prisma, nextOrder);
  const known = new Set(rows.map((row) => valueAsString(asRowData(row.rowData), 'FSEIBAN')).filter(Boolean));
  const existingState = await getOrCreateState(params.siteKey, Array.from(known), prisma);
  const existingOrder = new Set(stateOrder(existingState));
  if (nextOrder.some((value) => !known.has(value) && !existingOrder.has(value))) throw new ApiError(400, '存在しない製番は登録できません', undefined, 'UNKNOWN_SEIBAN');
  try {
    const state = await prisma.$transaction(async (client) => {
      const current = await lockState(client, params.siteKey);
      assertBoardRevision(params.sourceRevision, current);
      if (JSON.stringify(stateOrder(current)) === JSON.stringify(nextOrder)) return current;
      return await client.productionScheduleGrindingPlanningBoardState.update({ where: { id: current.id }, data: { seibanOrder: nextOrder, version: { increment: 1 } } }) as PlanningState;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return { sourceRevision: boardRevision(state), seibanOrder: stateOrder(state) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ORDER');
    throw error;
  }
}
