import { compareProcessOrder } from '../process-order.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { GrindingPlanningBoardItem, SessakuPieceCompletionRequest, SessakuPiecesMergeRequest, SessakuPiecesMutationResponse, SessakuPiecesSplitRequest } from '@raspi-system/shared-types';
import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
import { readOverrides, readRanks, readRowDetails, readWinnerRowsByLogicalKeyFseibans, readWinnerRowsByFseibans } from '../grinding-planning-board/source.js';
import { ensurePlanningBoardState, stateOrder } from '../grinding-planning-board/state.js';
import { getResourceCategoryPolicy, isProductionScheduleCuttingResourceCd } from '../policies/resource-category-policy.service.js';
import { acquireProductionScheduleParentRowLockInTransaction } from '../order-assignment/production-schedule-parent-row-lock.service.js';
import { acquireSessakuPieceBoardStateLocks, acquireSessakuPieceLogicalLocks, decodeSessakuPieceParentItemId, findSessakuPieceWinner, readSessakuPieceSet, readSessakuPieceSets, sessakuPieceKeyFromRow, encodeSessakuPieceKey, resolveSessakuPieceItemKeys, sessakuPieceConflict, sessakuPieceParentItemId, sessakuPieceSetWhere, type SessakuPieceLogicalKey } from './piece-key.js';
import { reconcileSessakuPieceQuantities } from './piece-quantity.js';
import { reconcileSessakuPieceProgress } from './piece-completion.js';

type LaterProcess = { key: SessakuPieceLogicalKey; set: Awaited<ReturnType<typeof readSessakuPieceSet>>; plannedQuantity: number | null; completed: boolean };

async function readLaterProcesses(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, set: Awaited<ReturnType<typeof readSessakuPieceSet>>) {
  const rows = (await readWinnerRowsByLogicalKeyFseibans(tx, [key.fseiban])).filter((row) => {
    const candidate = sessakuPieceKeyFromRow(row.rowData);
    return candidate.fhincd === key.fhincd && compareProcessOrder(candidate.fkojun, key.fkojun) > 0;
  });
  const details = await readRowDetails(tx, rows.map((row) => row.id));
  const sets = await readSessakuPieceSets(tx, rows);
  const linked = set ? await tx.productionScheduleSessakuPieceSet.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, OR: [
      { sourcePieceSetId: set.id },
      { pieces: { some: { sourcePieceId: { in: set.pieces.map((piece) => piece.id) } } } }
    ] }, include: { pieces: { orderBy: { position: 'asc' } } }
  }) : [];
  const result = linked.map((laterSet): LaterProcess => {
    const row = rows.find((row) => encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)) === encodeSessakuPieceKey(laterSet));
    const detail = row ? details.get(row.id) : undefined;
    return { key: laterSet, set: laterSet, plannedQuantity: row ? detail?.orderSupplements[0]?.plannedQuantity ?? null : laterSet.plannedQuantity,
      completed: detail?.productionScheduleProgress?.isCompleted === true || detail?.productionScheduleExternalCompletion?.isExternallyCompleted === true };
  });
  for (const row of rows) {
    const candidate = sessakuPieceKeyFromRow(row.rowData);
    if (result.some((process) => encodeSessakuPieceKey(process.key) === encodeSessakuPieceKey(candidate))) continue;
    const laterSet = sets.get(encodeSessakuPieceKey(candidate)) ?? null;
    const detail = details.get(row.id);
    if (laterSet?.pieces.length || detail?.productionScheduleProgress?.isCompleted || detail?.productionScheduleExternalCompletion?.isExternallyCompleted) continue;
    result.push({ key: candidate, set: laterSet, plannedQuantity: detail?.orderSupplements[0]?.plannedQuantity ?? null, completed: false });
  }
  return result;
}

function assertLaterProcessesEditable(later: LaterProcess[]) {
  if (later.some(({ set, completed }) => completed || set?.pieces.some((piece) => piece.isCompleted))) {
    throw new ApiError(409, '後工程の片が完了しています', undefined, 'LATER_PROCESS_PIECE_COMPLETED');
  }
}
function assertCuttingPieceSet(set: Awaited<ReturnType<typeof readSessakuPieceSet>>) {
  if (set?.sourcePieceSetId || set?.pieces.some((piece) => piece.sourcePieceId)) throw new ApiError(409, '後工程の片は分割・結合できません', undefined, 'LATER_PROCESS_PIECE_LOCKED');
}

function conflict(code = 'STALE_SESSAKU_PIECES'): never {
  throw new ApiError(409, '片が更新されています。再読み込みしてください', undefined, code);
}
async function projection(tx: Prisma.TransactionClient, siteKey: string, key: SessakuPieceLogicalKey, allSiteRows = false) {
  const state = await tx.productionScheduleGrindingPlanningBoardState.findUniqueOrThrow({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } } });
  const rows = await readWinnerRowsByFseibans(tx, allSiteRows ? [...stateOrder(state), key.fseiban] : [key.fseiban]);
  const details = await readRowDetails(tx, rows.map((row) => row.id));
  const overrides = await readOverrides(tx, siteKey);
  const pieceSets = await readSessakuPieceSets(tx, rows);
  const ranks = await readRanks(tx, rows.map((row) => row.id), siteKey);
  const input = { rows, details, overrides, pieceSets, ranks, seibanOrder: stateOrder(state), category: 'all' as const, view: 'resource' as const };
  return { parents: projectGrindingPlanningBoard(input).items, pieces: projectGrindingPlanningBoard({ ...input, includePieces: true }).items, overrides };
}
async function replaceSiteItems(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, before: Awaited<ReturnType<typeof projection>>, siteKey: string, removed: string[], replacements: string[]) {
  const selected = before.pieces.filter((item) => removed.includes(item.itemId));
  const sorted = before.pieces;
  const first = sorted.find((item) => removed.includes(item.itemId));
  if (!first) return;
  const inherited = before.overrides.get(first.itemId) ?? before.overrides.get(sessakuPieceParentItemId(key));
  // Every replacement takes this site's first selected item's placement and override.
  const replacementItems = replacements.map((id) => ({ ...first, itemId: id }));
  const next: GrindingPlanningBoardItem[] = [];
  for (const item of sorted) {
    if (item.itemId === first.itemId) next.push(...replacementItems);
    if (!removed.includes(item.itemId)) next.push(item);
  }
  const resources = new Set(selected.map((item) => item.effectiveResourceCd));
  for (const resource of resources) {
    const lane = next.filter((item) => item.effectiveResourceCd === resource && !item.isCompleted);
    for (const [index, item] of lane.entries()) {
      const isReplacement = replacements.includes(item.itemId);
      const own = isReplacement ? inherited : before.overrides.get(item.itemId);
      const data = {
        overrideResourceCd: own?.overrideResourceCd ?? null, overrideDueDate: own?.overrideDueDate ?? null,
        dueDateCleared: own?.dueDateCleared ?? null, orderPinned: own?.orderPinned ?? false,
        specialDueKind: own?.specialDueKind ?? null, specialDueExpiresAt: own?.specialDueExpiresAt ?? null,
        alternateRank: index + 1
      };
      const savedOverride = await tx.productionScheduleGrindingPlanningBoardOverride.upsert({
        where: { csvDashboardId_siteKey_itemKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: item.itemId } },
        create: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: item.itemId, ...data },
        update: { ...data, version: { increment: 1 } }
      });
      before.overrides.set(item.itemId, savedOverride);
    }
  }
  await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: { in: removed.filter((id) => id.startsWith('piece:')) } } });
  before.pieces = next;
  for (const id of removed.filter((id) => id.startsWith('piece:'))) before.overrides.delete(id);
  await tx.productionScheduleGrindingPlanningBoardState.update({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } }, data: { version: { increment: 1 } } });
}
async function removeLaterPieces(tx: Prisma.TransactionClient, later: LaterProcess[], removedSourceIds: string[]) {
  const ids = later.flatMap(({ set }) => set?.pieces.filter((piece) => piece.sourcePieceId && removedSourceIds.includes(piece.sourcePieceId)).map((piece) => piece.id) ?? []);
  await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, itemKey: { in: ids.map((id) => `piece:${id}`) } } });
  await tx.productionScheduleSessakuPiece.deleteMany({ where: { id: { in: ids } } });
}

async function replaceLaterPieces(tx: Prisma.TransactionClient, later: LaterProcess[], source: Awaited<ReturnType<typeof readSessakuPieceSet>>, sites: string[], before: Map<string, Awaited<ReturnType<typeof projection>>>) {
  for (const process of later) {
    const parentId = sessakuPieceParentItemId(process.key);
    const previous = process.set?.pieces ?? [];
    const set = process.set ?? await tx.productionScheduleSessakuPieceSet.create({ data: { ...sessakuPieceSetWhere(process.key), plannedQuantity: process.plannedQuantity } });
    await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { sourcePieceSetId: source!.id, version: { increment: 1 } } });
    if (source?.pieces.length) await reconcileSessakuPieceQuantities(tx, process.key, process.plannedQuantity);
    const saved = await readSessakuPieceSet(tx, process.key);
    const removed = previous.filter((piece) => !saved?.pieces.some((next) => next.id === piece.id));
    const added = saved?.pieces.filter((piece) => !previous.some((old) => old.id === piece.id)).map((piece) => `piece:${piece.id}`) ?? [];
    for (const site of sites) await replaceSiteItems(tx, process.key, before.get(site)!, site,
      previous.length ? removed.map((piece) => `piece:${piece.id}`) : [parentId], source?.pieces.length ? added : [parentId]);
    await reconcileSessakuPieceProgress(tx, process.key, { emptyIsIncomplete: true });
    if (!source?.pieces.length) await tx.productionScheduleSessakuPieceSet.delete({ where: { id: set.id } });
  }
}

async function operate(params: { siteKey: string; parentItemId: string; expectedPieceSetVersion: number }, action: (tx: Prisma.TransactionClient, context: {
  key: SessakuPieceLogicalKey; winner: NonNullable<Awaited<ReturnType<typeof findSessakuPieceWinner>>>;
  set: Awaited<ReturnType<typeof readSessakuPieceSet>>; current: Awaited<ReturnType<typeof projection>>;
  external: boolean; plannedQuantity: number | null; sites: string[]; later: LaterProcess[];
}) => Promise<void>): Promise<SessakuPiecesMutationResponse> {
  const key = decodeSessakuPieceParentItemId(params.parentItemId);
  await ensurePlanningBoardState(params.siteKey);
  try {
    return await prisma.$transaction(async (tx) => {
      await acquireFkojunstStatusMailCriticalTransactionLock(tx);
      const candidateRows = (await readWinnerRowsByLogicalKeyFseibans(tx, [key.fseiban])).filter((row) => sessakuPieceKeyFromRow(row.rowData).fhincd === key.fhincd);
      const candidates = candidateRows.map((row) => sessakuPieceKeyFromRow(row.rowData));
      await acquireSessakuPieceLogicalLocks(tx, [key, ...candidates]);
      await acquireSessakuPieceBoardStateLocks(tx);
      for (const row of [...candidateRows].sort((a, b) => a.id.localeCompare(b.id))) {
        await acquireProductionScheduleParentRowLockInTransaction(tx, row.id);
        await tx.$queryRaw`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${row.id} FOR UPDATE`;
      }
      const set = await readSessakuPieceSet(tx, key);
      const later = await readLaterProcesses(tx, key, set);
      const relatedItemIds = later.flatMap((process) => [sessakuPieceParentItemId(process.key), ...(process.set?.pieces ?? []).map((piece) => `piece:${piece.id}`)]);
      const siteOverrides = await tx.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, itemKey: { in: [...relatedItemIds, params.parentItemId, ...(set?.pieces ?? []).map((piece) => `piece:${piece.id}`)] } }, select: { siteKey: true } });
      const overrideSites = new Set(siteOverrides.map((o) => o.siteKey));
      const sites = (await tx.productionScheduleGrindingPlanningBoardState.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, orderBy: { siteKey: 'asc' } }))
        .filter((state) => state.siteKey === params.siteKey || stateOrder(state).includes(key.fseiban) || overrideSites.has(state.siteKey)).map((s) => s.siteKey);
      const winner = await findSessakuPieceWinner(tx, key);
      if (!winner) conflict('SOURCE_ITEM_MISSING');
      await acquireProductionScheduleParentRowLockInTransaction(tx, winner.id);
      await tx.$queryRaw`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${winner.id} FOR UPDATE`;
      if ((set?.version ?? 0) !== params.expectedPieceSetVersion) conflict();
      const detail = (await readRowDetails(tx, [winner.id])).get(winner.id);
      const current = await projection(tx, params.siteKey, key);
      await action(tx, { key, winner, set, current, external: detail?.productionScheduleExternalCompletion?.isExternallyCompleted === true, plannedQuantity: detail?.orderSupplements[0]?.plannedQuantity ?? null, sites, later });
      const saved = await readSessakuPieceSet(tx, key);
      const result = await reconcileSessakuPieceProgress(tx, key, { emptyIsIncomplete: true });
      const after = await projection(tx, params.siteKey, key);
      return { affectedItemIds: [params.parentItemId, ...(set?.pieces ?? []).map((piece) => `piece:${piece.id}`), ...relatedItemIds], parentItemId: params.parentItemId, pieceSetVersion: saved?.version ?? 0,
        quantityWarning: saved?.quantityWarning as SessakuPiecesMutationResponse['quantityWarning'],
        pieces: after.pieces.filter((item) => item.parentItemId === params.parentItemId),
        sourceRowId: winner.id, parentIsCompleted: result?.parentIsCompleted ?? false };
    }, { timeout: 30000, maxWait: 15000 });
  } catch (error) { sessakuPieceConflict(error); }
}
function assertRevision(item: GrindingPlanningBoardItem | undefined, expected: string | undefined) {
  if (!item || item.itemRevision !== expected) conflict();
}
export async function splitSessakuPieces(params: SessakuPiecesSplitRequest & { siteKey: string }): Promise<SessakuPiecesMutationResponse> {
  if (process.env.SESSAKU_PIECES_CREATE_ENABLED !== 'true') throw new ApiError(403, '分割作成は無効です', undefined, 'SESSAKU_PIECES_CREATE_DISABLED');
  return operate(params, async (tx, c) => {
    assertCuttingPieceSet(c.set);
    const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
    if (!isProductionScheduleCuttingResourceCd(c.key.fsigencd, policy)) throw new ApiError(403, '切削工程だけ分割できます', undefined, 'RESOURCE_CATEGORY_MISMATCH');
    if (Object.values(c.key).some((value) => !value) || c.key.fseiban === '********') conflict('UNSUPPORTED_PIECE_PARENT');
    if (c.external) conflict('EXTERNALLY_COMPLETED_ITEM');
    if (c.set?.quantityWarning) conflict('PIECE_QUANTITY_CONFLICT');
    const target = params.targetPieceId ? c.set?.pieces.find((p) => p.id === params.targetPieceId) : undefined;
    if (params.targetPieceId && !target || !params.targetPieceId && c.set?.pieces.length) conflict();
    const itemId = target ? `piece:${target.id}` : params.parentItemId;
    const item = target ? c.current.pieces.find((p) => p.itemId === itemId) : c.current.parents.find((p) => p.itemId === itemId);
    assertRevision(item, params.itemRevision);
    if (target?.isCompleted || item?.isCompleted) conflict('COMPLETED_PIECE');
    const total = target?.quantity ?? c.plannedQuantity;
    if (params.quantities.length < 2 || params.quantities.some((q) => !Number.isSafeInteger(q) || q <= 0 || q > 2_147_483_647) || params.quantities.reduce((a, b) => a + b, 0) !== total) {
      throw new ApiError(400, '分割数量の合計が指示数と一致しません', undefined, 'PIECE_QUANTITY_CONFLICT');
    }
    assertLaterProcessesEditable(c.later);
    const before = new Map<string, Awaited<ReturnType<typeof projection>>>();
    for (const site of c.sites) before.set(site, await projection(tx, site, c.key, true));
    const set = c.set ?? await tx.productionScheduleSessakuPieceSet.create({ data: { ...sessakuPieceSetWhere(c.key), plannedQuantity: total } });
    const pieces = c.set?.pieces ?? [];
    const insertAt = target ? pieces.findIndex((p) => p.id === target.id) : 0;
    const added = params.quantities.map((quantity) => ({ id: randomUUID(), quantity }));
    const ordered = [...pieces.slice(0, insertAt), ...added, ...pieces.slice(target ? insertAt + 1 : insertAt)];
    await removeLaterPieces(tx, c.later, target ? [target.id] : []);
    if (target) await tx.productionScheduleSessakuPiece.delete({ where: { id: target.id } });
    // Move surviving positions above both the old and new ranges before assigning final positions.
    const offset = Math.max(set.nextPosition, ...pieces.map((p) => p.position), ordered.length) + ordered.length + 1;
    await tx.productionScheduleSessakuPiece.updateMany({ where: { pieceSetId: set.id }, data: { position: { increment: offset } } });
    for (const [index, piece] of ordered.entries()) {
      if (pieces.some((p) => p.id === piece.id)) await tx.productionScheduleSessakuPiece.update({ where: { id: piece.id }, data: { position: index + 1 } });
      else await tx.productionScheduleSessakuPiece.create({ data: { ...piece, pieceSetId: set.id, position: index + 1 } });
    }
    await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { nextPosition: Math.max(set.nextPosition, ordered.length + 1), ...(c.set ? { version: { increment: 1 } } : {}) } });
    for (const site of c.sites) await replaceSiteItems(tx, c.key, before.get(site)!, site, [itemId], added.map((p) => `piece:${p.id}`));
    await replaceLaterPieces(tx, c.later, await readSessakuPieceSet(tx, c.key), c.sites, before);
  });
}
export async function mergeSessakuPieces(params: SessakuPiecesMergeRequest & { siteKey: string }): Promise<SessakuPiecesMutationResponse> {
  return operate(params, async (tx, c) => {
    assertCuttingPieceSet(c.set);
    const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
    if (!isProductionScheduleCuttingResourceCd(c.key.fsigencd, policy)) throw new ApiError(403, '切削工程だけ結合できます', undefined, 'RESOURCE_CATEGORY_MISMATCH');
    if (c.external) conflict('EXTERNALLY_COMPLETED_ITEM');
    if (c.set?.quantityWarning) conflict('PIECE_QUANTITY_CONFLICT');
    if (!c.set || params.pieceIds.length < 2 || new Set(params.pieceIds).size !== params.pieceIds.length) conflict();
    const selected = c.set.pieces.filter((p) => params.pieceIds.includes(p.id));
    if (selected.length !== params.pieceIds.length) conflict();
    for (const piece of selected) {
      if (piece.isCompleted) conflict('COMPLETED_PIECE');
      assertRevision(c.current.pieces.find((item) => item.pieceId === piece.id), params.itemRevisions[`piece:${piece.id}`]);
    }
    assertLaterProcessesEditable(c.later);
    const before = new Map<string, Awaited<ReturnType<typeof projection>>>();
    for (const site of c.sites) before.set(site, await projection(tx, site, c.key, true));
    await removeLaterPieces(tx, c.later, params.pieceIds);
    await tx.productionScheduleSessakuPiece.deleteMany({ where: { id: { in: params.pieceIds } } });
    const all = selected.length === c.set.pieces.length;
    const id = randomUUID();
    if (!all) await tx.productionScheduleSessakuPiece.create({ data: { id, pieceSetId: c.set.id, position: Math.min(...selected.map((p) => p.position)), quantity: selected.reduce((n, p) => n + p.quantity, 0) } });
    await tx.productionScheduleSessakuPieceSet.update({ where: { id: c.set.id }, data: { version: { increment: 1 }, quantityWarning: null } });
    for (const site of c.sites) await replaceSiteItems(tx, c.key, before.get(site)!, site, params.pieceIds.map((p) => `piece:${p}`), [all ? params.parentItemId : `piece:${id}`]);
    await replaceLaterPieces(tx, c.later, await readSessakuPieceSet(tx, c.key), c.sites, before);
  });
}
export async function setSessakuPieceCompletion(params: SessakuPieceCompletionRequest & { siteKey: string; pieceId: string }): Promise<SessakuPiecesMutationResponse> {
  const keys = await resolveSessakuPieceItemKeys(prisma, [`piece:${params.pieceId}`]);
  const key = keys.get(`piece:${params.pieceId}`)!;
  return operate({ ...params, parentItemId: sessakuPieceParentItemId(key) }, async (tx, c) => {
    const piece = c.set?.pieces.find((p) => p.id === params.pieceId);
    if (!piece || !c.set) conflict();
    assertRevision(c.current.pieces.find((p) => p.pieceId === piece.id), params.itemRevision);
    if (c.external && params.intent === 'incomplete') conflict('EXTERNALLY_COMPLETED_ITEM');
    if (c.external) return;
    const completed = params.intent === 'complete';
    if (piece.isCompleted !== completed) {
      await tx.productionScheduleSessakuPiece.update({ where: { id: piece.id }, data: { isCompleted: completed, completedAt: completed ? new Date() : null } });
      await tx.productionScheduleSessakuPieceSet.update({ where: { id: c.set.id }, data: { version: { increment: 1 } } });
    }
    await reconcileSessakuPieceQuantities(tx, c.key, c.plannedQuantity);
  });
}
