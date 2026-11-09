import { Prisma } from '@prisma/client';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { readRowDetails, readWinnerRowsByLogicalKeyFseibans } from '../grinding-planning-board/source.js';
import { acquireProductionScheduleParentRowLocksInTransaction } from '../order-assignment/production-schedule-parent-row-lock.service.js';
import { acquireSessakuPieceBoardStateLocks, acquireSessakuPieceLogicalLocks, encodeSessakuPieceKey,
  sessakuPieceKeyFromRow, sessakuPieceParentItemId, type SessakuPieceLogicalKey } from './piece-key.js';
import { STRING_TRIM_CHARACTERS } from '../grinding-planning-board/shared.js';
import { stateOrder } from '../grinding-planning-board/state.js';

/** Definition writers take the same critical -> logical -> board -> row order as piece edits, before the setting row. */
export async function lockOperationDefinitionPieces(tx: Prisma.TransactionClient, fhincd: string) {
  await acquireFkojunstStatusMailCriticalTransactionLock(tx);
  const states = await tx.productionScheduleGrindingPlanningBoardState.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }
  });
  const order = [...new Set(states.flatMap(stateOrder))];
  if (!order.length) return [];
  const keys = await tx.$queryRaw<SessakuPieceLogicalKey[]>`
    SELECT "fseiban", "fhincd", "fsigencd", "fkojun" FROM "ProductionScheduleSessakuPieceSet"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND BTRIM("fhincd", ${STRING_TRIM_CHARACTERS}) = ${fhincd.trim()}
      AND BTRIM("fseiban", ${STRING_TRIM_CHARACTERS}) = ANY(${order}::text[])`;
  if (!keys.length) return keys;
  const locked = await acquireSessakuPieceLogicalLocks(tx, keys);
  await acquireSessakuPieceBoardStateLocks(tx);
  const rows = await readWinnerRowsByLogicalKeyFseibans(tx, [...new Set(keys.map((key) => key.fseiban))]);
  const rowIds = rows.filter((row) => locked.has(encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData))))
    .map((row) => row.id).sort((a, b) => a.localeCompare(b));
  await acquireProductionScheduleParentRowLocksInTransaction(tx, rowIds);
  if (rowIds.length) {
    await tx.$queryRaw`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ANY(${rowIds}::text[]) ORDER BY "id" FOR UPDATE`;
  }
  return keys;
}

export async function readPieceOperationNumbers(tx: Prisma.TransactionClient, siteKey: string, item: { effectiveResourceCd: string | null; fhincd: string }) {
  const [part] = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "ProductionScheduleGrindingPlanningBoardResourcePartMinutes"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND "siteKey" = ${siteKey}
      AND "resourceCd" = ${item.effectiveResourceCd} AND "fhincd" = ${item.fhincd.trim()} FOR SHARE`;
  return part ? tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.findMany({
    where: { partMinutesId: part.id }, select: { opNo: true }, orderBy: { opNo: 'asc' }
  }) : [];
}

/** Whole-piece APIs share this synchronization, including cancellation after a definition was removed. */
export async function syncWholePieceOperationCompletions(tx: Prisma.TransactionClient, siteKey: string,
  piece: { id: string; isCompleted: boolean }, item: { effectiveResourceCd: string | null; fhincd: string }, completed: boolean): Promise<boolean> {
  if (!completed) {
    if (!piece.isCompleted) return false;
    return (await tx.productionScheduleSessakuPieceOpCompletion.deleteMany({ where: { pieceId: piece.id } })).count > 0;
  }
  const definitions = await readPieceOperationNumbers(tx, siteKey, item);
  if (!definitions.length) return false;
  return (await tx.productionScheduleSessakuPieceOpCompletion.createMany({
    data: definitions.map(({ opNo }) => ({ pieceId: piece.id, opNo })), skipDuplicates: true
  })).count > 0;
}

/** Parent-row actions load each resource/part definition together, including missing definitions. */
export async function syncWholePiecesOperationCompletions(tx: Prisma.TransactionClient, siteKey: string,
  pieces: Array<{ id: string; isCompleted: boolean; effectiveResourceCd: string | null; fhincd: string }>, completed: boolean): Promise<boolean> {
  if (!pieces.length) return false;
  if (!completed) {
    const completedIds = pieces.filter((piece) => piece.isCompleted).map((piece) => piece.id);
    if (!completedIds.length) return false;
    return (await tx.productionScheduleSessakuPieceOpCompletion.deleteMany({
      where: { pieceId: { in: completedIds } }
    })).count > 0;
  }
  const pairs = new Map(pieces.filter((piece) => piece.effectiveResourceCd !== null)
    .map((piece) => [JSON.stringify([piece.effectiveResourceCd, piece.fhincd.trim()]), piece]));
  if (!pairs.size) return false;
  const parts = await tx.$queryRaw<Array<{ id: string; resourceCd: string; fhincd: string }>>(Prisma.sql`
    SELECT "id", "resourceCd", "fhincd" FROM "ProductionScheduleGrindingPlanningBoardResourcePartMinutes"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND "siteKey" = ${siteKey}
      AND (${Prisma.join([...pairs.values()].map((piece) => Prisma.sql`("resourceCd" = ${piece.effectiveResourceCd} AND "fhincd" = ${piece.fhincd.trim()})`), ' OR ')})
    ORDER BY "id" FOR SHARE`);
  if (!parts.length) return false;
  const definitions = await tx.productionScheduleGrindingPlanningBoardResourcePartOpMinutes.findMany({
    where: { partMinutesId: { in: parts.map((part) => part.id) } }, select: { partMinutesId: true, opNo: true }, orderBy: { opNo: 'asc' }
  });
  const byPair = new Map(parts.map((part) => [JSON.stringify([part.resourceCd, part.fhincd]),
    definitions.filter((op) => op.partMinutesId === part.id)]));
  const data = pieces.flatMap((piece) => (byPair.get(JSON.stringify([piece.effectiveResourceCd, piece.fhincd.trim()])) ?? [])
    .map(({ opNo }) => ({ pieceId: piece.id, opNo })));
  return data.length > 0 && (await tx.productionScheduleSessakuPieceOpCompletion.createMany({ data, skipDuplicates: true })).count > 0;
}

/** Definition saves preserve isCompleted; only kiosk actions change completion/progress. */
export async function reconcileOperationDefinitionPieces(tx: Prisma.TransactionClient, params: { siteKey: string; resourceCd: string },
  keys: SessakuPieceLogicalKey[], opNos: number[]) {
  if (!keys.length) return;
  const states = await tx.productionScheduleGrindingPlanningBoardState.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }
  });
  const scopes = new Map(states.map((state) => [state.siteKey, new Set(stateOrder(state))]));
  const scopedKeys = keys.filter((key) => [...scopes.values()].some((scope) => scope.has(key.fseiban.trim())));
  if (!scopedKeys.length) return;
  const sets = await tx.productionScheduleSessakuPieceSet.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: scopedKeys.map(({ fseiban, fhincd, fsigencd, fkojun }) => ({ fseiban, fhincd, fsigencd, fkojun })) },
    include: { pieces: true }
  });
  const rows = await readWinnerRowsByLogicalKeyFseibans(tx, [...new Set(scopedKeys.map((key) => key.fseiban))]);
  const details = await readRowDetails(tx, rows.map((row) => row.id));
  const rowsByKey = new Map(rows.map((row) => [encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)), row]));
  const overrideRows = await tx.productionScheduleGrindingPlanningBoardOverride.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      itemKey: { in: sets.flatMap((set) => [sessakuPieceParentItemId(set), ...set.pieces.map((piece) => `piece:${piece.id}`)]) } }
  });
  const overridesBySite = new Map<string, Map<string, typeof overrideRows[number]>>();
  for (const override of overrideRows) {
    const overrides = overridesBySite.get(override.siteKey) ?? new Map();
    overrides.set(override.itemKey, override); overridesBySite.set(override.siteKey, overrides);
  }
  const definitions = await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fhincd: { in: [...new Set(scopedKeys.map((key) => key.fhincd.trim()))] } },
    include: { ops: { select: { opNo: true } } }
  });
  const targets = sets.flatMap((set) => {
    const row = rowsByKey.get(encodeSessakuPieceKey(set));
    if (!row || details.get(row.id)?.productionScheduleExternalCompletion?.isExternallyCompleted) return [];
    const parentId = sessakuPieceParentItemId(set);
    return set.pieces.flatMap((piece) => {
      const effective = (siteKey: string) => {
        const overrides = overridesBySite.get(siteKey);
        const override = overrides?.get(`piece:${piece.id}`) ?? overrides?.get(parentId);
        return (override?.overrideResourceCd ?? set.fsigencd).trim();
      };
      const matches = (siteKey: string) => scopes.get(siteKey)?.has(set.fseiban.trim()) && effective(siteKey) === params.resourceCd;
      if (![...scopes.keys()].some(matches)) return [];
      const retained = new Set(definitions.filter((definition) => definition.fhincd === set.fhincd.trim()
        && definition.resourceCd === effective(definition.siteKey)
        && !(definition.siteKey === params.siteKey && definition.resourceCd === params.resourceCd))
        .flatMap((definition) => definition.ops.map((op) => op.opNo)));
      if (effective(params.siteKey) === params.resourceCd) for (const opNo of opNos) retained.add(opNo);
      return [{ piece, retained, fill: matches(params.siteKey) ? opNos : [] }];
    });
  });
  if (!targets.length) return;
  const records: Array<{ pieceId: string; opNo: number }> = [];
  for (let start = 0; start < targets.length; start += 300) {
    records.push(...await tx.productionScheduleSessakuPieceOpCompletion.findMany({
      where: { pieceId: { in: targets.slice(start, start + 300).map(({ piece }) => piece.id) } }, select: { pieceId: true, opNo: true }
    }));
  }
  const existing = new Set(records.map((record) => `${record.pieceId}:${record.opNo}`));
  const deletionGroups = new Map<string, { pieceIds: string[]; opNos: number[] }>();
  for (const { piece, retained } of targets) {
    const opNos = [...retained].sort((a, b) => a - b);
    const key = opNos.join(',');
    const group = deletionGroups.get(key) ?? { pieceIds: [], opNos };
    group.pieceIds.push(piece.id);
    deletionGroups.set(key, group);
  }
  // Bound binds even for thousands of pieces; keep all deletes in the caller's transaction.
  for (const { pieceIds, opNos } of deletionGroups.values()) {
    for (let start = 0; start < pieceIds.length; start += 300) {
      await tx.productionScheduleSessakuPieceOpCompletion.deleteMany({
        where: opNos.length ? { pieceId: { in: pieceIds.slice(start, start + 300) }, opNo: { notIn: opNos } }
          : { pieceId: { in: pieceIds.slice(start, start + 300) } }
      });
    }
  }
  const missing = targets.filter(({ piece }) => piece.isCompleted).flatMap(({ piece, fill }) => fill
    .filter((opNo) => !existing.has(`${piece.id}:${opNo}`)).map((opNo) => ({ pieceId: piece.id, opNo })));
  if (missing.length) await tx.productionScheduleSessakuPieceOpCompletion.createMany({ data: missing, skipDuplicates: true });
  // Every targeted set's revision changes with the definition, even if no record changed.
  const affectedSets = [...new Set(targets.map(({ piece }) => piece.pieceSetId))];
  for (let start = 0; start < affectedSets.length; start += 300) {
    await tx.productionScheduleSessakuPieceSet.updateMany({
      where: { id: { in: affectedSets.slice(start, start + 300) } }, data: { version: { increment: 1 } }
    });
  }
}
