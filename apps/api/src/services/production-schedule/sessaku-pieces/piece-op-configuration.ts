import type { SessakuPieceOpsConfigureRequest, SessakuPieceOpsClearRequest, SessakuPiecesMutationResponse } from '@raspi-system/shared-types';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { getGrindingPlanningBoardResourceMinutes, saveGrindingPlanningBoardResourcePartMinutes } from '../grinding-planning-board-resource-minutes.service.js';
import { runSessakuPieceOperation, type PieceAuditContext } from './piece-audit.js';
import { sessakuPieceIdFromItemId, resolveSessakuPieceItemKeys, sessakuPieceParentItemId, sessakuPieceItemIds } from './piece-key.js';
import { replaceSiteItems, flushSiteItems } from './piece-lane-writes.js';
import { assertNoOperationCompletions, rememberPieceHistory } from './piece-op-splits.js';
import { sessakuPieceOpsConfigureSchema, sessakuPieceOpsClearSchema } from './sessaku-pieces.schemas.js';
import type { PieceOpSplitDependencies } from './sessaku-pieces.service.js';

type Request = (SessakuPieceOpsConfigureRequest | SessakuPieceOpsClearRequest) & { siteKey: string; audit?: PieceAuditContext };

export async function mutateSessakuPieceOperationConfiguration(input: Request, dependencies: PieceOpSplitDependencies): Promise<SessakuPiecesMutationResponse> {
  const configure = 'minutes' in input;
  const body = configure ? sessakuPieceOpsConfigureSchema.parse(input) : sessakuPieceOpsClearSchema.parse(input);
  const params = { ...input, ...body };
  const pieceId = sessakuPieceIdFromItemId(params.itemId)!;
  const action = configure ? 'op_configure' : 'op_clear';
  if (!params.audit) return runSessakuPieceOperation({ action, siteKey: params.siteKey, pieceIds: [pieceId],
    expectedVersion: params.expectedPieceSetVersion, itemRevision: params.itemRevision },
  (audit) => mutateSessakuPieceOperationConfiguration({ ...params, audit }, dependencies));
  if (configure && process.env.SESSAKU_PIECES_CREATE_ENABLED !== 'true') {
    throw new ApiError(403, '分割作成は無効です', undefined, 'SESSAKU_PIECES_CREATE_DISABLED');
  }
  const key = (await resolveSessakuPieceItemKeys(prisma, [params.itemId])).get(params.itemId)!;
  const { operate, assertCuttingPieceSet, assertRevision, beforeProjections, saveSiteVersions } = dependencies;
  const conflict: PieceOpSplitDependencies['conflict'] = dependencies.conflict;
  return operate({ ...params, lockOperationDefinition: configure, parentItemId: sessakuPieceParentItemId(key) }, async (tx, c) => {
    assertCuttingPieceSet(c.set);
    const item = c.current.pieces.find((candidate) => candidate.itemId === params.itemId);
    const piece = c.set?.pieces.find((candidate) => candidate.id === pieceId);
    assertRevision(item, params.itemRevision);
    if (!item || !piece || !c.set) conflict();
    if (c.external) conflict('EXTERNALLY_COMPLETED_ITEM');
    if (c.set.quantityWarning) conflict('PIECE_QUANTITY_CONFLICT');
    if (piece.quantity !== 1) conflict('PIECE_NOT_UNIT');
    const targets = configure ? c.set.pieces.filter((candidate) => candidate.quantity === 1 && !candidate.isCompleted
      && c.current.pieces.some((bar) => bar.pieceId === candidate.id && bar.effectiveResourceCd === ('resourceCd' in params ? params.resourceCd : null)))
      : 'scope' in params && params.scope === 'set' ? c.set.pieces.filter((candidate) => !candidate.isCompleted) : [piece];
    if (configure) await assertNoOperationCompletions(tx, targets.map((candidate) => candidate.id));
    if (targets.some((candidate) => candidate.isCompleted)) conflict('COMPLETED_PIECE');
    if (configure && (!item.effectiveResourceCd || !('resourceCd' in params) || params.resourceCd !== item.effectiveResourceCd)) conflict();
    const removed = targets.flatMap(sessakuPieceItemIds);
    const before = await beforeProjections(tx, c.sites, c.key, removed, c.later, params.audit, params.dueSource);
    let opNos: number[] = [];
    if ('minutes' in params) {
      const settings = await getGrindingPlanningBoardResourceMinutes({ siteKey: params.siteKey }, tx);
      const previous = settings.values.find((value) => value.resourceCd === params.resourceCd && value.fhincd === item.fhincd.trim());
      const previousOps = [...(previous?.ops ?? [])].sort((a, b) => a.opNo - b.opNo);
      opNos = previousOps.slice(0, params.minutes.length).map((op) => op.opNo);
      while (opNos.length < params.minutes.length) {
        const nextNo = Math.max(0, ...opNos) + 1;
        if (nextNo > 20) throw new ApiError(409, '工程番号が上限です。工程を増やせません', undefined, 'OPERATION_NUMBER_LIMIT');
        opNos.push(nextNo);
      }
      const removedOpNos = previousOps.filter((op) => !opNos.includes(op.opNo)).map((op) => op.opNo);
      if (removedOpNos.length && await tx.productionScheduleSessakuPieceOpSplit.findFirst({ where: {
        fromOpNo: { in: removedOpNos }, pieceId: { notIn: targets.map((target) => target.id) },
        piece: { pieceSet: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          fhincd: { in: [...new Set([c.key.fhincd, ...(c.definitionKeys ?? []).map((key) => key.fhincd)])] } } }
      }, select: { pieceId: true } })) {
        throw new ApiError(409, '別のロットや対象外の台が工程で分かれています。先にまとめてください', undefined, 'OPERATION_SPLIT_IN_USE');
      }
      const setup = previous?.setupMinutes ?? item.setupMinutes ?? 0;
      const ops = params.minutes.map((minutes, index) => {
        const previousOp = previousOps.find((op) => op.opNo === opNos[index]);
        return { opNo: opNos[index], minutes, setupMinutes: previousOps.length
          ? previousOp ? previousOp.setupMinutes ?? null : 0 : index === 0 ? setup : 0 };
      });
      await saveGrindingPlanningBoardResourcePartMinutes(tx, { siteKey: params.siteKey, resourceCd: params.resourceCd,
        fhincd: item.fhincd, perUnitMinutes: params.minutes.reduce((sum, value) => sum + value, 0),
        setupMinutes: ops.reduce((sum, op) => sum + (op.setupMinutes ?? 0), 0), ops,
        expectedOpIds: params.expectedOpIds, expectedMinutes: params.expectedMinutes }, c.definitionKeys);
    }
    for (const target of targets) {
      const oldIds = sessakuPieceItemIds(target);
      const boundaries = [...(target.opSplits ?? [])].sort((a, b) => a.fromOpNo - b.fromOpNo);
      await tx.productionScheduleSessakuPieceOpSplit.deleteMany({ where: { pieceId: target.id } });
      if (opNos.length > 1) await tx.productionScheduleSessakuPieceOpSplit.createMany({ data: opNos.slice(1).map((fromOpNo, index) => ({
        pieceId: target.id, fromOpNo, sourceResourceCd: item.effectiveResourceCd!, leadingSourceResourceCd: index === 0 ? item.effectiveResourceCd! : null
      })) });
      const headId = `piece:${target.id}`;
      const newIds = [headId, ...opNos.slice(1).map((opNo) => `pieceops:${target.id}:${opNo}`)];
      for (const site of c.sites) {
        // Clearing only removes suffix bars, preserving the head's placement on every site.
        const state = before.get(site)!;
        if (!configure) await replaceSiteItems(tx, c.key, state, site, oldIds.filter((id) => id !== headId), [], params.audit);
        else {
          // Replace each old interval separately so moved intervals keep this site's placement.
          for (const oldId of oldIds) {
            const replacements = newIds.filter((id, index) => {
              const boundary = boundaries.filter((split) => split.fromOpNo <= opNos[index]).at(-1);
              return (index === 0 || !boundary ? headId : `pieceops:${target.id}:${boundary.fromOpNo}`) === oldId;
            });
            await replaceSiteItems(tx, c.key, state, site, [oldId], replacements, params.audit);
          }
        }
      }
    }
    // Completed bars/hidden sites may be outside the unfinished lane writer.
    const obsolete = removed.filter((id) => id.startsWith('pieceops:') && (!configure || !opNos.slice(1).some((opNo) => id.endsWith(`:${opNo}`))));
    if (obsolete.length) await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, itemKey: { in: obsolete }
    } });
    await tx.productionScheduleSessakuPieceSet.update({ where: { id: c.set.id }, data: { version: { increment: 1 } } });
    await rememberPieceHistory(tx, c.key);
    await flushSiteItems(tx, before, params.audit);
    await saveSiteVersions(tx, before);
    Object.assign(params.audit!, { pieceIds: targets.map((target) => target.id), afterJson: { action, opNos, scope: 'scope' in params ? params.scope : 'set' } });
  });
}
