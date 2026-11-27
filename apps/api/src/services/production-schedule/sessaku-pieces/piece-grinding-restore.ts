import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { readOverrides } from '../grinding-planning-board/source.js';
import { STRING_TRIM_CHARACTERS } from '../grinding-planning-board/shared.js';
import { stateOrder } from '../grinding-planning-board/state.js';
import { writeOverrideIfChanged } from '../grinding-planning-board/write.js';
import { STATIC_GRINDING_RESOURCE_CDS } from '../policies/resource-category-policy.service.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { replaceSiteItems, flushSiteItems } from './piece-lane-writes.js';
import { acquireSessakuPieceBoardStateLocks, acquireSessakuPieceLogicalLocks, readSessakuPieceSet, sessakuPieceIdFromItemId, sessakuPieceItemIds, sessakuPieceParentItemId, type SessakuPieceLogicalKey } from './piece-key.js';
import { beforeProjections, saveSiteVersions } from './sessaku-pieces.service.js';

async function restoreGrindingLaterPieceSet(candidate: SessakuPieceLogicalKey & { id: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('lock_timeout', '250ms', true), set_config('statement_timeout', '5000ms', true)`;
    await acquireFkojunstStatusMailCriticalTransactionLock(tx);
    await acquireSessakuPieceLogicalLocks(tx, [candidate]);
    const set = await readSessakuPieceSet(tx, candidate);
    if (!set || set.id !== candidate.id || (!set.sourcePieceSetId && !set.pieces.some((piece) => piece.sourcePieceId))) return;
    if (set.pieces.some((piece) => piece.isCompleted || piece.completedAt || piece.opSplits?.length)) return 'retained';
    const hasPieceEvidenceOrDependents = await tx.productionScheduleSessakuPieceSet.findFirst({
      where: { id: set.id, OR: [
        { laterProcessSets: { some: {} } },
        { pieces: { some: { OR: [{ opCompletions: { some: {} } }, { laterProcessPieces: { some: {} } }] } } }
      ] }, select: { id: true }
    });
    if (hasPieceEvidenceOrDependents) return 'retained';
    await acquireSessakuPieceBoardStateLocks(tx);
    const itemIds = set.pieces.flatMap(sessakuPieceItemIds);
    const pieceIds = new Set(set.pieces.map((piece) => piece.id));
    // An obsolete operation item can still have an arrival even if its split is gone.
    const pieceRecords = { csvDashboardId: set.csvDashboardId, OR: [
      { itemKey: { in: itemIds } }, ...set.pieces.map(({ id }) => ({ itemKey: { startsWith: `pieceops:${id}:` } }))
    ] };
    const [arrived, firstArrived] = await Promise.all([
      tx.productionScheduleGrindingPlanningBoardArrival.findFirst({ where: pieceRecords, select: { id: true } }),
      tx.productionScheduleGrindingPlanningBoardFirstProcessArrival.findFirst({ where: pieceRecords, select: { id: true } })
    ]);
    if (arrived || firstArrived) return 'retained';

    const parentId = sessakuPieceParentItemId(set);
    const [states, overrides] = await Promise.all([
      tx.productionScheduleGrindingPlanningBoardState.findMany({ where: { csvDashboardId: set.csvDashboardId } }),
      tx.productionScheduleGrindingPlanningBoardOverride.findMany({ where: pieceRecords })
    ]);
    const overrideSites = new Set(overrides.map(({ siteKey }) => siteKey));
    const sites = states.filter((state) => overrideSites.has(state.siteKey) || stateOrder(state).includes(set.fseiban.trim())).map(({ siteKey }) => siteKey);
    const before = itemIds.length && sites.length ? await beforeProjections(tx, sites, set, itemIds, []) : new Map() as Awaited<ReturnType<typeof beforeProjections>>;
    for (const [siteKey, placement] of before) {
      await replaceSiteItems(tx, set, placement, siteKey, itemIds, [parentId]);
    }
    for (const siteKey of overrideSites) {
      const placement = before.get(siteKey);
      if (placement?.laneWrites.pending.has(parentId)) continue;
      // Winnerless or unregistered sites have no projected bar to replace.
      const siteOverrides = overrides.filter((override) => override.siteKey === siteKey);
      const first = set.pieces.map(({ id }) => siteOverrides.find(({ itemKey }) => itemKey === `piece:${id}`)
        ?? siteOverrides.find(({ itemKey }) => sessakuPieceIdFromItemId(itemKey) === id)).find(Boolean);
      if (!first) continue;
      const current = (await readOverrides(tx, siteKey, [parentId])).get(parentId);
      await writeOverrideIfChanged(tx, siteKey, parentId, current, first);
      if (placement) placement.stateVersionIncrements = 1;
    }
    await flushSiteItems(tx, before);
    if (overrides.length) await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: pieceRecords });
    await tx.productionScheduleSessakuPieceSet.delete({ where: { id: set.id } });
    await saveSiteVersions(tx, before);
    for (const state of states) {
      if (!Array.isArray(state.seibanOrder)) continue;
      const order = state.seibanOrder.filter((item) => typeof item !== 'string' || !pieceIds.has(sessakuPieceIdFromItemId(item.trim()) ?? ''));
      if (order.length !== state.seibanOrder.length) await tx.productionScheduleGrindingPlanningBoardState.update({
        where: { id: state.id }, data: { seibanOrder: order, ...(!before.get(state.siteKey)?.stateVersionIncrements && { version: { increment: 1 } }) }
      });
    }
    return 'restored';
  }, { maxWait: 1000, timeout: 5000 });
}

const GRINDING_RESTORE_BATCH_SIZE = 5;

export async function restoreGrindingLaterPieceSets(after = '') {
  const candidates = await prisma.$queryRaw<Array<SessakuPieceLogicalKey & { id: string }>>`
    SELECT s."id", s."fseiban", s."fhincd", s."fsigencd", s."fkojun", s."productNo"
    FROM "ProductionScheduleSessakuPieceSet" s
    WHERE s."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND s."id" > ${after}
      AND UPPER(BTRIM(s."fsigencd", ${STRING_TRIM_CHARACTERS})) = ANY(${[...STATIC_GRINDING_RESOURCE_CDS]}::text[])
      AND (s."sourcePieceSetId" IS NOT NULL OR EXISTS (
        SELECT 1 FROM "ProductionScheduleSessakuPiece" p WHERE p."pieceSetId" = s."id" AND p."sourcePieceId" IS NOT NULL))
    ORDER BY s."id" LIMIT ${GRINDING_RESTORE_BATCH_SIZE + 1}`;
  const batch = candidates.slice(0, GRINDING_RESTORE_BATCH_SIZE);
  let restoredCount = 0;
  let retainedCount = 0;
  let failedCount = 0;
  for (const candidate of batch) {
    try {
      const result = await restoreGrindingLaterPieceSet(candidate);
      if (result === 'retained') retainedCount += 1;
      if (result === 'restored') restoredCount += 1;
    } catch (err) {
      failedCount += 1;
      logger.warn({ event: 'sessaku_piece.grinding_restore_error', pieceSetId: candidate.id, err }, 'Grinding piece set restore failed');
    }
  }
  return { restoredCount, retainedCount, failedCount, nextCursor: candidates.length > batch.length ? batch.at(-1)?.id : undefined };
}
