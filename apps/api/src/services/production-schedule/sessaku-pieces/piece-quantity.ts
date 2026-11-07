import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { SessakuPieceQuantityWarning } from '@raspi-system/shared-types';
import { acquireSessakuPieceBoardStateLocks, findSessakuPieceWinner, readSessakuPieceSet, type SessakuPieceSet, type SessakuPieceLogicalKey } from './piece-key.js';
import { reconcileSessakuPieceProgress } from './piece-completion.js';

export type QuantityPiece = { id: string; position: number; quantity: number; isCompleted: boolean };
export function planSessakuPieceQuantities(pieces: readonly QuantityPiece[], nextTotal: number | null, externalCompleted: boolean, nextPosition: number): {
  pieces: QuantityPiece[]; quantityWarning: SessakuPieceQuantityWarning | null; nextPosition: number;
} {
  const sorted = [...pieces].sort((a, b) => a.position - b.position).map((p) => ({ ...p }));
  if (!sorted.length) return { pieces: sorted, quantityWarning: null, nextPosition };
  if (nextTotal == null || !Number.isSafeInteger(nextTotal) || nextTotal < 0 || nextTotal > 2_147_483_647) {
    return { pieces: sorted.filter((p) => p.quantity > 0), quantityWarning: 'INVALID_PLANNED_QUANTITY', nextPosition };
  }
  const completedTotal = sorted.filter((p) => p.isCompleted || externalCompleted).reduce((n, p) => n + p.quantity, 0);
  if (completedTotal > nextTotal) return { pieces: sorted.filter((p) => p.quantity > 0), quantityWarning: 'COMPLETED_QUANTITY_EXCEEDS_PLAN', nextPosition };
  let delta = nextTotal - sorted.reduce((n, p) => n + p.quantity, 0);
  const unfinished = sorted.filter((p) => !p.isCompleted && !externalCompleted).reverse();
  if (delta > 0) {
    if (unfinished[0]) unfinished[0].quantity += delta;
    else sorted.push({ id: randomUUID(), position: nextPosition++, quantity: delta, isCompleted: false });
  } else {
    for (const piece of unfinished) {
      const reduction = Math.min(piece.quantity, -delta);
      piece.quantity -= reduction;
      delta += reduction;
      if (delta === 0) break;
    }
  }
  return { pieces: sorted.filter((p) => p.quantity > 0), quantityWarning: null, nextPosition };
}

type LinkedQuantityPiece = QuantityPiece & { sourcePieceId: string | null };

/** Cutting quantities are the baseline; the later row's own plan absorbs the difference at its tail. */
export function planLaterProcessPieceQuantities(pieces: readonly LinkedQuantityPiece[], sources: readonly QuantityPiece[], nextTotal: number | null, externalCompleted: boolean, nextPosition: number, consolidateUnfinished = false) {
  if (nextTotal == null || !Number.isSafeInteger(nextTotal) || nextTotal < 0 || nextTotal > 2_147_483_647) {
    return { pieces: pieces.filter((piece) => piece.quantity > 0).map((piece) => ({ ...piece })), quantityWarning: 'INVALID_PLANNED_QUANTITY' as const, nextPosition };
  }
  // External completion protects existing evidence; it must not recreate missing source pieces.
  if (externalCompleted) {
    return { pieces: pieces.filter((piece) => piece.quantity > 0).map((piece) => ({ ...piece })),
      quantityWarning: pieces.reduce((sum, piece) => sum + piece.quantity, 0) > nextTotal ? 'COMPLETED_QUANTITY_EXCEEDS_PLAN' as const : null, nextPosition };
  }
  let lastPosition = 0;
  const baseline = sources.flatMap((source): LinkedQuantityPiece[] => {
    const previous = pieces.filter((piece) => piece.sourcePieceId === source.id);
    const completedTotal = previous.filter((piece) => piece.isCompleted || externalCompleted).reduce((sum, piece) => sum + piece.quantity, 0);
    let assignedUnfinished = false;
    const mapped = previous.flatMap((piece) => {
      if (piece.isCompleted || externalCompleted) return { ...piece };
      if (assignedUnfinished && consolidateUnfinished) return [];
      const quantity = assignedUnfinished ? 0 : Math.max(0, source.quantity - completedTotal);
      assignedUnfinished = true;
      return { ...piece, quantity };
    });
    if (!assignedUnfinished && completedTotal < source.quantity) {
      mapped.push({ id: randomUUID(), sourcePieceId: source.id, quantity: source.quantity - completedTotal, isCompleted: false, position: source.position });
    }
    return mapped.map((piece) => {
      lastPosition = Math.max(lastPosition + 1, source.position);
      return { ...piece, position: lastPosition };
    });
  });
  // Detached completed pieces remain evidence and count toward this process's plan.
  for (const piece of pieces.filter((piece) => piece.sourcePieceId === null && piece.isCompleted)) {
    baseline.push({ ...piece, position: ++lastPosition });
  }
  const plan = planSessakuPieceQuantities(baseline, nextTotal, externalCompleted, Math.max(nextPosition, lastPosition + 1));
  // Additional work after all later pieces completed still belongs to the final cutting piece.
  lastPosition = 0;
  const linked = plan.pieces.map((piece) => {
    const previous = baseline.find((old) => old.id === piece.id);
    const sourcePieceId = previous ? previous.sourcePieceId : sources[sources.length - 1]?.id ?? null;
    // Assign persisted positions only after zero quantities have been removed.
    const sourcePosition = sources.find((source) => source.id === sourcePieceId)?.position ?? 0;
    lastPosition = Math.max(lastPosition + 1, sourcePosition);
    return { ...piece, sourcePieceId, position: lastPosition };
  });
  return { ...plan, pieces: linked };
}

async function saveQuantityPlan(tx: Prisma.TransactionClient, set: SessakuPieceSet, plan: ReturnType<typeof planSessakuPieceQuantities>, nextTotal: number | null, sources?: Map<string, string | null>, deferRemoval = false) {
  plan = { ...plan, pieces: plan.pieces.filter((piece) => piece.quantity > 0) };
  const plannedQuantity = nextTotal != null && Number.isSafeInteger(nextTotal) && nextTotal >= 0 && nextTotal <= 2_147_483_647 ? nextTotal : null;
  const ids = new Set(plan.pieces.map((piece) => piece.id));
  const removed = set.pieces.filter((piece) => !ids.has(piece.id)).map((piece) => piece.id);
  const changed = removed.length > 0 || plan.pieces.some((piece) => {
    const old = set.pieces.find((old) => old.id === piece.id);
    return old?.quantity !== piece.quantity || old?.position !== piece.position;
  }) || plannedQuantity !== set.plannedQuantity || plan.quantityWarning !== set.quantityWarning;
  if (!changed) return false;
  if (removed.length && !deferRemoval) await removeQuantityPieces(tx, set.csvDashboardId, removed);
  // Move survivors out of the position range before a changed source order is applied.
  const moved = plan.pieces.some((piece) => { const old = set.pieces.find((old) => old.id === piece.id); return old && old.position !== piece.position; });
  if (moved) await tx.productionScheduleSessakuPiece.updateMany({ where: { pieceSetId: set.id }, data: { position: { increment: Math.max(set.nextPosition, ...set.pieces.map((piece) => piece.position), ...plan.pieces.map((piece) => piece.position)) + plan.pieces.length + 1 } } });
  for (const piece of plan.pieces) {
    const old = set.pieces.find((old) => old.id === piece.id);
    if (!old) await tx.productionScheduleSessakuPiece.create({ data: { ...piece, completedAt: piece.isCompleted ? new Date() : null, pieceSetId: set.id, sourcePieceId: sources?.get(piece.id) } });
    else if (moved || old.quantity !== piece.quantity) await tx.productionScheduleSessakuPiece.update({ where: { id: piece.id }, data: { quantity: piece.quantity, position: piece.position } });
  }
  await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { plannedQuantity, quantityWarning: plan.quantityWarning, nextPosition: plan.nextPosition, version: { increment: 1 } } });
  return true;
}
async function removeQuantityPieces(tx: Prisma.TransactionClient, csvDashboardId: string, ids: string[]) {
  await acquireSessakuPieceBoardStateLocks(tx);
  await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { csvDashboardId, itemKey: { in: ids.map((id) => `piece:${id}`) } } });
  await tx.productionScheduleSessakuPiece.deleteMany({ where: { id: { in: ids } } });
}
async function readQuantitySource(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey) {
  const winner = await findSessakuPieceWinner(tx, key);
  if (!winner) return { hasWinner: false, external: false, manualCompleted: false, plannedQuantity: null };
  const [external, supplement, progress] = await Promise.all([
    tx.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: winner.id } }),
    tx.productionScheduleOrderSupplement.findUnique({ where: { csvDashboardRowId: winner.id } }),
    tx.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: winner.id } })
  ]);
  return { hasWinner: true, manualCompleted: progress?.isCompleted === true, external: external?.isExternallyCompleted === true, plannedQuantity: supplement?.plannedQuantity ?? null };
}

/** Caller holds all related logical locks. Progress for the requested row is published by its caller. */
export async function reconcileSessakuPieceQuantities(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, nextTotal: number | null, consolidateUnfinished = false): Promise<boolean> {
  const set = await readSessakuPieceSet(tx, key);
  if (!set || !set.pieces.length && !set.sourcePieceSetId) return false;
  const source = await readQuantitySource(tx, key);
  const linked = set.pieces.filter((piece) => piece.sourcePieceId);
  if (linked.length || set.sourcePieceSetId) {
    if (!source.hasWinner) return false;
    const cutting = set.sourcePieceSetId
      ? await tx.productionScheduleSessakuPieceSet.findUnique({ where: { id: set.sourcePieceSetId }, include: { pieces: { orderBy: { position: 'asc' } } } })
      : (await tx.productionScheduleSessakuPiece.findFirst({ where: { id: linked[0].sourcePieceId! }, include: { pieceSet: { include: { pieces: { orderBy: { position: 'asc' } } } } } }))?.pieceSet;
    if (!cutting) return false;
    if (!set.sourcePieceSetId) await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { sourcePieceSetId: cutting.id } });
    const cuttingSource = await readQuantitySource(tx, cutting);
    const total = nextTotal ?? cuttingSource.plannedQuantity ?? cutting.pieces.reduce((sum, piece) => sum + piece.quantity, 0);
    const plan = planLaterProcessPieceQuantities(set.pieces, cutting.pieces, total, source.external, set.nextPosition, consolidateUnfinished);
    if (!set.pieces.length && source.manualCompleted) plan.pieces = plan.pieces.map((piece) => ({ ...piece, isCompleted: true }));
    return saveQuantityPlan(tx, set, plan, total, new Map(plan.pieces.map((piece) => [piece.id, piece.sourcePieceId])));
  }
  const later = await tx.productionScheduleSessakuPieceSet.findMany({
    where: { csvDashboardId: set.csvDashboardId, OR: [{ sourcePieceSetId: set.id }, { pieces: { some: { sourcePieceId: { in: set.pieces.map((piece) => piece.id) } } } }] },
    include: { pieces: { orderBy: { position: 'asc' } } }
  });
  const plan = planSessakuPieceQuantities(set.pieces, nextTotal, source.external, set.nextPosition);
  const removed = set.pieces.filter((piece) => !plan.pieces.some((next) => next.id === piece.id)).map((piece) => piece.id);
  // Never discard completed evidence in a later process to satisfy a reduced cutting plan.
  const laterDetails = await Promise.all(later.map((process) => readQuantitySource(tx, process)));
  const plannedTotal = plan.pieces.reduce((sum, piece) => sum + piece.quantity, 0);
  const cuttingShrinks = plannedTotal < set.pieces.reduce((sum, piece) => sum + piece.quantity, 0);
  if (later.some((process, index) => laterDetails[index].hasWinner && (
    (cuttingShrinks && process.pieces.filter((piece) => piece.isCompleted || laterDetails[index].external).reduce((sum, piece) => sum + piece.quantity, 0) > plannedTotal)
    || set.pieces.some((cutting) => {
      const completed = process.pieces.filter((piece) => piece.sourcePieceId === cutting.id && (piece.isCompleted || laterDetails[index].external)).reduce((sum, piece) => sum + piece.quantity, 0);
      const nextQuantity = plan.pieces.find((piece) => piece.id === cutting.id)?.quantity ?? 0;
      return nextQuantity < cutting.quantity && completed > nextQuantity;
    })))) {
    plan.pieces = set.pieces;
    plan.quantityWarning = 'COMPLETED_QUANTITY_EXCEEDS_PLAN';
    removed.length = 0;
  }
  // Invalid later plans retain their source references; retain the cutting pieces too.
  if (removed.length && later.some((process, index) => {
    const detail = laterDetails[index];
    if (!detail.hasWinner) return false;
    const total = detail.plannedQuantity ?? nextTotal ?? plan.pieces.reduce((sum, piece) => sum + piece.quantity, 0);
    return planLaterProcessPieceQuantities(process.pieces as LinkedQuantityPiece[], plan.pieces, total, detail.external, process.nextPosition).pieces
      .some((piece) => piece.sourcePieceId !== null && removed.includes(piece.sourcePieceId));
  })) {
    plan.pieces = set.pieces;
    plan.quantityWarning = 'INVALID_PLANNED_QUANTITY';
    removed.length = 0;
  }
  const changed = await saveQuantityPlan(tx, set, plan, nextTotal, undefined, true);
  for (const [index, process] of later.entries()) {
    const detail = laterDetails[index];
    if (!detail.hasWinner) {
      const references = process.pieces.filter((piece) => piece.sourcePieceId && removed.includes(piece.sourcePieceId));
      if (references.length) {
        await removeQuantityPieces(tx, set.csvDashboardId, references.filter((piece) => !piece.isCompleted).map((piece) => piece.id));
        await tx.productionScheduleSessakuPiece.updateMany({ where: { id: { in: references.filter((piece) => piece.isCompleted).map((piece) => piece.id) } }, data: { sourcePieceId: null } });
        await tx.productionScheduleSessakuPieceSet.update({ where: { id: process.id }, data: { version: { increment: 1 } } });
      }
      continue;
    }
    if (!process.sourcePieceSetId) await tx.productionScheduleSessakuPieceSet.update({ where: { id: process.id }, data: { sourcePieceSetId: set.id } });
    const total = detail.plannedQuantity ?? nextTotal ?? plan.pieces.reduce((sum, piece) => sum + piece.quantity, 0);
    const laterPlan = planLaterProcessPieceQuantities(process.pieces as LinkedQuantityPiece[], plan.pieces, total, detail.external, process.nextPosition);
    if (!process.pieces.length && detail.manualCompleted) laterPlan.pieces = laterPlan.pieces.map((piece) => ({ ...piece, isCompleted: true }));
    await saveQuantityPlan(tx, process, laterPlan, total, new Map(laterPlan.pieces.map((piece) => [piece.id, piece.sourcePieceId])));
    await reconcileSessakuPieceProgress(tx, process, { emptyIsIncomplete: true });
  }
  if (removed.length) await removeQuantityPieces(tx, set.csvDashboardId, removed);
  return changed;
}
