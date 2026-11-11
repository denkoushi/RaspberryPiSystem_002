import { reconcileSessakuPieceQuantities } from './piece-quantity.js';
import { reconcileSessakuPieceProgress } from './piece-completion.js';
import type { GrindingPlanningBoardResourcePartOpMinutes } from '@raspi-system/shared-types';
import { Prisma, type ProductionScheduleGrindingPlanningBoardOverride } from '@prisma/client';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { readRowDetails, readWinnerRowsByLogicalKeyFseibans } from '../grinding-planning-board/source.js';
import { acquireProductionScheduleParentRowLocksInTransaction } from '../order-assignment/production-schedule-parent-row-lock.service.js';
import { acquireSessakuPieceBoardStateLocks, acquireSessakuPieceLogicalLocks, encodeSessakuPieceKey,
  sessakuPieceItemIds, sessakuPieceKeyFromRow, sessakuPieceParentItemId, type SessakuPieceLogicalKey, type SessakuPieceSet } from './piece-key.js';
import { STRING_TRIM_CHARACTERS } from '../grinding-planning-board/shared.js';
import { stateOrder } from '../grinding-planning-board/state.js';

/** Definition writers take the same critical -> logical -> board -> row order as piece edits, before the setting row. */
export async function lockOperationDefinitionPieces(tx: Prisma.TransactionClient, fhincd: string) {
  await acquireFkojunstStatusMailCriticalTransactionLock(tx);
  const keys = await tx.$queryRaw<SessakuPieceLogicalKey[]>`
    SELECT "fseiban", "fhincd", "fsigencd", "fkojun" FROM "ProductionScheduleSessakuPieceSet"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND BTRIM("fhincd", ${STRING_TRIM_CHARACTERS}) = ${fhincd.trim()}`;
  if (!keys.length) return keys;
  const locked = await acquireSessakuPieceLogicalLocks(tx, keys);
  await acquireSessakuPieceBoardStateLocks(tx);
  const states = await tx.productionScheduleGrindingPlanningBoardState.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }
  });
  const displayedSeibans = new Set(states.flatMap(stateOrder));
  const boardSeibans = [...new Set(keys.filter((key) => displayedSeibans.has(key.fseiban.trim())).map((key) => key.fseiban))];
  const rows = boardSeibans.length ? await readWinnerRowsByLogicalKeyFseibans(tx, boardSeibans) : [];
  const rowIds = rows.filter((row) => locked.has(encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData))))
    .map((row) => row.id).sort((a, b) => a.localeCompare(b));
  if (rowIds.length) {
    await acquireProductionScheduleParentRowLocksInTransaction(tx, rowIds);
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
  piece: { id: string; isCompleted: boolean }, item: { effectiveResourceCd: string | null; fhincd: string; ops?: GrindingPlanningBoardResourcePartOpMinutes[] }, completed: boolean): Promise<boolean> {
  if (!completed) {
    if (!piece.isCompleted) return false;
    return (await tx.productionScheduleSessakuPieceOpCompletion.deleteMany({ where: { pieceId: piece.id } })).count > 0;
  }
  const definitions = item.ops ?? await readPieceOperationNumbers(tx, siteKey, item);
  if (!definitions.length) return false;
  return (await tx.productionScheduleSessakuPieceOpCompletion.createMany({
    data: definitions.map(({ opNo }) => ({ pieceId: piece.id, opNo })), skipDuplicates: true
  })).count > 0;
}

/** Parent-row actions load each resource/part definition together, including missing definitions. */
export async function syncWholePiecesOperationCompletions(tx: Prisma.TransactionClient, siteKey: string,
  pieces: Array<{ id: string; isCompleted: boolean; effectiveResourceCd: string | null; fhincd: string; opSplits?: Array<{ fromOpNo: number; sourceResourceCd: string; leadingSourceResourceCd?: string | null }> }>, completed: boolean): Promise<boolean> {
  if (!pieces.length) return false;
  if (!completed) {
    const completedIds = pieces.filter((piece) => piece.isCompleted).map((piece) => piece.id);
    if (!completedIds.length) return false;
    return (await tx.productionScheduleSessakuPieceOpCompletion.deleteMany({
      where: { pieceId: { in: completedIds } }
    })).count > 0;
  }
  const intervals = pieces.flatMap((piece) => {
    const splits = [...(piece.opSplits ?? [])].sort((a, b) => a.fromOpNo - b.fromOpNo);
    if (!splits.length) return [{ ...piece, fromOpNo: 1, toOpNo: Infinity }];
    return [splits[0].leadingSourceResourceCd ?? splits[0].sourceResourceCd, ...splits.map((split) => split.sourceResourceCd)]
      .map((effectiveResourceCd, index) => ({ ...piece, effectiveResourceCd,
        fromOpNo: index === 0 ? 1 : splits[index - 1].fromOpNo, toOpNo: splits[index] ? splits[index].fromOpNo - 1 : Infinity }));
  });
  const pairs = new Map(intervals.filter((piece) => piece.effectiveResourceCd !== null)
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
  const data = intervals.flatMap((piece) => (byPair.get(JSON.stringify([piece.effectiveResourceCd, piece.fhincd.trim()])) ?? [])
    .filter(({ opNo }) => opNo >= piece.fromOpNo && opNo <= piece.toOpNo)
    .map(({ opNo }) => ({ pieceId: piece.id, opNo })));
  return data.length > 0 && (await tx.productionScheduleSessakuPieceOpCompletion.createMany({ data, skipDuplicates: true })).count > 0;
}

/** Keep completed pieces closed; aggregate remaining operation evidence for unfinished pieces. */
export async function reconcileOperationDefinitionPieces(tx: Prisma.TransactionClient, params: { siteKey: string; resourceCd: string },
  keys: SessakuPieceLogicalKey[], opNos: number[]) {
  if (!keys.length) return;
  const states = await tx.productionScheduleGrindingPlanningBoardState.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }
  });
  const scopes = new Map(states.map((state) => [state.siteKey, new Set(stateOrder(state))]));
  const displayedSeibans = new Set([...scopes.values()].flatMap((scope) => [...scope]));
  const sets: SessakuPieceSet[] = [];
  for (let start = 0; start < keys.length; start += 300) {
    sets.push(...await tx.productionScheduleSessakuPieceSet.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: keys.slice(start, start + 300).map(({ fseiban, fhincd, fsigencd, fkojun }) => ({ fseiban, fhincd, fsigencd, fkojun })) },
      include: { pieces: { include: { opSplits: true } } }
    }));
  }
  const boardSeibans = [...new Set(keys.filter((key) => displayedSeibans.has(key.fseiban.trim())).map((key) => key.fseiban))];
  const rows = boardSeibans.length ? await readWinnerRowsByLogicalKeyFseibans(tx, boardSeibans) : [];
  const details = rows.length ? await readRowDetails(tx, rows.map((row) => row.id)) : new Map();
  const rowsByKey = new Map(rows.map((row) => [encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)), row]));
  const itemKeys = sets.flatMap((set) => [sessakuPieceParentItemId(set), ...set.pieces.flatMap(sessakuPieceItemIds)]);
  const overrideRows: ProductionScheduleGrindingPlanningBoardOverride[] = [];
  // Name the sites so each chunk uses the (dashboard, site, item) unique index instead of scanning the dashboard.
  // groupBy dedupes in SQL; findMany+distinct would fetch every override row and dedupe in memory.
  const overrideSites = itemKeys.length ? (await tx.productionScheduleGrindingPlanningBoardOverride.groupBy({
    by: ['siteKey'], where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }
  })).map((override) => override.siteKey) : [];
  for (let start = 0; overrideSites.length && start < itemKeys.length; start += 300) {
    overrideRows.push(...await tx.productionScheduleGrindingPlanningBoardOverride.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: { in: overrideSites }, itemKey: { in: itemKeys.slice(start, start + 300) } }
    }));
  }
  const overridesBySite = new Map<string, Map<string, typeof overrideRows[number]>>();
  for (const override of overrideRows) {
    const overrides = overridesBySite.get(override.siteKey) ?? new Map();
    overrides.set(override.itemKey, override); overridesBySite.set(override.siteKey, overrides);
  }
  const definitions = await tx.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fhincd: { in: [...new Set(keys.map((key) => key.fhincd.trim()))] } },
    include: { ops: { select: { opNo: true } } }
  });
  // Registered sites without board state/overrides still inherit the base resource, so they count too.
  const registeredSites = await tx.site.findMany({ select: { key: true } });
  const siteKeys = new Set([params.siteKey, ...registeredSites.map((site) => site.key), ...scopes.keys(), ...overridesBySite.keys(),
    ...definitions.map((definition) => definition.siteKey)]);
  const targets = sets.flatMap((set) => {
    const row = rowsByKey.get(encodeSessakuPieceKey(set));
    // Without a live, open board row a piece only loses obsolete evidence (never filled or completed).
    const onBoard = displayedSeibans.has(set.fseiban.trim()) && !!row
      && !details.get(row.id)?.productionScheduleExternalCompletion?.isExternallyCompleted;
    const parentId = sessakuPieceParentItemId(set);
    return set.pieces.flatMap((piece) => {
      const effective = (siteKey: string) => {
        const overrides = overridesBySite.get(siteKey);
        const override = overrides?.get(`piece:${piece.id}`) ?? overrides?.get(parentId);
        return (override?.overrideResourceCd ?? set.fsigencd).trim();
      };
      if (piece.opSplits?.length) {
        const splits = [...piece.opSplits].sort((a, b) => a.fromOpNo - b.fromOpNo);
        const resources = [splits[0].leadingSourceResourceCd ?? splits[0].sourceResourceCd, ...splits.map((split) => split.sourceResourceCd)];
        const inRange = (opNo: number, index: number) => opNo >= (index === 0 ? 1 : splits[index - 1].fromOpNo)
          && opNo < (splits[index]?.fromOpNo ?? Infinity);
        const retained = new Set<number>();
        const fill = new Set<number>();
        for (const siteKey of siteKeys) for (const [index, resource] of resources.entries()) {
          const numbers = siteKey === params.siteKey && resource === params.resourceCd ? opNos
            : definitions.find((definition) => definition.siteKey === siteKey && definition.resourceCd === resource && definition.fhincd === set.fhincd.trim())?.ops.map((op) => op.opNo) ?? [];
          for (const opNo of numbers.filter((opNo) => inRange(opNo, index))) {
            retained.add(opNo);
            if (siteKey === params.siteKey && resource === params.resourceCd) fill.add(opNo);
          }
        }
        return [{ piece, retained, fill: onBoard ? [...fill] : [], onBoard }];
      }
      const matches = (siteKey: string) => scopes.get(siteKey)?.has(set.fseiban.trim()) && effective(siteKey) === params.resourceCd;
      const partDefinitions = definitions.filter((definition) => definition.fhincd === set.fhincd.trim()
        && !(definition.siteKey === params.siteKey && definition.resourceCd === params.resourceCd));
      if (onBoard && [...scopes.keys()].some(matches)) {
        const retained = new Set(partDefinitions.filter((definition) => definition.resourceCd === effective(definition.siteKey))
          .flatMap((definition) => definition.ops.map((op) => op.opNo)));
        if (effective(params.siteKey) === params.resourceCd) for (const opNo of opNos) retained.add(opNo);
        return [{ piece, retained, fill: matches(params.siteKey) ? opNos : [], onBoard: true }];
      }
      // Delete-only: keep numbers defined for any resource this piece is effectively on (at any site),
      // plus the replacement; never skip on resource mismatch, since the evidence may predate an override change.
      const resources = new Set([...siteKeys].map(effective));
      const retained = new Set([...partDefinitions.filter((definition) => resources.has(definition.resourceCd))
        .flatMap((definition) => definition.ops.map((op) => op.opNo)), ...opNos]);
      return [{ piece, retained, fill: [] as number[], onBoard: false }];
    });
  });
  if (!targets.length) return;
  // Off-board pieces only lose obsolete evidence; do not fill or complete them.
  const progressTargets = targets.filter(({ onBoard }) => onBoard);
  const records: Array<{ pieceId: string; opNo: number }> = [];
  for (let start = 0; start < progressTargets.length; start += 300) {
    records.push(...await tx.productionScheduleSessakuPieceOpCompletion.findMany({
      where: { pieceId: { in: progressTargets.slice(start, start + 300).map(({ piece }) => piece.id) } }, select: { pieceId: true, opNo: true }
    }));
  }
  const existing = new Set(records.map((record) => `${record.pieceId}:${record.opNo}`));
  const deletionGroups = new Map<string, { pieceIds: string[]; opNos: number[]; onBoard: boolean }>();
  for (const { piece, retained, onBoard } of targets) {
    const opNos = [...retained].sort((a, b) => a - b);
    const key = `${onBoard}:${opNos.join(',')}`;
    const group = deletionGroups.get(key) ?? { pieceIds: [], opNos, onBoard };
    group.pieceIds.push(piece.id);
    deletionGroups.set(key, group);
  }
  // Bound binds even for thousands of pieces; keep all deletes in the caller's transaction.
  // On-board progress sets always move with the definition; delete-only sets only when evidence is removed.
  const changedSets = new Set(progressTargets.map(({ piece }) => piece.pieceSetId));
  const setByPiece = new Map(targets.map(({ piece }) => [piece.id, piece.pieceSetId]));
  for (const { pieceIds, opNos, onBoard } of deletionGroups.values()) {
    for (let start = 0; start < pieceIds.length; start += 300) {
      const where = opNos.length ? { pieceId: { in: pieceIds.slice(start, start + 300) }, opNo: { notIn: opNos } }
        : { pieceId: { in: pieceIds.slice(start, start + 300) } };
      if (!onBoard) {
        const obsolete = await tx.productionScheduleSessakuPieceOpCompletion.findMany({ where, select: { pieceId: true } });
        if (!obsolete.length) continue;
        for (const { pieceId } of obsolete) changedSets.add(setByPiece.get(pieceId)!);
      }
      await tx.productionScheduleSessakuPieceOpCompletion.deleteMany({ where });
    }
  }
  const missing = progressTargets.filter(({ piece }) => piece.isCompleted).flatMap(({ piece, fill }) => fill
    .filter((opNo) => !existing.has(`${piece.id}:${opNo}`)).map((opNo) => ({ pieceId: piece.id, opNo })));
  if (missing.length) await tx.productionScheduleSessakuPieceOpCompletion.createMany({ data: missing, skipDuplicates: true });
  const newlyCompleted = progressTargets.filter(({ piece, retained }) => !piece.isCompleted && retained.size > 0
    && [...retained].every((opNo) => existing.has(`${piece.id}:${opNo}`)));
  for (let start = 0; start < newlyCompleted.length; start += 300) {
    await tx.productionScheduleSessakuPiece.updateMany({
      where: { id: { in: newlyCompleted.slice(start, start + 300).map(({ piece }) => piece.id) } },
      data: { isCompleted: true, completedAt: new Date() }
    });
  }
  const affectedSets = [...changedSets];
  for (let start = 0; start < affectedSets.length; start += 300) {
    await tx.productionScheduleSessakuPieceSet.updateMany({
      where: { id: { in: affectedSets.slice(start, start + 300) } }, data: { version: { increment: 1 } }
    });
  }
  const completedSets = new Set(newlyCompleted.map(({ piece }) => piece.pieceSetId));
  for (const set of sets.filter((set) => completedSets.has(set.id))) {
    const row = rowsByKey.get(encodeSessakuPieceKey(set))!;
    await reconcileSessakuPieceQuantities(tx, set, details.get(row.id)?.orderSupplements[0]?.plannedQuantity ?? set.plannedQuantity);
    await reconcileSessakuPieceProgress(tx, set, { emptyIsIncomplete: true });
  }

}
