import { ApiError } from '../../../lib/errors.js';
import { Prisma } from '@prisma/client';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { readWinnerRowsByLogicalKeyFseibans, readRowDetails } from '../grinding-planning-board/source.js';
import { isLaterProcessOrder } from '../process-order.js';
import { readSessakuPieceSet, readSessakuPieceSets, sessakuPieceKeyFromRow, encodeSessakuPieceKey, supportsSessakuPieceRelations, type SessakuPieceLogicalKey } from './piece-key.js';

export type LaterProcess = { key: SessakuPieceLogicalKey; rowId?: string; set: Awaited<ReturnType<typeof readSessakuPieceSet>>; plannedQuantity: number | null; completed: boolean; hasWinner: boolean; externallyCompleted: boolean; previousCompleted: boolean | null };

export async function readLaterProcesses(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, set: Awaited<ReturnType<typeof readSessakuPieceSet>>, discoverUnsplit: boolean) {
  const rows = (await readWinnerRowsByLogicalKeyFseibans(tx, [key.fseiban])).filter((row) => {
    const candidate = sessakuPieceKeyFromRow(row.rowData);
    return supportsSessakuPieceRelations(candidate) && candidate.fhincd === key.fhincd && isLaterProcessOrder(candidate.fkojun, key.fkojun);
  });
  const details = await readRowDetails(tx, rows.map((row) => row.id));
  const sets = await readSessakuPieceSets(tx, rows);
  const readLinked = (sources: NonNullable<typeof set>[]) => tx.productionScheduleSessakuPieceSet.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: [
      { sourcePieceSetId: { in: sources.map((source) => source.id) } },
      { pieces: { some: { sourcePieceId: { in: sources.flatMap((source) => source.pieces.map((piece) => piece.id)) } } } }
    ] }, include: { pieces: { orderBy: { position: 'asc' }, include: { opSplits: true } } }
  });
  const toLaterProcess = (laterSet: NonNullable<typeof set>): LaterProcess => {
    const row = rows.find((row) => encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)) === encodeSessakuPieceKey(laterSet));
    const detail = row ? details.get(row.id) : undefined;
    return { key: laterSet, rowId: row?.id, set: laterSet, hasWinner: Boolean(row), plannedQuantity: row ? detail?.orderSupplements[0]?.plannedQuantity ?? null : laterSet.plannedQuantity,
      completed: detail?.productionScheduleProgress?.isCompleted === true || detail?.productionScheduleExternalCompletion?.isExternallyCompleted === true,
      externallyCompleted: detail?.productionScheduleExternalCompletion?.isExternallyCompleted === true,
      previousCompleted: detail?.productionScheduleProgress?.isCompleted ?? null };
  };
  const result = set ? (await readLinked([set])).map(toLaterProcess) : [];
  if (!discoverUnsplit) return result;
  let adopted: NonNullable<typeof set>[] = [];
  for (const row of rows) {
    const candidate = sessakuPieceKeyFromRow(row.rowData);
    if (result.some((process) => encodeSessakuPieceKey(process.key) === encodeSessakuPieceKey(candidate))) continue;
    const laterSet = sets.get(encodeSessakuPieceKey(candidate)) ?? null;
    const detail = details.get(row.id);
    if (laterSet?.sourcePieceSetId || laterSet?.pieces.length || detail?.productionScheduleProgress?.isCompleted || detail?.productionScheduleExternalCompletion?.isExternallyCompleted) continue;
    result.push({ key: candidate, rowId: row.id, set: laterSet, plannedQuantity: detail?.orderSupplements[0]?.plannedQuantity ?? null, completed: false, hasWinner: true,
      externallyCompleted: false, previousCompleted: detail?.productionScheduleProgress?.isCompleted ?? null });
    if (laterSet) adopted.push(laterSet);
  }
  // An empty independent cutting set can still own later sets, including missing winners.
  const seen = new Set([set?.id, ...result.map((process) => process.set?.id)]);
  while (adopted.length) {
    const dependents = await readLinked(adopted);
    adopted = [];
    for (const dependent of dependents) {
      if (seen.has(dependent.id)) continue;
      seen.add(dependent.id);
      result.push(toLaterProcess(dependent));
      adopted.push(dependent);
    }
  }
  return result;
}


export function assertLaterProcessesEditable(later: LaterProcess[]) {
  if (later.some(({ set, hasWinner }) => hasWinner && set?.quantityWarning)) throw new ApiError(409, '片が更新されています。再読み込みしてください', undefined, 'PIECE_QUANTITY_CONFLICT');
  if (later.some(({ set, completed, hasWinner }) => hasWinner && (completed || set?.pieces.some((piece) => piece.isCompleted)))) {
    throw new ApiError(409, '後工程の片が完了しています', undefined, 'LATER_PROCESS_PIECE_COMPLETED');
  }
}
