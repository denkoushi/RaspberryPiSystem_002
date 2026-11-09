import { isAutoUnitSplitBusyError } from './piece-db-error.js';
import { isFirstAutoUnitSplitProcess } from './auto-unit-split-candidates.js';
import { readPieceOperationNumbers, syncWholePieceOperationCompletions } from './piece-operation-definitions.js';
import { getGrindingPlanningBoardResourceCapacity } from '../grinding-planning-board-resource-capacity.service.js';
import { isUnitSplitEnabled } from './unit-split-policy.js';
import { getGrindingPlanningBoardResourceMinutes, resourcePartOpMinutesSchema } from '../grinding-planning-board-resource-minutes.service.js';
import { sessakuPieceCompletionSchema } from './sessaku-pieces.schemas.js';
import { isLaterProcessOrder } from '../process-order.js';
import { runSessakuPieceOperation, readLaterPieceAuditSnapshots, collectLaterPiecePropagationAudits, type PieceAuditContext, type PieceOperationTiming } from './piece-audit.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { GrindingPlanningBoardItem, SessakuPieceCompletionRequest, SessakuPiecesMergeRequest, SessakuPiecesMutationResponse, SessakuPiecesSplitRequest } from '@raspi-system/shared-types';
import { prisma } from '../../../lib/prisma.js';
import { ApiError } from '../../../lib/errors.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildGrindingPlanningBoardRowItemId, projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
import { readOverrides, readRanks, readRowDetails, readWinnerRowsByLogicalKeyFseibans, readWinnerRowsByFseibans, type SessakuLaneSourceScope } from '../grinding-planning-board/source.js';
import { decodeRowItemId } from '../grinding-planning-board/shared.js';
import { ensurePlanningBoardState, stateOrder } from '../grinding-planning-board/state.js';
import { getResourceCategoryPolicy, isProductionScheduleCuttingResourceCd } from '../policies/resource-category-policy.service.js';
import { acquireProductionScheduleParentRowLockInTransaction } from '../order-assignment/production-schedule-parent-row-lock.service.js';
import { acquireSessakuPieceBoardStateLocks, acquireSessakuPieceLogicalLocks, decodeSessakuPieceParentItemId, findSessakuPieceWinner, readSessakuPieceSet, readSessakuPieceSets, sessakuPieceKeyFromRow, encodeSessakuPieceKey, resolveSessakuPieceItemKeys, sessakuPieceConflict, sessakuPieceParentItemId, sessakuPieceSetWhere, supportsSessakuPieceRelations, type SessakuPieceLogicalKey } from './piece-key.js';
import { reconcileSessakuPieceQuantities } from './piece-quantity.js';
import { reconcileSessakuPieceProgress } from './piece-completion.js';

type LaterProcess = { key: SessakuPieceLogicalKey; rowId?: string; set: Awaited<ReturnType<typeof readSessakuPieceSet>>; plannedQuantity: number | null; completed: boolean; hasWinner: boolean };

async function readLaterProcesses(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, set: Awaited<ReturnType<typeof readSessakuPieceSet>>, discoverUnsplit: boolean) {
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
    ] }, include: { pieces: { orderBy: { position: 'asc' } } }
  });
  const toLaterProcess = (laterSet: NonNullable<typeof set>): LaterProcess => {
    const row = rows.find((row) => encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData)) === encodeSessakuPieceKey(laterSet));
    const detail = row ? details.get(row.id) : undefined;
    return { key: laterSet, rowId: row?.id, set: laterSet, hasWinner: Boolean(row), plannedQuantity: row ? detail?.orderSupplements[0]?.plannedQuantity ?? null : laterSet.plannedQuantity,
      completed: detail?.productionScheduleProgress?.isCompleted === true || detail?.productionScheduleExternalCompletion?.isExternallyCompleted === true };
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
    result.push({ key: candidate, rowId: row.id, set: laterSet, plannedQuantity: detail?.orderSupplements[0]?.plannedQuantity ?? null, completed: false, hasWinner: true });
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

function assertLaterProcessesEditable(later: LaterProcess[]) {
  if (later.some(({ set, hasWinner }) => hasWinner && set?.quantityWarning)) conflict('PIECE_QUANTITY_CONFLICT');
  if (later.some(({ set, completed, hasWinner }) => hasWinner && (completed || set?.pieces.some((piece) => piece.isCompleted)))) {
    throw new ApiError(409, '後工程の片が完了しています', undefined, 'LATER_PROCESS_PIECE_COMPLETED');
  }
}
function assertCuttingPieceSet(set: Awaited<ReturnType<typeof readSessakuPieceSet>>) {
  if (set?.sourcePieceSetId || set?.pieces.some((piece) => piece.sourcePieceId)) throw new ApiError(409, '後工程の片は分割・結合できません', undefined, 'LATER_PROCESS_PIECE_LOCKED');
}

function conflict(code = 'STALE_SESSAKU_PIECES'): never {
  throw new ApiError(409, '片が更新されています。再読み込みしてください', undefined, code);
}
async function timed<T>(audit: PieceAuditContext | undefined, stage: Exclude<keyof PieceOperationTiming, 'siteCount' | 'upsertCount' | 'sourceRowCount'>, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await work(); }
  finally { if (audit?.timing) audit.timing[stage] += performance.now() - started; }
}
async function readProjectionSource(tx: Prisma.TransactionClient, fseibans: string[], audit?: PieceAuditContext, laneScope?: SessakuLaneSourceScope) {
  const rows = await timed(audit, 'sourceWinnerMs', () => readWinnerRowsByFseibans(tx, fseibans, laneScope));
  if (audit?.timing) audit.timing.sourceRowCount += rows.length;
  const details = await timed(audit, 'sourceDetailsMs', () => readRowDetails(tx, rows.map((row) => row.id)));
  const pieceSets = await timed(audit, 'sourcePieceSetsMs', () => readSessakuPieceSets(tx, rows));
  return { rows, details, pieceSets };
}
async function projection(tx: Prisma.TransactionClient, siteKey: string, key: SessakuPieceLogicalKey, allSiteRows = false,
  source?: Awaited<ReturnType<typeof readProjectionSource>>, audit?: PieceAuditContext) {
  const state = await tx.productionScheduleGrindingPlanningBoardState.findUniqueOrThrow({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } } });
  const fseibans = allSiteRows ? [...stateOrder(state), key.fseiban] : [key.fseiban];
  const shared = source ?? await readProjectionSource(tx, fseibans);
  const scope = new Set(fseibans.map((value) => value.trim()).filter(Boolean));
  const rows = source ? shared.rows.filter((row) => scope.has(sessakuPieceKeyFromRow(row.rowData).fseiban)) : shared.rows;
  const itemKeys = [...rows.map((row) => buildGrindingPlanningBoardRowItemId(row.rowData)),
    ...[...shared.pieceSets.values()].flatMap((set) => set.pieces.map((piece) => `piece:${piece.id}`))];
  const overrides = await timed(audit, 'overridesMs', () => readOverrides(tx, siteKey, itemKeys));
  const ranks = await timed(audit, 'ranksMs', () => readRanks(tx, rows.map((row) => row.id), siteKey));
  const resourceMinutes = await getGrindingPlanningBoardResourceMinutes({ siteKey }, tx);
  const resourceCapacity = await getGrindingPlanningBoardResourceCapacity({ siteKey }, tx);
  const input = { resourceMinutes, resourceCapacity, rows, details: shared.details, overrides, pieceSets: shared.pieceSets, ranks, seibanOrder: stateOrder(state), category: 'all' as const, view: 'resource' as const };
  // Lane replacement only consumes pieces; avoid projecting every parent a second time.
  return timed(audit, 'projectMs', async () => ({ parents: allSiteRows ? [] : projectGrindingPlanningBoard(input).items, pieces: projectGrindingPlanningBoard({ ...input, includePieces: true }).items, overrides }));
}
async function readLaneScope(tx: Prisma.TransactionClient, sites: string[], key: SessakuPieceLogicalKey, removed: string[], later: LaterProcess[]): Promise<SessakuLaneSourceScope> {
  // Later replacements share this projection, including their lanes at every affected site.
  const targets = [{ key, removed }, ...later.filter((process) => process.hasWinner).map((process) => ({
    key: process.key,
    removed: process.set?.pieces.length ? process.set.pieces.map((piece) => `piece:${piece.id}`) : [sessakuPieceParentItemId(process.key)]
  }))];
  const itemKeys = targets.flatMap((target) => [sessakuPieceParentItemId(target.key), ...target.removed]);
  const selectedOverrides = await tx.productionScheduleGrindingPlanningBoardOverride.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: { in: sites }, itemKey: { in: itemKeys } }
  });
  const normalize = (value: string) => value.trim() || null;
  const resources = new Set<string | null>();
  for (const site of sites) {
    const overrides = new Map(selectedOverrides.filter((o) => o.siteKey === site).map((o) => [o.itemKey, o]));
    for (const target of targets) for (const itemId of target.removed) {
      // An existing piece override (even with a null resource) replaces parent inheritance.
      const override = overrides.get(itemId) ?? overrides.get(sessakuPieceParentItemId(target.key));
      resources.add(normalize(override?.overrideResourceCd ?? target.key.fsigencd));
    }
  }
  // Discover inbound rows/pieces without loading every site's full override records.
  // Keep trim semantics identical to the projection; empty overrides can create a null lane.
  const resourceOverrides = await tx.productionScheduleGrindingPlanningBoardOverride.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: { in: sites }, overrideResourceCd: { not: null } },
    select: { itemKey: true, overrideResourceCd: true }
  });
  const inboundIds = [...new Set(resourceOverrides.filter((o) => resources.has(normalize(o.overrideResourceCd!))).map((o) => o.itemKey))];
  const inboundKeys = new Map<string, SessakuPieceLogicalKey>();
  for (const itemId of inboundIds) {
    const encoded = decodeRowItemId(itemId);
    if (!encoded) continue;
    const [fseiban, fhincd, fsigencd, fkojun] = JSON.parse(encoded) as string[];
    const inbound = { fseiban, fhincd, fsigencd, fkojun };
    inboundKeys.set(encoded, inbound);
  }
  const pieceIds = inboundIds.filter((id) => id.startsWith('piece:')).map((id) => id.slice(6));
  if (pieceIds.length) {
    const pieces = await tx.productionScheduleSessakuPiece.findMany({ where: { id: { in: pieceIds } },
      select: { pieceSet: { select: { fseiban: true, fhincd: true, fsigencd: true, fkojun: true } } } });
    for (const { pieceSet } of pieces) inboundKeys.set(sessakuPieceParentItemId(pieceSet), pieceSet);
  }
  return { targetFseiban: key.fseiban, resourceCds: [...resources].filter((value): value is string => value != null), inboundKeys: [...inboundKeys.values()] };
}
async function beforeProjections(tx: Prisma.TransactionClient, sites: string[], key: SessakuPieceLogicalKey, removed: string[], later: LaterProcess[], audit?: PieceAuditContext) {
  const started = performance.now();
  try {
    const states = await tx.productionScheduleGrindingPlanningBoardState.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: { in: sites } } });
    // Source rows, details and piece sets are site independent and stable under the operation locks.
    const laneScope = await timed(audit, 'laneDiscoveryMs', () => readLaneScope(tx, sites, key, removed, later));
    const source = await readProjectionSource(tx, [...new Set([key.fseiban, ...states.flatMap(stateOrder)])], audit, laneScope);
    const before = new Map<string, Awaited<ReturnType<typeof projection>>>();
    for (const site of sites) before.set(site, await projection(tx, site, key, true, source, audit));
    return before;
  } finally {
    if (audit?.timing) audit.timing.beforeProjectionMs += performance.now() - started;
  }
}
async function replaceSiteItems(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey, before: Awaited<ReturnType<typeof projection>>, siteKey: string, removed: string[], replacements: string[], audit?: PieceAuditContext) {
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
  const values: Prisma.Sql[] = [];
  const updatedAt = new Date();
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
      const id = randomUUID();
      values.push(Prisma.sql`(${id}, ${PRODUCTION_SCHEDULE_DASHBOARD_ID}, ${siteKey}, ${item.itemId},
        ${data.overrideResourceCd}::text, ${data.overrideDueDate}::date, ${data.dueDateCleared}::boolean,
        ${data.orderPinned}::boolean, ${data.specialDueKind}::text, ${data.specialDueExpiresAt}::timestamp,
        ${data.alternateRank}::integer, ${updatedAt}::timestamp)`);
      const existing = before.overrides.get(item.itemId);
      before.overrides.set(item.itemId, {
        id: existing?.id ?? id, csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: item.itemId,
        ...data, version: (existing?.version ?? 0) + 1, createdAt: existing?.createdAt ?? updatedAt, updatedAt
      });
    }
  }
  // Bound bind parameters even when a lane contains many pieces.
  for (let offset = 0; offset < values.length; offset += 1000) {
    const chunk = values.slice(offset, offset + 1000);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ProductionScheduleGrindingPlanningBoardOverride"
        ("id", "csvDashboardId", "siteKey", "itemKey", "overrideResourceCd", "overrideDueDate", "dueDateCleared",
         "orderPinned", "specialDueKind", "specialDueExpiresAt", "alternateRank", "updatedAt")
      VALUES ${Prisma.join(chunk)}
      ON CONFLICT ("csvDashboardId", "siteKey", "itemKey") DO UPDATE SET
        "overrideResourceCd" = EXCLUDED."overrideResourceCd", "overrideDueDate" = EXCLUDED."overrideDueDate",
        "dueDateCleared" = EXCLUDED."dueDateCleared", "orderPinned" = EXCLUDED."orderPinned",
        "specialDueKind" = EXCLUDED."specialDueKind", "specialDueExpiresAt" = EXCLUDED."specialDueExpiresAt",
        "alternateRank" = EXCLUDED."alternateRank", "updatedAt" = EXCLUDED."updatedAt",
        "version" = "ProductionScheduleGrindingPlanningBoardOverride"."version" + 1
    `);
    if (audit?.timing) audit.timing.upsertCount += chunk.length;
  }
  await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey, itemKey: { in: removed.filter((id) => id.startsWith('piece:')) } } });
  before.pieces = next;
  for (const id of removed.filter((id) => id.startsWith('piece:'))) before.overrides.delete(id);
  await tx.productionScheduleGrindingPlanningBoardState.update({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } }, data: { version: { increment: 1 } } });
}
async function removeLaterPieces(tx: Prisma.TransactionClient, later: LaterProcess[], removedSourceIds: string[]) {
  const references = later.flatMap(({ set }) => set?.pieces.filter((piece) => piece.sourcePieceId && removedSourceIds.includes(piece.sourcePieceId)) ?? []);
  const ids = references.filter((piece) => !piece.isCompleted).map((piece) => piece.id);
  await tx.productionScheduleSessakuPiece.updateMany({ where: { id: { in: references.filter((piece) => piece.isCompleted).map((piece) => piece.id) } }, data: { sourcePieceId: null } });
  await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, itemKey: { in: ids.map((id) => `piece:${id}`) } } });
  await tx.productionScheduleSessakuPiece.deleteMany({ where: { id: { in: ids } } });
  for (const { set, hasWinner } of later) {
    if (hasWinner || !set) continue;
    const unlink = !set.pieces.some((piece) => piece.sourcePieceId && !removedSourceIds.includes(piece.sourcePieceId));
    if (unlink || references.some((piece) => piece.pieceSetId === set.id)) {
      await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { ...(unlink ? { sourcePieceSetId: null, quantityWarning: null } : {}), version: { increment: 1 } } });
      if (unlink) set.sourcePieceSetId = null;
    }
  }
}

async function replaceLaterPieces(tx: Prisma.TransactionClient, later: LaterProcess[], source: Awaited<ReturnType<typeof readSessakuPieceSet>>, sites: string[], before: Map<string, Awaited<ReturnType<typeof projection>>>, audit?: PieceAuditContext) {
  // Flatten adopted ownership before quantity synchronization or deleting any later set.
  // A winnerless set unlinked by removeLaterPieces stays unlinked.
  for (const { set, hasWinner } of later) if (set && set.sourcePieceSetId !== source!.id && (hasWinner || set.sourcePieceSetId !== null)) {
    await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { sourcePieceSetId: source!.id, version: { increment: 1 } } });
  }
  for (const process of later) {
    if (!process.hasWinner && (source?.pieces.length || process.set?.pieces.some((piece) => piece.isCompleted))) continue;
    if (!source?.pieces.length && !process.set) continue;
    const parentId = sessakuPieceParentItemId(process.key);
    const previous = process.set?.pieces ?? [];
    const set = process.set ?? await tx.productionScheduleSessakuPieceSet.create({ data: { ...sessakuPieceSetWhere(process.key), plannedQuantity: process.plannedQuantity } });
    if (!process.set || process.set.sourcePieceSetId === source!.id) {
      await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { sourcePieceSetId: source!.id, version: { increment: 1 } } });
    }
    if (source?.pieces.length) await reconcileSessakuPieceQuantities(tx, process.key, process.plannedQuantity, true);
    const saved = await readSessakuPieceSet(tx, process.key);
    const removed = source?.pieces.length ? previous.filter((piece) => !saved?.pieces.some((next) => next.id === piece.id)) : previous;
    const added = saved?.pieces.filter((piece) => !previous.some((old) => old.id === piece.id)).map((piece) => `piece:${piece.id}`) ?? [];
    if (previous.length || added.length) for (const site of sites) await replaceSiteItems(tx, process.key, before.get(site)!, site,
      previous.length ? removed.map((piece) => `piece:${piece.id}`) : [parentId], source?.pieces.length ? added : [parentId], audit);
    await reconcileSessakuPieceProgress(tx, process.key, { emptyIsIncomplete: true });
    if (!source?.pieces.length) {
      // Existing pre-feature manual sets can be adopted; preserve their history before removal.
      await rememberPieceHistory(tx, process.key);
      await tx.productionScheduleSessakuPieceSet.delete({ where: { id: set.id } });
    }
  }
}

async function operate(params: { siteKey: string; parentItemId: string; expectedPieceSetVersion: number; audit?: PieceAuditContext; autoUnitSplit?: boolean; deadline?: number; discoverUnsplitLater?: boolean | ((set: Awaited<ReturnType<typeof readSessakuPieceSet>>) => boolean) }, action: (tx: Prisma.TransactionClient, context: {
  key: SessakuPieceLogicalKey; winner: NonNullable<Awaited<ReturnType<typeof findSessakuPieceWinner>>>;
  set: Awaited<ReturnType<typeof readSessakuPieceSet>>; current: Awaited<ReturnType<typeof projection>>;
  external: boolean; plannedQuantity: number | null; sites: string[]; later: LaterProcess[];
}) => Promise<void>): Promise<SessakuPiecesMutationResponse> {
  const key = decodeSessakuPieceParentItemId(params.parentItemId);
  if (params.audit) Object.assign(params.audit, { parentItemId: params.parentItemId, fseiban: key.fseiban });
  await ensurePlanningBoardState(params.siteKey);
  const retryWithExpandedLocks = new Error('Later process lock scope changed');
  const discoveredKeys = new Map<string, SessakuPieceLogicalKey>();
  const execute = () => {
    if (params.deadline !== undefined && performance.now() >= params.deadline) conflict('AUTO_UNIT_SPLIT_BUDGET');
    const remainingMs = params.deadline === undefined ? 30000 : Math.max(1, Math.floor(params.deadline - performance.now()));
    const lockStarted = performance.now();
    return prisma.$transaction(async (tx) => {
      if (params.audit?.timing) params.audit.timing.lockWaitMs += performance.now() - lockStarted;
      if (params.deadline !== undefined) {
        await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${Math.min(250, remainingMs)}ms`}, true),
          set_config('statement_timeout', ${`${remainingMs}ms`}, true)`;
      }
      if (params.autoUnitSplit) {
        const where = { csvDashboardId_fseiban_fhincd_fsigencd_fkojun: sessakuPieceSetWhere(key) };
        const [set, history] = await Promise.all([
          tx.productionScheduleSessakuPieceSet.findUnique({ where, select: { id: true } }),
          tx.productionScheduleSessakuPieceHistory.findUnique({ where, select: { id: true } })
        ]);
        if (set || history) conflict('AUTO_UNIT_SPLIT_ALREADY_TOUCHED');
      }
      let lockedKeys: ReadonlySet<string> = new Set();
      const lockedRowIds = new Set<string>();
      await timed(params.audit, 'lockWaitMs', async () => {
        await acquireFkojunstStatusMailCriticalTransactionLock(tx);
        const candidateRows = (await readWinnerRowsByLogicalKeyFseibans(tx, [key.fseiban])).filter((row) => sessakuPieceKeyFromRow(row.rowData).fhincd === key.fhincd);
        const candidates = candidateRows.map((row) => sessakuPieceKeyFromRow(row.rowData));
        lockedKeys = await acquireSessakuPieceLogicalLocks(tx, [key, ...candidates, ...discoveredKeys.values()]);
        await acquireSessakuPieceBoardStateLocks(tx);
        for (const row of [...candidateRows].sort((a, b) => a.id.localeCompare(b.id))) {
          await acquireProductionScheduleParentRowLockInTransaction(tx, row.id);
          await tx.$queryRaw`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${row.id} FOR UPDATE`;
          lockedRowIds.add(row.id);
        }
      });
      const set = await readSessakuPieceSet(tx, key);
      const discoverUnsplit = typeof params.discoverUnsplitLater === 'function' ? params.discoverUnsplitLater(set) : params.discoverUnsplitLater === true;
      const later = await readLaterProcesses(tx, key, set, discoverUnsplit);
      const unlocked = later.filter((process) => !lockedKeys.has(encodeSessakuPieceKey(process.key)) || (process.rowId && !lockedRowIds.has(process.rowId)));
      if (unlocked.length) {
        for (const process of unlocked) discoveredKeys.set(encodeSessakuPieceKey(process.key), process.key);
        // Roll back before expanding locks so every attempt preserves critical -> logical -> board -> row.
        throw retryWithExpandedLocks;
      }
      const relatedItemIds = later.flatMap((process) => [sessakuPieceParentItemId(process.key), ...(process.set?.pieces ?? []).map((piece) => `piece:${piece.id}`)]);
      const siteOverrides = await tx.productionScheduleGrindingPlanningBoardOverride.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, itemKey: { in: [...relatedItemIds, params.parentItemId, ...(set?.pieces ?? []).map((piece) => `piece:${piece.id}`)] } }, select: { siteKey: true } });
      const overrideSites = new Set(siteOverrides.map((o) => o.siteKey));
      const sites = (await tx.productionScheduleGrindingPlanningBoardState.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID }, orderBy: { siteKey: 'asc' } }))
        .filter((state) => state.siteKey === params.siteKey || stateOrder(state).includes(key.fseiban) || overrideSites.has(state.siteKey)).map((s) => s.siteKey);
      const winner = await findSessakuPieceWinner(tx, key);
      if (!winner) conflict('SOURCE_ITEM_MISSING');
      await timed(params.audit, 'lockWaitMs', async () => {
        await acquireProductionScheduleParentRowLockInTransaction(tx, winner.id);
        await tx.$queryRaw`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${winner.id} FOR UPDATE`;
      });
      const detail = (await readRowDetails(tx, [winner.id])).get(winner.id);
      if (params.audit) params.audit.beforeJson = { count: set?.pieces.length ?? 0, quantities: (set?.pieces ?? []).map((p) => p.quantity), pieceIds: (set?.pieces ?? []).map((p) => p.id), completedPieceIds: (set?.pieces ?? []).filter((p) => p.isCompleted).map((p) => p.id), plannedQuantity: detail?.orderSupplements[0]?.plannedQuantity ?? null };
      if ((set?.version ?? 0) !== params.expectedPieceSetVersion) conflict();
      const laterBefore = await readLaterPieceAuditSnapshots(tx, [key]);
      if (params.audit?.timing) params.audit.timing.siteCount = sites.length;
      const current = await timed(params.audit, 'beforeProjectionMs', () => projection(tx, params.siteKey, key));
      const writeStarted = performance.now();
      const beforeProjectionMs = params.audit?.timing?.beforeProjectionMs ?? 0;
      const { saved, result } = await (async () => {
        try {
          await action(tx, { key, winner, set, current, external: detail?.productionScheduleExternalCompletion?.isExternallyCompleted === true, plannedQuantity: detail?.orderSupplements[0]?.plannedQuantity ?? null, sites, later });
          const saved = await readSessakuPieceSet(tx, key);
          const result = await reconcileSessakuPieceProgress(tx, key, { emptyIsIncomplete: true });
          return { saved, result };
        } finally {
          if (params.audit?.timing) params.audit.timing.writeMs += performance.now() - writeStarted - (params.audit.timing.beforeProjectionMs - beforeProjectionMs);
        }
      })();
      const after = await timed(params.audit, 'afterProjectionMs', () => projection(tx, params.siteKey, key));
      if (params.audit) Object.assign(params.audit, { resultPieceIds: [...new Set([...(params.audit.pieceIds ?? []), ...(saved?.pieces ?? []).filter((p) => !set?.pieces.some((before) => before.id === p.id)).map((p) => p.id)])], resultVersion: saved?.version ?? 0, afterJson: { ...params.audit.afterJson, count: saved?.pieces.length ?? 0, quantities: (saved?.pieces ?? []).map((p) => p.quantity), pieceIds: (saved?.pieces ?? []).map((p) => p.id), completedPieceIds: (saved?.pieces ?? []).filter((p) => p.isCompleted).map((p) => p.id), plannedQuantity: detail?.orderSupplements[0]?.plannedQuantity ?? null } });
      if (params.audit) {
        const changes = collectLaterPiecePropagationAudits(laterBefore, await readLaterPieceAuditSnapshots(tx, [key], laterBefore), params.siteKey);
        if (changes.length) {
          params.audit.beforeJson = { ...params.audit.beforeJson, laterProcesses: changes[0].beforeJson!.laterProcesses };
          params.audit.afterJson = { ...params.audit.afterJson, laterProcesses: changes[0].afterJson!.laterProcesses };
          params.audit.resultPieceIds = [...new Set([...(params.audit.resultPieceIds ?? []), ...(changes[0].resultPieceIds ?? [])])];
        }
      }
      return { affectedItemIds: [params.parentItemId, ...(set?.pieces ?? []).map((piece) => `piece:${piece.id}`), ...relatedItemIds], parentItemId: params.parentItemId, pieceSetVersion: saved?.version ?? 0,
        quantityWarning: saved?.quantityWarning as SessakuPiecesMutationResponse['quantityWarning'],
        pieces: after.pieces.filter((item) => item.parentItemId === params.parentItemId),
        sourceRowId: winner.id, parentIsCompleted: result?.parentIsCompleted ?? false };
    }, { timeout: remainingMs, maxWait: params.deadline === undefined ? 15000 : Math.min(250, remainingMs) });
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await execute(); }
    catch (error) {
      if (error === retryWithExpandedLocks) continue;
      if (params.autoUnitSplit) {
        if (isAutoUnitSplitBusyError(error)) conflict('AUTO_UNIT_SPLIT_BUSY');
      }
      sessakuPieceConflict(error, { preserveSerializationFailure: params.autoUnitSplit });
    }
  }
  conflict();
}
function assertRevision(item: GrindingPlanningBoardItem | undefined, expected: string | undefined) {
  if (!item || item.itemRevision !== expected) conflict();
}
export async function splitSessakuPieces(params: SessakuPiecesSplitRequest & { siteKey: string; audit?: PieceAuditContext; autoUnitSplit?: boolean; deadline?: number }): Promise<SessakuPiecesMutationResponse> {
  if (!params.audit) return runSessakuPieceOperation({ action: 'split', siteKey: params.siteKey, expectedVersion: params.expectedPieceSetVersion,
    requestedQuantities: params.quantities, parentItemId: params.parentItemId, pieceIds: params.targetPieceId ? [params.targetPieceId] : [], itemRevision: params.itemRevision }, (audit) => splitSessakuPieces({ ...params, audit }));
  params.audit.requestedQuantities = params.quantities;
  try { params.audit.fseiban = decodeSessakuPieceParentItemId(params.parentItemId).fseiban; } catch { /* Invalid IDs are rejected by operate when enabled. */ }
  if (process.env.SESSAKU_PIECES_CREATE_ENABLED !== 'true') throw new ApiError(403, '分割作成は無効です', undefined, 'SESSAKU_PIECES_CREATE_DISABLED');
  return operate({ ...params, discoverUnsplitLater: true }, async (tx, c) => {
    assertCuttingPieceSet(c.set);
    if (params.autoUnitSplit) {
      // Recheck inside the same logical-key lock as every manual edit.
      const history = await tx.productionScheduleSessakuPieceHistory.findUnique({
        where: { csvDashboardId_fseiban_fhincd_fsigencd_fkojun: sessakuPieceSetWhere(c.key) }
      });
      if (c.set || history) conflict('AUTO_UNIT_SPLIT_ALREADY_TOUCHED');
      const item = c.current.parents.find((item) => item.itemId === params.parentItemId);
      const capacity = await getGrindingPlanningBoardResourceCapacity({ siteKey: params.siteKey }, tx);
      if (!item || !isUnitSplitEnabled(item.effectiveResourceCd, capacity)
        || !Number.isSafeInteger(c.plannedQuantity) || c.plannedQuantity! < 2 || c.plannedQuantity! > 50) {
        conflict('AUTO_UNIT_SPLIT_INELIGIBLE');
      }
      if (!isFirstAutoUnitSplitProcess(item, c.current.parents)) conflict('AUTO_UNIT_SPLIT_STRUCTURALLY_INELIGIBLE');
    }
    const policy = await getResourceCategoryPolicy({ siteKey: params.siteKey });
    if (!isProductionScheduleCuttingResourceCd(c.key.fsigencd, policy)) throw new ApiError(403, '切削工程だけ分割できます', undefined, 'RESOURCE_CATEGORY_MISMATCH');
    if (Object.values(c.key).some((value) => !value) || c.key.fseiban === '********') conflict('UNSUPPORTED_PIECE_PARENT');
    if (c.external) conflict('EXTERNALLY_COMPLETED_ITEM');
    if (c.set?.quantityWarning) conflict('PIECE_QUANTITY_CONFLICT');
    const target = params.targetPieceId ? c.set?.pieces.find((p) => p.id === params.targetPieceId) : undefined;
    if (params.targetPieceId && !target || !params.targetPieceId && c.set?.pieces.length) conflict();
    const itemId = target ? `piece:${target.id}` : params.parentItemId;
    const item = target ? c.current.pieces.find((p) => p.itemId === itemId) : c.current.parents.find((p) => p.itemId === itemId);
    if (params.autoUnitSplit && params.audit) params.audit.itemRevision = item?.itemRevision;
    // Earlier lots in this request can re-rank this lane; use its locked current revision.
    assertRevision(item, params.autoUnitSplit ? item?.itemRevision : params.itemRevision);
    if (target?.isCompleted || item?.isCompleted) conflict('COMPLETED_PIECE');
    const total = target?.quantity ?? c.plannedQuantity;
    if (params.quantities.length < 2 || params.quantities.some((q) => !Number.isSafeInteger(q) || q <= 0 || q > 2_147_483_647) || params.quantities.reduce((a, b) => a + b, 0) !== total) {
      throw new ApiError(400, '分割数量の合計が指示数と一致しません', undefined, 'PIECE_QUANTITY_CONFLICT');
    }
    await assertNoOperationCompletions(tx, [...(target ? [target.id] : []), ...c.later.flatMap(({ set }) => set?.pieces.filter((piece) => piece.sourcePieceId === target?.id).map((piece) => piece.id) ?? [])]);
    assertLaterProcessesEditable(c.later);
    const before = await beforeProjections(tx, c.sites, c.key, [itemId], c.later, params.audit);
    await rememberPieceHistory(tx, c.key);
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
      else await tx.productionScheduleSessakuPiece.create({ data: { id: piece.id, quantity: piece.quantity, pieceSetId: set.id, position: index + 1 } });
    }
    await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { ...(!pieces.length ? { plannedQuantity: total } : {}), nextPosition: Math.max(set.nextPosition, ordered.length + 1), ...(c.set ? { version: { increment: 1 } } : {}) } });
    for (const site of c.sites) await replaceSiteItems(tx, c.key, before.get(site)!, site, [itemId], added.map((p) => `piece:${p.id}`), params.audit);
    await replaceLaterPieces(tx, c.later, await readSessakuPieceSet(tx, c.key), c.sites, before, params.audit);
  });
}
export async function mergeSessakuPieces(params: SessakuPiecesMergeRequest & { siteKey: string; audit?: PieceAuditContext }): Promise<SessakuPiecesMutationResponse> {
  if (!params.audit) return runSessakuPieceOperation({ action: 'merge', siteKey: params.siteKey, expectedVersion: params.expectedPieceSetVersion,
    parentItemId: params.parentItemId, pieceIds: params.pieceIds, itemRevisions: params.itemRevisions }, (audit) => mergeSessakuPieces({ ...params, audit }));
  return operate({ ...params, discoverUnsplitLater: (set) => set?.pieces.some((piece) => !params.pieceIds.includes(piece.id)) === true }, async (tx, c) => {
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
    await assertNoOperationCompletions(tx, [...params.pieceIds, ...c.later.flatMap(({ set }) => set?.pieces.filter((piece) => piece.sourcePieceId && params.pieceIds.includes(piece.sourcePieceId)).map((piece) => piece.id) ?? [])]);
    assertLaterProcessesEditable(c.later);
    const before = await beforeProjections(tx, c.sites, c.key, params.pieceIds.map((id) => `piece:${id}`), c.later, params.audit);
    await rememberPieceHistory(tx, c.key);
    await removeLaterPieces(tx, c.later, params.pieceIds);
    await tx.productionScheduleSessakuPiece.deleteMany({ where: { id: { in: params.pieceIds } } });
    const all = selected.length === c.set.pieces.length;
    const id = randomUUID();
    if (!all) await tx.productionScheduleSessakuPiece.create({ data: { id, pieceSetId: c.set.id, position: Math.min(...selected.map((p) => p.position)), quantity: selected.reduce((n, p) => n + p.quantity, 0) } });
    await tx.productionScheduleSessakuPieceSet.update({ where: { id: c.set.id }, data: { version: { increment: 1 }, quantityWarning: null } });
    for (const site of c.sites) await replaceSiteItems(tx, c.key, before.get(site)!, site, params.pieceIds.map((p) => `piece:${p}`), [all ? params.parentItemId : `piece:${id}`], params.audit);
    await replaceLaterPieces(tx, c.later, await readSessakuPieceSet(tx, c.key), c.sites, before, params.audit);
  });
}
export async function setSessakuPieceCompletion(params: SessakuPieceCompletionRequest & { siteKey: string; pieceId: string; audit?: PieceAuditContext }): Promise<SessakuPiecesMutationResponse> {
  if (!params.audit) return runSessakuPieceOperation({ action: params.intent === 'complete' ? 'complete' : 'uncomplete', siteKey: params.siteKey, expectedVersion: params.expectedPieceSetVersion,
    pieceIds: [params.pieceId], itemRevision: params.itemRevision }, (audit) => setSessakuPieceCompletion({ ...params, audit }));
  const keys = await resolveSessakuPieceItemKeys(prisma, [`piece:${params.pieceId}`]);
  const key = keys.get(`piece:${params.pieceId}`)!;
  return operate({ ...params, parentItemId: sessakuPieceParentItemId(key) }, async (tx, c) => {
    const piece = c.set?.pieces.find((p) => p.id === params.pieceId);
    if (!piece || !c.set) conflict();
    assertRevision(c.current.pieces.find((p) => p.pieceId === piece.id), params.itemRevision);
    if (c.external && params.intent === 'incomplete') conflict('EXTERNALLY_COMPLETED_ITEM');
    if (c.external) return;
    const completed = params.intent === 'complete';
    const item = c.current.pieces.find((item) => item.pieceId === piece.id);
    if (!item) conflict('STALE_SESSAKU_PIECES');
    const operationChanged = await syncWholePieceOperationCompletions(tx, params.siteKey, piece, item, completed);
    await writePieceCompletion(tx, c.set.id, piece, completed, operationChanged);
    await reconcileSessakuPieceQuantities(tx, c.key, c.plannedQuantity);
  });
}

// Shared by direct piece completion and operation aggregation, inside operate's transaction.
async function writePieceCompletion(tx: Prisma.TransactionClient, pieceSetId: string,
  piece: { id: string; isCompleted: boolean }, completed: boolean, operationChanged = false) {
  if (piece.isCompleted !== completed) {
    await tx.productionScheduleSessakuPiece.update({ where: { id: piece.id },
      data: { isCompleted: completed, completedAt: completed ? new Date() : null } });
  }
  if (piece.isCompleted !== completed || operationChanged) {
    await tx.productionScheduleSessakuPieceSet.update({ where: { id: pieceSetId }, data: { version: { increment: 1 } } });
  }
}

export async function setSessakuPieceOpCompletion(params: SessakuPieceCompletionRequest & {
  siteKey: string; pieceId: string; opNo: number; audit?: PieceAuditContext;
}): Promise<SessakuPiecesMutationResponse> {
  const body = sessakuPieceCompletionSchema.parse(params);
  const opNo = resourcePartOpMinutesSchema.shape.opNo.parse(params.opNo);
  if (!params.audit) return runSessakuPieceOperation({ action: body.intent === 'complete' ? 'op_complete' : 'op_uncomplete',
    siteKey: params.siteKey, expectedVersion: body.expectedPieceSetVersion, pieceIds: [params.pieceId], itemRevision: body.itemRevision },
    (audit) => setSessakuPieceOpCompletion({ ...params, audit }));
  const keys = await resolveSessakuPieceItemKeys(prisma, [`piece:${params.pieceId}`]);
  const key = keys.get(`piece:${params.pieceId}`)!;
  return operate({ ...params, parentItemId: sessakuPieceParentItemId(key) }, async (tx, c) => {
    const piece = c.set?.pieces.find((piece) => piece.id === params.pieceId);
    const item = c.current.pieces.find((item) => item.pieceId === params.pieceId);
    if (!piece || !c.set || !item) conflict();
    assertRevision(item, body.itemRevision);
    const definitions = await readPieceOperationNumbers(tx, params.siteKey, item);
    if (!definitions.length || !definitions.some((op) => op.opNo === opNo)) {
      throw new ApiError(400, '登録されていない工程です', undefined, 'PIECE_OPERATION_NOT_CONFIGURED');
    }
    if (c.external && body.intent === 'incomplete') conflict('EXTERNALLY_COMPLETED_ITEM');
    if (c.external) return;
    const where = { pieceId: piece.id, opNo };
    const before = await tx.productionScheduleSessakuPieceOpCompletion.findMany({ where: { pieceId: piece.id }, select: { opNo: true } });
    if (body.intent === 'complete') {
      await tx.productionScheduleSessakuPieceOpCompletion.upsert({ where: { pieceId_opNo: where }, create: where, update: {} });
    } else {
      await tx.productionScheduleSessakuPieceOpCompletion.deleteMany({ where });
    }
    const after = new Set(before.map((op) => op.opNo));
    if (body.intent === 'complete') after.add(opNo); else after.delete(opNo);
    const completed = body.intent === 'complete' && (piece.isCompleted || definitions.every((op) => after.has(op.opNo)));
    await writePieceCompletion(tx, c.set.id, piece, completed, before.some((op) => op.opNo === opNo) !== after.has(opNo));
    await reconcileSessakuPieceQuantities(tx, c.key, c.plannedQuantity);
    params.audit!.beforeJson = { ...params.audit!.beforeJson, opNo, completedOpNos: before.map((op) => op.opNo).sort((a, b) => a - b) };
    params.audit!.afterJson = { opNo, completedOpNos: [...after].sort((a, b) => a - b) };
  });
}

async function rememberPieceHistory(tx: Prisma.TransactionClient, key: SessakuPieceLogicalKey) {
  const logicalKey = sessakuPieceSetWhere(key);
  await tx.productionScheduleSessakuPieceHistory.upsert({
    where: { csvDashboardId_fseiban_fhincd_fsigencd_fkojun: logicalKey }, create: logicalKey, update: {}
  });
}

async function assertNoOperationCompletions(tx: Prisma.TransactionClient, pieceIds: string[]) {
  if (!pieceIds.length) return;
  const completion = await tx.productionScheduleSessakuPieceOpCompletion.findFirst({
    where: { pieceId: { in: pieceIds } }, select: { pieceId: true }
  });
  if (completion) conflict('PIECE_OPERATION_COMPLETED');
}
