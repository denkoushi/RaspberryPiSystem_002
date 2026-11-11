import { Prisma, type ProductionScheduleGrindingPlanningBoardTestBar } from '@prisma/client';
import type { GrindingPlanningBoardBar, GrindingPlanningBoardItem, GrindingPlanningBoardItemReference, GrindingPlanningBoardResourceOrderBulkRequest, GrindingPlanningBoardResourceOrderRequest, GrindingPlanningBoardResourceOrderResponse, GrindingPlanningBoardTestBar, GrindingPlanningBoardTestBarCreateRequest, GrindingPlanningBoardTestBarMutationRequest, GrindingPlanningBoardTestBarMutationResponse } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { sortGrindingPlanningBoardProjectionItems } from '../grinding-planning-board-projection.js';
import { acquireProductionScheduleParentRowLockInTransaction } from '../order-assignment/production-schedule-parent-row-lock.service.js';
import { getResourceCategoryPolicy, normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';
import { acquireSessakuPieceLogicalLocks } from '../sessaku-pieces/piece-key.js';
import { mergeScheduleSourceOrder, readScheduleSourceExcludedFseibans } from './schedule-source.js';
import { assertItemRevision, isCategoryResource, type CurrentProjection, type DbClient } from './shared.js';
import { readOverrides, readWinnerRowsByFseibans } from './source.js';
import { assertBoardRevision, boardRevision, ensurePlanningBoardState, lockState, stateOrder } from './state.js';
import { projectCurrentItems, resolveCurrentProjectionInTransaction, writeOverrideIfChanged } from './write.js';

export function projectPlanningTestBar(row: ProductionScheduleGrindingPlanningBoardTestBar): GrindingPlanningBoardTestBar {
  return { kind: 'test', itemId: `test:${row.id}`, itemRevision: `test:${row.id}:${row.version}`, version: row.version,
    sequence: row.sequence, name: `テスト${row.sequence}`, resourceCd: row.resourceCd, minutes: row.minutes,
    alternateRank: row.alternateRank, isCompleted: row.completedAt != null,
    completedAt: row.completedAt?.toISOString() ?? null, deletedAt: row.deletedAt?.toISOString() ?? null };
}
export async function readPlanningTestBars(client: DbClient, siteKey: string) {
  const rows = await client.productionScheduleGrindingPlanningBoardTestBar.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey }, orderBy: { sequence: 'asc' }
  });
  return { testBars: rows.filter((row) => !row.deletedAt).map(projectPlanningTestBar),
    nextTestBarSequence: (rows.at(-1)?.sequence ?? 0) + 1 };
}
export async function hasPlanningTestBars(siteKey: string, resourceCd: string | null, client: DbClient = prisma) {
  if (!resourceCd) return false;
  return (await client.productionScheduleGrindingPlanningBoardTestBar.count({ where: {
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, resourceCd, deletedAt: null, completedAt: null
  } })) > 0;
}
export const planningBarResource = (item: GrindingPlanningBoardBar) => item.kind === 'test' ? item.resourceCd : item.effectiveResourceCd ?? item.originalResourceCd;

export const planningBarBand = (item: GrindingPlanningBoardBar) => item.kind === 'test' ? null : item.specialDue?.expiresAt ?? null;

/** Test bars share ranks with normal items in the band without a special due date. */
export function mixedPlanningLane(items: readonly GrindingPlanningBoardItem[], tests: readonly GrindingPlanningBoardTestBar[], order: readonly string[], resource: string | null) {
  const normal = sortGrindingPlanningBoardProjectionItems(items.filter((item) => !item.isCompleted && planningBarResource(item) === resource), order, 'resource', 'alternate');
  const laneTests = tests.filter((item) => !item.isCompleted && !item.deletedAt && item.resourceCd === resource);
  const mixed: GrindingPlanningBoardBar[] = [...normal, ...laneTests];
  if (laneTests.length) mixed.sort((a, b) => {
    const left = planningBarBand(a), right = planningBarBand(b);
    const band = left === right ? 0 : left == null ? 1 : right == null ? -1 : left.localeCompare(right);
    return band || (a.alternateRank ?? Infinity) - (b.alternateRank ?? Infinity);
  });
  return mixed;
}
async function withBoard<T>(siteKey: string, sourceRevision: string, dueSource: 'excel' | 'scaw' | undefined,
  action: (tx: Prisma.TransactionClient, current: CurrentProjection, tests: Awaited<ReturnType<typeof readPlanningTestBars>>) => Promise<T>) {
  await ensurePlanningBoardState(siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey });
  const planned = await prisma.productionScheduleGrindingPlanningBoardState.findUniqueOrThrow({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } } });
  const pieceKeys = await prisma.productionScheduleSessakuPieceSet.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: { in: stateOrder(planned) }, pieces: { some: {} } } });
  try {
    return await prisma.$transaction(async (tx) => {
      await acquireSessakuPieceLogicalLocks(tx, pieceKeys);
      const state = await lockState(tx, siteKey);
      assertBoardRevision(sourceRevision, state);
      const rows = await readWinnerRowsByFseibans(tx, stateOrder(state));
      for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
        await acquireProductionScheduleParentRowLockInTransaction(tx, row.id);
        await tx.$queryRaw`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${row.id} FOR UPDATE`;
      }
      const current = await resolveCurrentProjectionInTransaction({ client: tx, siteKey, dueSource, sourceRowIds: rows.map((row) => row.id), itemIds: [], policy,
        includeAllOverrides: true, preloaded: { state, rows, overrides: await readOverrides(tx, siteKey) } });
      return action(tx, current, await readPlanningTestBars(tx, siteKey));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30000, maxWait: 15000 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2034' || error.code === 'P2002')) throw new ApiError(409, '同時更新がありました。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD');
    throw error;
  }
}
function assertReference(reference: GrindingPlanningBoardItemReference, item: GrindingPlanningBoardBar | undefined) {
  if (!item) throw new ApiError(409, '対象アイテムが更新されています。再読み込みしてください', undefined, 'STALE_PLANNING_BOARD_ITEM');
  if (item.kind !== 'test') assertItemRevision(reference.itemRevision, item, reference.overrideVersion);
  else if (reference.itemRevision !== item.itemRevision || (reference.overrideVersion != null && reference.overrideVersion !== item.version)) throw new ApiError(409, 'テスト加工が更新されています。再読み込みしてください', undefined, 'STALE_TEST_BAR');
  if (item.isCompleted) throw new ApiError(409, '完了済みの棒は並べ替えできません', undefined, 'COMPLETED_ITEM');
  return item;
}
async function saveLane(tx: Prisma.TransactionClient, siteKey: string, current: CurrentProjection, lane: readonly GrindingPlanningBoardBar[]) {
  const ranks = new Map<string | null, number>();
  for (const item of lane) {
    const band = planningBarBand(item);
    const rank = (ranks.get(band) ?? 0) + 1;
    ranks.set(band, rank);
    if (item.kind === 'test') {
      if (item.alternateRank !== rank) await tx.productionScheduleGrindingPlanningBoardTestBar.update({ where: { id: item.itemId.slice(5) }, data: { alternateRank: rank, version: { increment: 1 } } });
    } else {
      const previous = current.overrides.get(item.itemId);
      const saved = await writeOverrideIfChanged(tx, siteKey, item.itemId, previous, {
        overrideResourceCd: previous?.overrideResourceCd ?? null, overrideDueDate: previous?.overrideDueDate ?? null,
        dueDateCleared: previous?.dueDateCleared ?? null, alternateRank: rank,
        specialDueKind: previous?.specialDueKind ?? null, specialDueExpiresAt: previous?.specialDueExpiresAt ?? null
      });
      if (saved) current.overrides.set(item.itemId, saved);
    }
  }
}
async function mutationResponse(tx: Prisma.TransactionClient, siteKey: string, current: CurrentProjection, id: string): Promise<GrindingPlanningBoardTestBarMutationResponse> {
  const state = await tx.productionScheduleGrindingPlanningBoardState.update({ where: { id: current.state.id }, data: { version: { increment: 1 } } });
  const row = await tx.productionScheduleGrindingPlanningBoardTestBar.findUniqueOrThrow({ where: { id } });
  return { sourceRevision: boardRevision(state), testBar: projectPlanningTestBar(row), ...await readPlanningTestBars(tx, siteKey), items: [...projectCurrentItems(current, current.overrides).values()] };
}
export async function createPlanningTestBar(params: GrindingPlanningBoardTestBarCreateRequest & { siteKey: string }): Promise<GrindingPlanningBoardTestBarMutationResponse> {
  if (!Number.isInteger(params.minutes) || params.minutes < 5 || params.minutes > 1440) throw new ApiError(400, '時間は5〜1440分の整数で指定してください', undefined, 'INVALID_TEST_BAR_MINUTES');
  return withBoard(params.siteKey, params.sourceRevision, params.dueSource, async (tx, current, tests) => {
    const resourceCd = normalizeProductionScheduleResourceCd(params.resourceCd);
    if (!resourceCd || !current.masterResourceCds.has(resourceCd) || !isCategoryResource(resourceCd, 'all', current.policy)) throw new ApiError(400, '資源CDが不正です', undefined, 'INVALID_RESOURCE_CD');
    const lane = mixedPlanningLane([...current.byItemId.values()], tests.testBars, stateOrder(current.state), resourceCd);
    const unbandedStart = lane.filter((item) => planningBarBand(item) != null).length;
    let at = unbandedStart;
    if (params.afterItem) {
      const candidate = current.byItemId.get(params.afterItem.itemId) ?? tests.testBars.find((item) => item.itemId === params.afterItem!.itemId);
      const after = assertReference(params.afterItem, candidate);
      if (planningBarResource(after) === resourceCd && planningBarBand(after) == null) at = lane.findIndex((item) => item.itemId === after.itemId) + 1;
    }
    const row = await tx.productionScheduleGrindingPlanningBoardTestBar.create({ data: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey,
      sequence: tests.nextTestBarSequence, resourceCd, minutes: params.minutes, alternateRank: at - unbandedStart + 1 } });
    lane.splice(at, 0, projectPlanningTestBar(row));
    await saveLane(tx, params.siteKey, current, lane);
    return mutationResponse(tx, params.siteKey, current, row.id);
  });
}
export async function mutatePlanningTestBar(params: GrindingPlanningBoardTestBarMutationRequest & { siteKey: string; id: string; action: 'delete' | 'restore' | 'complete' | 'incomplete' }): Promise<GrindingPlanningBoardTestBarMutationResponse> {
  return withBoard(params.siteKey, params.sourceRevision, params.dueSource, async (tx, current, tests) => {
    const row = await tx.productionScheduleGrindingPlanningBoardTestBar.findFirst({ where: { id: params.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey } });
    if (!row) throw new ApiError(404, 'テスト加工がありません', undefined, 'TEST_BAR_NOT_FOUND');
    if (row.version !== params.expectedVersion || (params.action !== 'restore' && row.deletedAt)) throw new ApiError(409, 'テスト加工が更新されています。再読み込みしてください', undefined, 'STALE_TEST_BAR');
    await tx.productionScheduleGrindingPlanningBoardTestBar.update({ where: { id: row.id }, data: {
      ...(params.action === 'delete' ? { deletedAt: new Date() } : params.action === 'restore' ? { deletedAt: null } : { completedAt: params.action === 'complete' ? new Date() : null }), version: { increment: 1 }
    } });
    // Keep the tombstone rank: undo restores the same slot without reusing its sequence.
    if ((params.action === 'restore' && !row.completedAt) || params.action === 'incomplete') {
      const lane = mixedPlanningLane([...current.byItemId.values()], tests.testBars.filter((item) => item.itemId !== `test:${row.id}`), stateOrder(current.state), row.resourceCd);
      lane.splice(Math.min(lane.filter((item) => planningBarBand(item) != null).length + row.alternateRank - 1, lane.length), 0, { ...projectPlanningTestBar(row), deletedAt: null, isCompleted: false, completedAt: null });
      await saveLane(tx, params.siteKey, current, lane);
    }
    return mutationResponse(tx, params.siteKey, current, row.id);
  });
}
export async function reorderPlanningTestBarLane(params: (GrindingPlanningBoardResourceOrderRequest | GrindingPlanningBoardResourceOrderBulkRequest) & { siteKey: string }): Promise<GrindingPlanningBoardResourceOrderResponse> {
  const excluded = new Set(await readScheduleSourceExcludedFseibans(params.scheduleSource));
  return withBoard(params.siteKey, params.sourceRevision, params.dueSource, async (tx, current, tests) => {
    const byId = new Map<string, GrindingPlanningBoardBar>([...current.byItemId.values(), ...tests.testBars].map((item) => [item.itemId, item]));
    const requests = 'items' in params ? params.items : [params, { itemId: params.targetItemId, itemRevision: params.targetItemRevision, overrideVersion: params.targetOverrideVersion }];
    if (!requests.length || requests.length > 500 || new Set(requests.map((item) => item.itemId)).size !== requests.length) throw new ApiError(400, '重複しない棒を指定してください', undefined, 'INVALID_RESOURCE_ORDER_ITEMS');
    const members = requests.map((reference) => assertReference(reference, byId.get(reference.itemId)));
    const resource = 'resourceCd' in params ? params.resourceCd === '未設定' ? null : normalizeProductionScheduleResourceCd(params.resourceCd) : planningBarResource(members[0]!);
    if (members.some((item) => planningBarResource(item) !== resource || (item.kind !== 'test' && excluded.has(item.fseiban)))) throw new ApiError(409, '同じ資源CDの中でのみ並べ替えできます', undefined, 'RESOURCE_ORDER_PANE_MISMATCH');
    const lane = mixedPlanningLane([...current.byItemId.values()], tests.testBars, stateOrder(current.state), resource);
    const visible = lane.filter((item) => item.kind === 'test' || !excluded.has(item.fseiban));
    let order: string[];
    if ('items' in params) order = mergeScheduleSourceOrder(lane.map((item) => item.itemId), params.items.map((item) => item.itemId));
    else {
      const [source, target] = members;
      if (planningBarBand(source!) !== planningBarBand(target!)) throw new ApiError(409, '特別納期の優先帯をまたいで並べ替えできません', undefined, 'SPECIAL_DUE_ORDER_BAND_MISMATCH');
      const moving = visible.findIndex((item) => item.itemId === source!.itemId);
      if (moving < 0) throw new ApiError(409, '対象が更新されています', undefined, 'STALE_PLANNING_BOARD_ITEM');
      visible.splice(moving, 1);
      visible.splice(visible.findIndex((item) => item.itemId === target!.itemId) + (params.placement === 'after' ? 1 : 0), 0, source!);
      order = mergeScheduleSourceOrder(lane.map((item) => item.itemId), visible.map((item) => item.itemId));
    }
    if (order.some((id, index) => planningBarBand(byId.get(id)!) !== planningBarBand(lane[index]!))) throw new ApiError(409, '特別納期の優先帯をまたいで並べ替えできません', undefined, 'SPECIAL_DUE_ORDER_BAND_MISMATCH');
    await saveLane(tx, params.siteKey, current, order.map((id) => byId.get(id)!));
    const state = await tx.productionScheduleGrindingPlanningBoardState.update({ where: { id: current.state.id }, data: { version: { increment: 1 } } });
    return { sourceRevision: boardRevision(state), items: [...projectCurrentItems(current, current.overrides).values()], testBars: (await readPlanningTestBars(tx, params.siteKey)).testBars };
  });
}
