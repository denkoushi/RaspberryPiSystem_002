import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { sessakuPieceItemIds } from './piece-key.js';
import type { Prisma } from '@prisma/client';

type PieceRecordScope = { csvDashboardId: string; itemKey: string | { in: string[] } };
type PieceRef = Parameters<typeof sessakuPieceItemIds>[0];

export async function deletePieceArrivals(tx: Prisma.TransactionClient, where: PieceRecordScope) {
  await tx.productionScheduleGrindingPlanningBoardArrival.deleteMany({ where });
  await tx.productionScheduleGrindingPlanningBoardFirstProcessArrival.deleteMany({ where });
}

export async function deletePieceBoardRecords(tx: Prisma.TransactionClient, where: PieceRecordScope) {
  await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where });
  await deletePieceArrivals(tx, where);
}

const piecesScope = (pieces: readonly PieceRef[]) => ({
  csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, itemKey: { in: pieces.flatMap(sessakuPieceItemIds) }
});

export async function deletePieceArrivalsOf(tx: Prisma.TransactionClient, pieces: readonly PieceRef[]) {
  if (pieces.length) await deletePieceArrivals(tx, piecesScope(pieces));
}

/** Deletes pieces with their arrival rows; `withOverrides` also drops their placement overrides. */
export async function deletePiecesWithRecords(tx: Prisma.TransactionClient, pieces: readonly PieceRef[], withOverrides: boolean) {
  if (!pieces.length) return;
  if (withOverrides) await deletePieceBoardRecords(tx, piecesScope(pieces));
  else await deletePieceArrivals(tx, piecesScope(pieces));
  await tx.productionScheduleSessakuPiece.deleteMany({ where: { id: { in: pieces.map((piece) => piece.id) } } });
}
