import type { Prisma } from '@prisma/client';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { dueManagementLearningEventRepository } from '../due-management-learning-event.repository.js';
import { releaseOrderAssignmentAtLocation } from '../order-assignment/order-assignment-release.repository.js';
import { findSessakuPieceWinner, readSessakuPieceSet, type SessakuPieceLogicalKey } from './piece-key.js';

export function aggregateSessakuPieceCompletion(pieces: readonly { isCompleted: boolean }[], externalCompleted: boolean): boolean {
  return pieces.length > 0 && pieces.every((piece) => piece.isCompleted || externalCompleted);
}
/** Caller holds the logical lock. All piece-derived Progress writes go through this function. */
export async function reconcileSessakuPieceProgress(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, options: { emptyIsIncomplete?: boolean } = {}) {
  const set = await readSessakuPieceSet(tx, key);
  const winner = await findSessakuPieceWinner(tx, key);
  if (!set || !winner || (!set.pieces.length && !options.emptyIsIncomplete)) return null;
  const [external, previous] = await Promise.all([
    tx.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: winner.id } }),
    tx.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: winner.id } })
  ]);
  if (!set.pieces.length && set.sourcePieceSetId && previous?.isCompleted) return { sourceRowId: winner.id, parentIsCompleted: true };
  const isCompleted = aggregateSessakuPieceCompletion(set.pieces, external?.isExternallyCompleted === true);
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
