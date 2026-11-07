import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { ApiError } from '../../../lib/errors.js';
import { Prisma } from '@prisma/client';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { acquireSessakuPieceBoardStateLocks, acquireSessakuPieceLogicalLocks, encodeSessakuPieceKey, findSessakuPieceWinner, readSessakuPieceSet, readSessakuPieceSets, sessakuPieceKeyFromRow, type SessakuPieceLogicalKey } from './piece-key.js';
import { reconcileSessakuPieceQuantities } from './piece-quantity.js';
import { reconcileSessakuPieceProgress } from './piece-completion.js';

/** Lock source row keys even before their first set is created, then reread live state. */
export async function lockSessakuPieceSourceRows(tx: Prisma.TransactionClient, rowIds: readonly string[]) {
  const rows = await tx.csvDashboardRow.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, id: { in: [...rowIds] } }, select: { id: true, rowData: true } });
  const keys = rows.map((row) => sessakuPieceKeyFromRow(row.rowData));
  if (!keys.length) return [];
  await acquireSessakuPieceLogicalLocks(tx, keys);
  const latest = await tx.csvDashboardRow.findMany({ where: { id: { in: rows.map((row) => row.id) } }, select: { id: true, rowData: true } });
  const latestKeys = new Map(latest.map((row) => [row.id, encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData))]));
  if (rows.some((row) => keys.some((key) => encodeSessakuPieceKey(key) === encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData))) && latestKeys.get(row.id) !== encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)))) throw new ApiError(409, '補助CSVの対象キーを再計画してください', undefined, 'SOURCE_ITEM_MISSING');
  const sets = await readSessakuPieceSets(tx, latest);
  if ([...sets.values()].some((set) => set.pieces.length || set.sourcePieceSetId)) await acquireSessakuPieceBoardStateLocks(tx);
  return keys;
}
export async function synchronizeSessakuPieceSources(tx: Prisma.TransactionClient, keys: readonly SessakuPieceLogicalKey[], externalChangedKeys: ReadonlySet<string> = new Set()) {
  for (const key of keys) {
    const set = await readSessakuPieceSet(tx, key);
    if (!set || !set.pieces.length && !set.sourcePieceSetId) continue;
    const winner = await findSessakuPieceWinner(tx, key);
    if (!winner) continue;
    const supplement = await tx.productionScheduleOrderSupplement.findFirst({ where: { csvDashboardRowId: winner.id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, select: { plannedQuantity: true } });
    const changed = await reconcileSessakuPieceQuantities(tx, key, supplement?.plannedQuantity ?? null);
    if (set.pieces.length || set.sourcePieceSetId) await reconcileSessakuPieceProgress(tx, key, { emptyIsIncomplete: true });
    if (externalChangedKeys.has(encodeSessakuPieceKey(key)) && !changed) await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { version: { increment: 1 } } });
  }
}
export async function lockAllSessakuPieceSets(tx: Prisma.TransactionClient, mailCriticalLocked = false) {
  const sets = await tx.productionScheduleSessakuPieceSet.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: [{ pieces: { some: {} } }, { sourcePieceSetId: { not: null } }] }, include: { pieces: true }
  });
  if (sets.length && !mailCriticalLocked) await acquireFkojunstStatusMailCriticalTransactionLock(tx);
  await acquireSessakuPieceLogicalLocks(tx, sets);
  return sets;
}

/** Preserve the published logical parent's completion while its transient source row is replaced. */
export async function readSessakuPiecePublicationState(tx: Prisma.TransactionClient, keys: readonly SessakuPieceLogicalKey[]) {
  const states = [];
  const sets = await readSessakuPieceSets(tx, keys.map((key) => ({ rowData: { FSEIBAN: key.fseiban, FHINCD: key.fhincd, FSIGENCD: key.fsigencd, FKOJUN: key.fkojun } })));
  for (const key of sets.values()) {
    if (!key.pieces.length && !key.sourcePieceSetId) continue;
    const previous = await findSessakuPieceWinner(tx, key);
    const external = previous ? await tx.productionScheduleExternalCompletion.findUnique({ where: { csvDashboardRowId: previous.id } }) : null;
    const supplement = previous ? await tx.productionScheduleOrderSupplement.findUnique({ where: { csvDashboardRowId: previous.id } }) : null;
    const mail = previous ? await tx.productionScheduleFkojunstMailStatus.findUnique({ where: { csvDashboardRowId: previous.id } }) : null;
    const progress = previous && key.sourcePieceSetId && !key.pieces.length
      ? await tx.productionScheduleProgress.findUnique({ where: { csvDashboardRowId: previous.id } }) : null;
    states.push({ key, previous, external, supplement, mail, progress });
  }
  return states;
}
export async function publishSessakuPieceProgress(tx: Prisma.TransactionClient, states: Awaited<ReturnType<typeof readSessakuPiecePublicationState>>) {
  for (const { key, previous, external, supplement, mail, progress } of states) {
    const winner = await findSessakuPieceWinner(tx, key);
    if (!winner) continue;
    const sameOrder = String((previous?.rowData as Record<string, unknown> | undefined)?.ProductNo ?? '') === String((winner.rowData as Record<string, unknown>)?.ProductNo ?? '');
    if (previous && previous.id !== winner.id && sameOrder) {
      // Move only records belonging to the same manufacturing order. A changed ProductNo must be matched by its own source sync.
      if (supplement && !await tx.productionScheduleOrderSupplement.findUnique({ where: { csvDashboardRowId: winner.id } })) await tx.productionScheduleOrderSupplement.update({ where: { id: supplement.id }, data: { csvDashboardRowId: winner.id } });
      if (mail && !await tx.productionScheduleFkojunstMailStatus.findUnique({ where: { csvDashboardRowId: winner.id } })) await tx.productionScheduleFkojunstMailStatus.update({ where: { id: mail.id }, data: { csvDashboardRowId: winner.id } });
    }
    if (external && sameOrder && external.csvDashboardRowId !== winner.id) {
      const data = { csvDashboardId: external.csvDashboardId, isExternallyCompleted: external.isExternallyCompleted,
        externallyCompletedFromFkojunstDisappeared: external.externallyCompletedFromFkojunstDisappeared,
        externallyCompletedFromFkojunstMailStatus: external.externallyCompletedFromFkojunstMailStatus,
        externallyCompletedFromScheduleCsvDisappeared: external.externallyCompletedFromScheduleCsvDisappeared };
      await tx.productionScheduleExternalCompletion.upsert({ where: { csvDashboardRowId: winner.id }, create: { ...data, csvDashboardRowId: winner.id }, update: {} });
    }
    if (progress?.isCompleted && previous?.id !== winner.id) {
      const data = { isCompleted: true, updatedAt: progress.updatedAt };
      await tx.productionScheduleProgress.upsert({ where: { csvDashboardRowId: winner.id },
        create: { ...data, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: winner.id }, update: data });
    }
    await reconcileSessakuPieceProgress(tx, key);
    const set = await readSessakuPieceSet(tx, key);
    if (set && (previous?.id !== winner.id || previous?.updatedAt.getTime() !== winner.updatedAt.getTime())) await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { version: { increment: 1 } } });
  }
}

export async function prepareSessakuPiecePublication(tx: Prisma.TransactionClient, rows: readonly { rowData: unknown }[]) {
  const keys = [...new Map(rows.map((row) => { const key = sessakuPieceKeyFromRow(row.rowData); return [encodeSessakuPieceKey(key), key]; })).values()];
  const sets = await readSessakuPieceSets(tx, rows);
  const activeKeys = keys.filter((key) => sets.get(encodeSessakuPieceKey(key))?.pieces.length || sets.get(encodeSessakuPieceKey(key))?.sourcePieceSetId);
  if (!activeKeys.length) return [];
  await acquireSessakuPieceLogicalLocks(tx, activeKeys);
  const states = await readSessakuPiecePublicationState(tx, activeKeys);
  if (states.length) await acquireSessakuPieceBoardStateLocks(tx);
  return states;
}

/** A replacement plan whose target stopped being the winner must be explicitly replanned by the import job. */
export async function assertSessakuPieceWinnerTargets(tx: Prisma.TransactionClient, rowIds: readonly string[]) {
  const rows = await tx.csvDashboardRow.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, id: { in: [...new Set(rowIds)] } }, select: { id: true, rowData: true } });
  if (rows.length !== new Set(rowIds).size) throw new ApiError(409, '補助CSVの対象行が更新されています', undefined, 'SOURCE_ITEM_MISSING');
  const sets = await readSessakuPieceSets(tx, rows);
  for (const row of rows) {
    const key = sessakuPieceKeyFromRow(row.rowData);
    const set = sets.get(encodeSessakuPieceKey(key));
    if ((set?.pieces.length || set?.sourcePieceSetId) && (await findSessakuPieceWinner(tx, key))?.id !== row.id) throw new ApiError(409, '補助CSVの勝者行を再計画してください', undefined, 'SOURCE_ITEM_MISSING');
  }
}
