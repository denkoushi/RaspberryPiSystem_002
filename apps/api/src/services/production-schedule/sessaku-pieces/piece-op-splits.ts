import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { SessakuPieceOpMergeRequest, SessakuPiecesMutationResponse } from '@raspi-system/shared-types';
import { prisma } from '../../../lib/prisma.js';
import { runSessakuPieceOperation } from './piece-audit.js';
import { ApiError } from '../../../lib/errors.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { getGrindingPlanningBoardResourceCapacity } from '../grinding-planning-board-resource-capacity.service.js';
import { getGrindingPlanningBoardResourceMinutes } from '../grinding-planning-board-resource-minutes.service.js';
import { replaceSiteItems, flushSiteItems } from './piece-lane-writes.js';
import { sessakuPieceIdFromItemId, resolveSessakuPieceItemKeys, sessakuPieceSetWhere, type SessakuPieceLogicalKey, sessakuPieceItemIds, sessakuPieceParentItemId } from './piece-key.js';
import { isUnitSplitEnabled } from './unit-split-policy.js';
import type { PieceAuditContext } from './piece-audit.js';
import type { PieceOpSplitContext, PieceOpSplitDependencies } from './sessaku-pieces.service.js';

export async function writePieceOpSplit(tx: Prisma.TransactionClient, c: PieceOpSplitContext,
  params: SessakuPieceOpMergeRequest & { fromOpNo?: number; siteKey: string; audit?: PieceAuditContext },
  merge: boolean, pieceId: string, dependencies: PieceOpSplitDependencies) {
  const { assertCuttingPieceSet, assertRevision, beforeProjections, saveSiteVersions } = dependencies;
  const conflict: PieceOpSplitDependencies['conflict'] = dependencies.conflict;
    assertCuttingPieceSet(c.set);
    const piece = c.set?.pieces.find((candidate) => candidate.id === pieceId);
    const item = c.current.pieces.find((candidate) => candidate.itemId === params.itemId);
    assertRevision(item, params.itemRevision);
    if (!piece || !c.set || !item) conflict();
    if (c.external) conflict('EXTERNALLY_COMPLETED_ITEM');
    if (c.set.quantityWarning) conflict('PIECE_QUANTITY_CONFLICT');
    const splits = [...(piece.opSplits ?? [])].sort((a, b) => a.fromOpNo - b.fromOpNo);
    const source = item.effectiveResourceCd;
    let boundary: number;
    if (merge) {
      if (!item.opRange || params.itemId === `piece:${pieceId}`) throw new ApiError(400, '対象の境目がありません', undefined, 'INVALID_PIECE_OP_BOUNDARY');
      boundary = item.opRange.fromOpNo;
    } else {
      const capacity = await getGrindingPlanningBoardResourceCapacity({ siteKey: params.siteKey }, tx);
      if (piece.quantity !== 1 || (!splits.length && !isUnitSplitEnabled(source, capacity))) conflict('PIECE_NOT_UNIT');
      const available = (item.ops ?? []).map((op) => op.opNo).sort((a, b) => a - b);
      boundary = params.fromOpNo!;
      if (!Number.isInteger(boundary) || available.length < 2 || boundary <= available[0] || !available.includes(boundary)) {
        throw new ApiError(400, '工程の境目が不正です', undefined, 'INVALID_PIECE_OP_BOUNDARY');
      }
      // The destination machine must define the entire interval being split.
      const settings = await getGrindingPlanningBoardResourceMinutes({ siteKey: params.siteKey }, tx);
      const definition = settings.values.find((value) => value.resourceCd === source && value.fhincd === item.fhincd.trim());
      if (!source || !available.every((opNo) => definition?.ops?.some((op) => op.opNo === opNo))) conflict('PIECE_OPERATION_NOT_CONFIGURED');
    }
    const oldIds = sessakuPieceItemIds(piece);
    const removed = [params.itemId];
    const before = await beforeProjections(tx, c.sites, c.key, removed, c.later, params.audit, params.dueSource);
    if (merge) {
      const index = splits.findIndex((split) => split.fromOpNo === boundary);
      if (index < 0) conflict();
      if (index === 0 && splits[1]) await tx.productionScheduleSessakuPieceOpSplit.update({
        where: { pieceId_fromOpNo: { pieceId, fromOpNo: splits[1].fromOpNo } },
        data: { leadingSourceResourceCd: splits[0].leadingSourceResourceCd ?? splits[0].sourceResourceCd }
      });
      await tx.productionScheduleSessakuPieceOpSplit.delete({ where: { pieceId_fromOpNo: { pieceId, fromOpNo: boundary } } });
      // Removal alone leaves the previous interval's own placement untouched.
      for (const site of c.sites) await replaceSiteItems(tx, c.key, before.get(site)!, site, removed, [], params.audit);
      await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, itemKey: params.itemId
      } });
    } else {
      if (splits.length && params.itemId === `piece:${pieceId}` && boundary > splits[0].fromOpNo) conflict();
      if (splits.length && params.itemId !== `piece:${pieceId}`) await tx.productionScheduleSessakuPieceOpSplit.update({
        where: { pieceId_fromOpNo: { pieceId, fromOpNo: item.opRange!.fromOpNo } }, data: { sourceResourceCd: source! }
      });
      await tx.productionScheduleSessakuPieceOpSplit.create({ data: { pieceId, fromOpNo: boundary, sourceResourceCd: source!,
        leadingSourceResourceCd: !splits.length || params.itemId === `piece:${pieceId}` ? source! : null } });
      // Preserve the head when its old boundary stops being the first one.
      if (splits.length && boundary < splits[0].fromOpNo) await tx.productionScheduleSessakuPieceOpSplit.update({
        where: { pieceId_fromOpNo: { pieceId, fromOpNo: splits[0].fromOpNo } }, data: { leadingSourceResourceCd: null }
      });
      for (const site of c.sites) {
        const state = before.get(site)!;
        const original = state.pieces.find((candidate) => candidate.itemId === params.itemId)!;
        const inherited = state.overrides.get(params.itemId) ?? state.overrides.get(sessakuPieceParentItemId(c.key));
        const addedId = `pieceops:${pieceId}:${boundary}`;
        await replaceSiteItems(tx, c.key, state, site, removed, [params.itemId, addedId], params.audit);
        // Completed bars are outside the unfinished lane writer, but inherit placement too.
        if (!state.overrides.has(addedId)) {
          const now = new Date();
          state.overrides.set(addedId, { id: randomUUID(), csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            siteKey: site, itemKey: addedId, overrideResourceCd: original.effectiveResourceCd,
            overrideDueDate: inherited?.overrideDueDate ?? null, overrideDueDateSetAt: inherited?.overrideDueDateSetAt ?? null, dueDateCleared: inherited?.dueDateCleared ?? null,
            orderPinned: inherited?.orderPinned ?? false, specialDueKind: inherited?.specialDueKind ?? null,
            specialDueExpiresAt: inherited?.specialDueExpiresAt ?? null,
            alternateRank: original.alternateRank == null ? null : original.alternateRank + 1,
            version: 1, createdAt: now, updatedAt: now });
          state.laneWrites.pending.add(addedId);
        }
      }
    }
    await tx.productionScheduleSessakuPieceSet.update({ where: { id: c.set.id }, data: { version: { increment: 1 } } });
    await rememberPieceHistory(tx, c.key);
    await flushSiteItems(tx, before, params.audit);
    await saveSiteVersions(tx, before);
    params.audit!.beforeJson = { ...params.audit!.beforeJson, opSplitItemIds: oldIds };
    params.audit!.afterJson = { fromOpNo: boundary, sourceResourceCd: source, merge };
}

export async function mutateSessakuPieceOps(params: SessakuPieceOpMergeRequest & { fromOpNo?: number; siteKey: string; audit?: PieceAuditContext }, merge: boolean, dependencies: PieceOpSplitDependencies): Promise<SessakuPiecesMutationResponse> {
  const { operate } = dependencies;
  const pieceId = sessakuPieceIdFromItemId(params.itemId);
  if (!pieceId) throw new ApiError(400, '対象アイテムIDが不正です', undefined, 'INVALID_ITEM_ID');
  if (!params.audit) return runSessakuPieceOperation({ action: merge ? 'op_merge' : 'op_split', siteKey: params.siteKey,
    pieceIds: [pieceId], expectedVersion: params.expectedPieceSetVersion, itemRevision: params.itemRevision },
    (audit) => mutateSessakuPieceOps({ ...params, audit }, merge, dependencies));
  if (!merge && process.env.SESSAKU_PIECES_CREATE_ENABLED !== 'true') throw new ApiError(403, '分割作成は無効です', undefined, 'SESSAKU_PIECES_CREATE_DISABLED');
  const key = (await resolveSessakuPieceItemKeys(prisma, [params.itemId])).get(params.itemId)!;
  return operate({ ...params, parentItemId: sessakuPieceParentItemId(key) }, async (tx, c) => {
    await writePieceOpSplit(tx, c, params, merge, pieceId, dependencies);
  });
}


export async function rememberPieceHistory(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey) {
  const logicalKey = sessakuPieceSetWhere(key);
  await tx.productionScheduleSessakuPieceHistory.upsert({
    where: { csvDashboardId_fseiban_fhincd_fsigencd_fkojun: logicalKey }, create: logicalKey, update: {}
  });
}

export async function assertNoOperationCompletions(tx: Prisma.TransactionClient, pieceIds: string[]) {
  if (!pieceIds.length) return;
  const completion = await tx.productionScheduleSessakuPieceOpCompletion.findFirst({
    where: { pieceId: { in: pieceIds } }, select: { pieceId: true }
  });
  if (completion) throw new ApiError(409, '片が更新されています。再読み込みしてください', undefined, 'PIECE_OPERATION_COMPLETED');
}

