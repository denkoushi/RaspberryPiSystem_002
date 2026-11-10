import type { Prisma } from '@prisma/client';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { dueManagementLearningEventRepository } from '../due-management-learning-event.repository.js';
import { releaseOrderAssignmentAtLocation } from '../order-assignment/order-assignment-release.repository.js';
import { findSessakuPieceWinner, readSessakuPieceSet, type SessakuPieceLogicalKey } from './piece-key.js';

export function aggregateSessakuPieceCompletion(pieces: readonly { isCompleted: boolean; quantity: number }[], externalCompleted: boolean, plannedQuantity: number | null = null): boolean {
  if (!pieces.length) return false;
  if (externalCompleted) return true;
  // Publication may restore a winner before its missing unfinished pieces are recreated.
  if (plannedQuantity != null && Number.isSafeInteger(plannedQuantity) && plannedQuantity <= 2_147_483_647 && pieces.reduce((total, piece) => total + piece.quantity, 0) < plannedQuantity) return false;
  return pieces.every((piece) => piece.isCompleted);
}
/** Caller holds the logical lock. All piece-derived Progress writes go through this function. */
export async function reconcileSessakuPieceProgress(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, options: { emptyIsIncomplete?: boolean; source?: {
  set: Awaited<ReturnType<typeof readSessakuPieceSet>>; rowId: string; externallyCompleted: boolean;
  previousCompleted: boolean | null; plannedQuantity: number | null;
} } = {}) {
  // Split/merge already read these facts under the same logical and parent-row locks.
  const set = options.source ? options.source.set : await readSessakuPieceSet(tx, key);
  const winner = options.source ? { id: options.source.rowId } : await findSessakuPieceWinner(tx, key);
  if (!set || !winner || (!set.pieces.length && !options.emptyIsIncomplete)) return null;
  const [external, previous, supplement] = options.source ? [
    { isExternallyCompleted: options.source.externallyCompleted },
    options.source.previousCompleted === null ? null : { isCompleted: options.source.previousCompleted },
    { plannedQuantity: options.source.plannedQuantity }
  ] as const : await Promise.all([
    tx.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: winner.id } }),
    tx.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: winner.id } }),
    tx.productionScheduleOrderSupplement.findUnique({ where: { csvDashboardRowId: winner.id }, select: { plannedQuantity: true } })
  ]);
  if (!set.pieces.length && set.sourcePieceSetId && previous?.isCompleted) return { sourceRowId: winner.id, parentIsCompleted: true };
  const isCompleted = aggregateSessakuPieceCompletion(set.pieces, external?.isExternallyCompleted === true, supplement?.plannedQuantity ?? set.plannedQuantity);
  if (!set.pieces.length && set.sourcePieceSetId && !previous && !isCompleted) return { sourceRowId: winner.id, parentIsCompleted: false };
  if (previous?.isCompleted !== isCompleted) {
    await tx.productionScheduleProgress.upsert({
      where: { csvDashboardRowId: winner.id },
      create: { csvDashboardRowId: winner.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, isCompleted },
      update: { isCompleted }
    });
    if (isCompleted) {
      const assignments = await tx.productionScheduleOrderAssignment.findMany({ where: { csvDashboardRowId: winner.id }, orderBy: { location: 'asc' } });
      for (const assignment of assignments) {
        await releaseOrderAssignmentAtLocation(tx, { csvDashboardRowId: winner.id, location: assignment.location });
      }
      await dueManagementLearningEventRepository.saveOutcomeEvent({
        locationKey: assignments[0]?.location ?? 'shared', eventType: 'manual_complete_set',
        csvDashboardRowId: winner.id, fseiban: key.fseiban, isCompleted: true, occurredAt: new Date(),
        metadata: { from: 'sessaku_piece_completion' }
      }, tx);
    }
  }
  return { sourceRowId: winner.id, parentIsCompleted: isCompleted };
}
