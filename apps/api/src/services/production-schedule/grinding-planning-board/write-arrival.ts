import type { GrindingPlanningBoardArrivalRequest, GrindingPlanningBoardArrivalResponse, GrindingPlanningBoardFirstProcessArrivalRequest, GrindingPlanningBoardFirstProcessArrivalResponse } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { acquireProductionScheduleParentRowLockInTransaction } from '../order-assignment/production-schedule-parent-row-lock.service.js';
import { getResourceCategoryPolicy } from '../policies/resource-category-policy.service.js';
import { enrichRowsWithProcessArrival } from '../process-arrival.service.js';
import { acquireSessakuPieceLogicalLocks } from '../sessaku-pieces/piece-key.js';
import { assertItemRevision, planningBoardArrivalDate } from './shared.js';
import { ensurePlanningBoardState, lockState } from './state.js';
import { readLivePieceKeys, resolveCurrentProjectionInTransaction } from './write.js';
import { discoverSourceRows } from './write-source.js';

export async function updateGrindingPlanningBoardArrival(params: GrindingPlanningBoardArrivalRequest & {
  siteKey: string; recorded: boolean;
}): Promise<GrindingPlanningBoardArrivalResponse> {
  const sourceRowIds = await discoverSourceRows([params.itemId]);
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  const pieceKeys = await readLivePieceKeys(prisma, [...sourceRowIds.values()]);
  return prisma.$transaction(async (client) => {
    const sourceRowId = sourceRowIds.get(params.itemId)!;
    await acquireSessakuPieceLogicalLocks(client, pieceKeys);
    if (pieceKeys.length) await lockState(client, params.siteKey);
    await acquireProductionScheduleParentRowLockInTransaction(client, sourceRowId);
    const current = await resolveCurrentProjectionInTransaction({ dueSource: params.dueSource, client, siteKey: params.siteKey,
      sourceRowIds: [sourceRowId], itemIds: [params.itemId], policy, allowPieceParent: true });
    const item = current.byItemId.get(params.itemId)!;
    assertItemRevision(params.itemRevision, item, params.overrideVersion);
    if (item.isCompleted) throw new ApiError(409, '完了済みの工程は変更できません', undefined, 'COMPLETED_ITEM');
    const arrivalDate = planningBoardArrivalDate();
    const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey,
      itemKey: item.parentItemId ?? item.itemId, arrivalDate: new Date(`${arrivalDate}T00:00:00.000Z`) };
    if (params.recorded) {
      await client.productionScheduleGrindingPlanningBoardArrival.upsert({
        where: { csvDashboardId_siteKey_arrivalDate_itemKey: key }, create: key, update: {}
      });
    } else {
      await client.productionScheduleGrindingPlanningBoardArrival.deleteMany({ where: key });
    }
    return { itemId: params.itemId, manualArrivalDate: params.recorded ? arrivalDate : null };
  }, { timeout: 30000, maxWait: 15000 });
}

export async function updateGrindingPlanningBoardFirstProcessArrival(params: GrindingPlanningBoardFirstProcessArrivalRequest & {
  siteKey: string;
}): Promise<GrindingPlanningBoardFirstProcessArrivalResponse> {
  const sourceRowIds = await discoverSourceRows([params.itemId]);
  await ensurePlanningBoardState(params.siteKey);
  const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
  const pieceKeys = await readLivePieceKeys(prisma, [...sourceRowIds.values()]);
  return prisma.$transaction(async (client) => {
    const sourceRowId = sourceRowIds.get(params.itemId)!;
    await acquireSessakuPieceLogicalLocks(client, pieceKeys);
    if (pieceKeys.length) await lockState(client, params.siteKey);
    await acquireProductionScheduleParentRowLockInTransaction(client, sourceRowId);
    const current = await resolveCurrentProjectionInTransaction({ dueSource: params.dueSource, client, siteKey: params.siteKey,
      sourceRowIds: [sourceRowId], itemIds: [params.itemId], policy, allowPieceParent: true });
    const item = current.byItemId.get(params.itemId)!;
    assertItemRevision(params.itemRevision, item, params.overrideVersion);
    if (item.isCompleted) throw new ApiError(409, '完了済みの工程は変更できません', undefined, 'COMPLETED_ITEM');
    const [arrival] = await enrichRowsWithProcessArrival([{
      id: item.itemId, sourceRowId: item.sourceRowId,
      rowData: { FSEIBAN: item.fseiban, FHINCD: item.fhincd, ProductNo: item.productNo, FKOJUN: item.processOrder }
    }], { siteKey: params.siteKey, locationKey: params.siteKey, includeFirstProcess: true, placedProductNos: new Set(), client, policy });
    if (!arrival?.isFirstProcess) throw new ApiError(409, '最初の工程ではありません', undefined, 'NOT_FIRST_PROCESS');
    const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey,
      itemKey: item.parentItemId ?? item.itemId };
    if (params.state !== null) {
      const data = { state: params.state, recordedAt: new Date() };
      await client.productionScheduleGrindingPlanningBoardFirstProcessArrival.upsert({
        where: { csvDashboardId_siteKey_itemKey: key }, create: { ...key, ...data }, update: data
      });
    } else {
      await client.productionScheduleGrindingPlanningBoardFirstProcessArrival.deleteMany({ where: key });
    }
    return { itemId: params.itemId, firstProcessState: params.state };
  }, { timeout: 30000, maxWait: 15000 });
}
