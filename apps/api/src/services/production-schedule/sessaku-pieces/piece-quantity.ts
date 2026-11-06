import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { SessakuPieceQuantityWarning } from '@raspi-system/shared-types';
import { acquireSessakuPieceBoardStateLocks, findSessakuPieceWinner, readSessakuPieceSet, type SessakuPieceLogicalKey } from './piece-key.js';

export type QuantityPiece = { id: string; position: number; quantity: number; isCompleted: boolean };
export function planSessakuPieceQuantities(pieces: readonly QuantityPiece[], nextTotal: number | null, externalCompleted: boolean, nextPosition: number): {
  pieces: QuantityPiece[]; quantityWarning: SessakuPieceQuantityWarning | null; nextPosition: number;
} {
  const sorted = [...pieces].sort((a, b) => a.position - b.position).map((p) => ({ ...p }));
  if (!sorted.length) return { pieces: sorted, quantityWarning: null, nextPosition };
  if (nextTotal == null || !Number.isSafeInteger(nextTotal) || nextTotal < 0 || nextTotal > 2_147_483_647) {
    return { pieces: sorted, quantityWarning: 'INVALID_PLANNED_QUANTITY', nextPosition };
  }
  const completedTotal = sorted.filter((p) => p.isCompleted || externalCompleted).reduce((n, p) => n + p.quantity, 0);
  if (completedTotal > nextTotal) return { pieces: sorted, quantityWarning: 'COMPLETED_QUANTITY_EXCEEDS_PLAN', nextPosition };
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

/** Caller holds the logical lock. Does not publish Progress; call reconcileSessakuPieceProgress in the same tx. */
export async function reconcileSessakuPieceQuantities(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, nextTotal: number | null) {
  const set = await readSessakuPieceSet(tx, key);
  if (!set?.pieces.length) return false;
  const winner = await findSessakuPieceWinner(tx, key);
  const external = winner ? await tx.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: winner.id } }) : null;
  const plan = planSessakuPieceQuantities(set.pieces, nextTotal, external?.isExternallyCompleted === true, set.nextPosition);
  const plannedQuantity = nextTotal != null && Number.isSafeInteger(nextTotal) && nextTotal >= 0 && nextTotal <= 2_147_483_647 ? nextTotal : null;
  const ids = new Set(plan.pieces.map((p) => p.id));
  const removed = set.pieces.filter((p) => !ids.has(p.id)).map((p) => p.id);
  const changed = removed.length > 0 || plan.pieces.some((p) => set.pieces.find((old) => old.id === p.id)?.quantity !== p.quantity)
    || plannedQuantity !== set.plannedQuantity || plan.quantityWarning !== set.quantityWarning;
  if (!changed) return false;
  if (removed.length) {
    await acquireSessakuPieceBoardStateLocks(tx);
    await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { csvDashboardId: set.csvDashboardId, itemKey: { in: removed.map((id) => `piece:${id}`) } } });
    await tx.productionScheduleSessakuPiece.deleteMany({ where: { id: { in: removed } } });
  }
  for (const piece of plan.pieces) {
    const old = set.pieces.find((p) => p.id === piece.id);
    if (!old) await tx.productionScheduleSessakuPiece.create({ data: { ...piece, pieceSetId: set.id } });
    else if (old.quantity !== piece.quantity) await tx.productionScheduleSessakuPiece.update({ where: { id: piece.id }, data: { quantity: piece.quantity } });
  }
  await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { plannedQuantity, quantityWarning: plan.quantityWarning, nextPosition: plan.nextPosition, version: { increment: 1 } } });
  return true;
}
