import { autoUnitSplitMetrics, isAutoUnitSplitYield } from './auto-unit-split-transaction.js';
import { createLaneWrites, replaceSiteItems, flushSiteItems } from './piece-lane-writes.js';
import { isAutoUnitSplitBusyError } from './piece-db-error.js';
import { isFirstAutoUnitSplitProcess } from './auto-unit-split-candidates.js';
import { readPieceOperationNumbers, syncWholePieceOperationCompletions } from './piece-operation-definitions.js';
import { getGrindingPlanningBoardResourceCapacity } from '../grinding-planning-board-resource-capacity.service.js';
import { isUnitSplitEnabled } from './unit-split-policy.js';
import { getGrindingPlanningBoardResourceMinutes, resourcePartOpMinutesSchema } from '../grinding-planning-board-resource-minutes.service.js';
import { sessakuPieceCompletionSchema } from './sessaku-pieces.schemas.js';
import { readLaterProcesses, assertLaterProcessesEditable, type LaterProcess } from './piece-later-processes.js';
import { runSessakuPieceOperation, readLaterPieceAuditSnapshots, collectLaterPiecePropagationAudits, pieceTimingStage, type PieceAuditContext, type PieceOperationTiming } from './piece-audit.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
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
import { acquireProductionScheduleParentRowLockInTransaction, acquireProductionScheduleParentRowLocksInTransaction } from '../order-assignment/production-schedule-parent-row-lock.service.js';
import { acquireSessakuPieceBoardStateLocks, acquireSessakuPieceLogicalLocks, decodeSessakuPieceParentItemId, findSessakuPieceWinner, readSessakuPieceSet, readSessakuPieceSets, sessakuPieceKeyFromRow, encodeSessakuPieceKey, resolveSessakuPieceItemKeys, sessakuPieceConflict, sessakuPieceParentItemId, sessakuPieceSetWhere, type SessakuPieceLogicalKey } from './piece-key.js';
import { reconcileSessakuPieceQuantities } from './piece-quantity.js';
import { reconcileSessakuPieceProgress } from './piece-completion.js';

function assertCuttingPieceSet(set: Awaited<ReturnType<typeof readSessakuPieceSet>>) {
  if (set?.sourcePieceSetId || set?.pieces.some((piece) => piece.sourcePieceId)) throw new ApiError(409, '後工程の片は分割・結合できません', undefined, 'LATER_PROCESS_PIECE_LOCKED');
}

function conflict(code = 'STALE_SESSAKU_PIECES'): never {
  throw new ApiError(409, code === 'AUTO_UNIT_SPLIT_BUDGET' ? '自動分割の時間予算を超えました' : '片が更新されています。再読み込みしてください', undefined, code);
}
async function timed<T>(audit: PieceAuditContext | undefined, stage: Extract<keyof PieceOperationTiming, `${string}Ms`>, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const calls = audit?.timing?.dbCallCount ?? 0;
  try { return await pieceTimingStage.run(stage, work); }
  finally {
    if (audit?.timing) {
      audit.timing[stage] += performance.now() - started;
      const count = audit.timing.dbCallCount - calls;
      if (stage === 'lockWaitMs') audit.timing.lockDbCallCount += count;
      if (stage === 'beforeProjectionMs' || stage === 'afterProjectionMs') audit.timing.projectionDbCallCount += count;
      if (stage === 'pieceCreationMs') audit.timing.pieceCreationDbCallCount += count;
      if (stage === 'propagationMs') audit.timing.propagationDbCallCount += count;
      if (stage === 'siteVersionMs') audit.timing.siteVersionDbCallCount += count;
    }
  }
}
async function readProjectionSource(tx: Prisma.TransactionClient, fseibans: string[], audit?: PieceAuditContext, laneScope?: SessakuLaneSourceScope) {
  const rows = await timed(audit, 'sourceWinnerMs', () => readWinnerRowsByFseibans(tx, fseibans, laneScope));
  if (audit?.timing) audit.timing.sourceRowCount += rows.length;
  const details = await timed(audit, 'sourceDetailsMs', () => readRowDetails(tx, rows.map((row) => row.id)));
  const pieceSets = await timed(audit, 'sourcePieceSetsMs', () => readSessakuPieceSets(tx, rows));
  return { rows, details, pieceSets };
}
async function projection(tx: Prisma.TransactionClient, siteKey: string, key: SessakuPieceLogicalKey, allSiteRows = false,
  source?: Awaited<ReturnType<typeof readProjectionSource>>, audit?: PieceAuditContext,
  siteData?: { state: { seibanOrder: Prisma.JsonValue }; overrides: Awaited<ReturnType<typeof readOverrides>>; ranks: Awaited<ReturnType<typeof readRanks>> }, dueSource?: 'excel' | 'scaw') {
  const state = siteData?.state ?? await tx.productionScheduleGrindingPlanningBoardState.findUniqueOrThrow({ where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey } } });
  const fseibans = allSiteRows ? [...stateOrder(state), key.fseiban] : [key.fseiban];
  const shared = source ?? await readProjectionSource(tx, fseibans);
  const scope = new Set(fseibans.map((value) => value.trim()).filter(Boolean));
  const rows = source ? shared.rows.filter((row) => scope.has(sessakuPieceKeyFromRow(row.rowData).fseiban)) : shared.rows;
  const itemKeys = siteData ? [] : [...rows.map((row) => buildGrindingPlanningBoardRowItemId(row.rowData)),
    ...[...shared.pieceSets.values()].flatMap((set) => set.pieces.map((piece) => `piece:${piece.id}`))];
  const overrides = siteData?.overrides ?? await timed(audit, 'overridesMs', () => readOverrides(tx, siteKey, itemKeys));
  const ranks = siteData?.ranks ?? await timed(audit, 'ranksMs', () => readRanks(tx, rows.map((row) => row.id), siteKey));
  // Lane replacement consumes ordering/placement only; durations and operation definitions
  // do not participate in that order. Keep full enrichment for mutation response/revision checks.
  const resourceMinutes = allSiteRows ? undefined : await getGrindingPlanningBoardResourceMinutes({ siteKey }, tx);
  const resourceCapacity = allSiteRows ? undefined : await getGrindingPlanningBoardResourceCapacity({ siteKey }, tx);
  const input = { dueSource, resourceMinutes, resourceCapacity, placementOnly: allSiteRows, rows, details: shared.details, overrides, pieceSets: shared.pieceSets, ranks, seibanOrder: stateOrder(state), category: 'all' as const, view: 'resource' as const };
  // Lane replacement only consumes pieces; avoid projecting every parent a second time.
  return timed(audit, 'projectMs', async () => ({ parents: allSiteRows ? [] : projectGrindingPlanningBoard(input).items, pieces: projectGrindingPlanningBoard({ ...input, includePieces: true }).items, overrides, stateVersionIncrements: 0, laneWrites: createLaneWrites(overrides) }));
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
async function beforeProjections(tx: Prisma.TransactionClient, sites: string[], key: SessakuPieceLogicalKey, removed: string[], later: LaterProcess[], audit?: PieceAuditContext, dueSource?: 'excel' | 'scaw') {
  const batch = autoUnitSplitBatch.getStore();
  if (batch?.before) {
    // An override-only site can see a different extra seiban on each lot. Re-project that
    // site's view from the shared source and pending overrides, preserving sequential scope/rank precedence.
    const scoped = sites.filter((site) => {
      const state = batch.states!.find((state) => state.siteKey === site);
      if (!state) conflict('STALE_SESSAKU_PIECES');
      return batch.keys.some((candidate) => !stateOrder(state).includes(candidate.fseiban));
    });
    if (scoped.length) {
      const source = { ...batch.source!, pieceSets: await readSessakuPieceSets(tx, batch.source!.rows) };
      for (const site of scoped) {
        const previous = batch.before.get(site)!;
        const next = await projection(tx, site, key, true, source, audit, {
          state: batch.states!.find((state) => state.siteKey === site)!, overrides: previous.overrides, ranks: batch.ranks!.get(site)!
        }, dueSource);
        batch.before.set(site, { ...next, laneWrites: previous.laneWrites, stateVersionIncrements: previous.stateVersionIncrements });
      }
    }
    return batch.before;
  }
  const states = await tx.productionScheduleGrindingPlanningBoardState.findMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, ...(batch ? {} : { siteKey: { in: sites } }) } });
  // Source rows, details and piece sets are site independent and stable under the operation locks.
  const projectionSites = states.map((state) => state.siteKey);
  const laneScope = batch ? undefined : await timed(audit, 'laneDiscoveryMs', () => readLaneScope(tx, sites, key, removed, later));
  const source = await readProjectionSource(tx, [...new Set([key.fseiban, ...(batch?.keys.map((key) => key.fseiban) ?? []), ...states.flatMap(stateOrder)])], audit, laneScope);
  const itemKeys = [...source.rows.map((row) => buildGrindingPlanningBoardRowItemId(row.rowData)),
    ...[...source.pieceSets.values()].flatMap((set) => set.pieces.map((piece) => `piece:${piece.id}`))];
  // The same source scope serves every site. Fetch its placements/ranks once and
  // retain each site's existing rank precedence when projecting its own lanes.
  const [overrides, ranks] = await Promise.all([
    timed(audit, 'overridesMs', () => tx.productionScheduleGrindingPlanningBoardOverride.findMany({ where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: { in: projectionSites }, itemKey: { in: itemKeys }
    } })),
    timed(audit, 'ranksMs', () => tx.productionScheduleOrderAssignment.findMany({ where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, csvDashboardRowId: { in: source.rows.map((row) => row.id) },
      OR: [{ siteKey: { in: projectionSites } }, { location: { in: projectionSites } }]
    }, select: { csvDashboardRowId: true, resourceCd: true, orderNumber: true, updatedAt: true, siteKey: true, location: true },
    orderBy: { updatedAt: 'desc' } }))
  ]);
  const before = new Map<string, Awaited<ReturnType<typeof projection>>>();
  const siteRanks = new Map<string, Awaited<ReturnType<typeof readRanks>>>();
  for (const state of states) siteRanks.set(state.siteKey, await readRanks(tx, [], state.siteKey, ranks));
  for (const state of states) before.set(state.siteKey, await projection(tx, state.siteKey, key, true, source, audit, {
    state, overrides: new Map(overrides.filter((row) => row.siteKey === state.siteKey).map((row) => [row.itemKey, row])),
    ranks: siteRanks.get(state.siteKey)!
  }, dueSource));
  if (batch) { batch.before = before; batch.initialBefore = copyBatchProjections(before); batch.states = states; batch.source = source; batch.ranks = siteRanks; }
  return before;
}
async function saveSiteVersions(tx: Prisma.TransactionClient, before: Map<string, Awaited<ReturnType<typeof projection>>>, once = false) {
  // Automatic batches invalidate each changed site once; manual operations preserve their existing increments.
  for (const [siteKey, state] of before) if (state.stateVersionIncrements) {
    await tx.productionScheduleGrindingPlanningBoardState.update({ where: { csvDashboardId_siteKey: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey
    } }, data: { version: { increment: once ? 1 : state.stateVersionIncrements } } });
  }
}
async function removeLaterPieces(tx: Prisma.TransactionClient, later: LaterProcess[], removedSourceIds: string[]) {
  const references = later.flatMap(({ set }) => set?.pieces.filter((piece) => piece.sourcePieceId && removedSourceIds.includes(piece.sourcePieceId)) ?? []);
  const ids = references.filter((piece) => !piece.isCompleted).map((piece) => piece.id);
  const completedIds = references.filter((piece) => piece.isCompleted).map((piece) => piece.id);
  if (completedIds.length) await tx.productionScheduleSessakuPiece.updateMany({ where: { id: { in: completedIds } }, data: { sourcePieceId: null } });
  if (ids.length) {
    await tx.productionScheduleGrindingPlanningBoardOverride.deleteMany({ where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, itemKey: { in: ids.map((id) => `piece:${id}`) } } });
    await tx.productionScheduleSessakuPiece.deleteMany({ where: { id: { in: ids } } });
  }
  for (const { set, hasWinner } of later) {
    if (hasWinner || !set) continue;
    const unlink = !set.pieces.some((piece) => piece.sourcePieceId && !removedSourceIds.includes(piece.sourcePieceId));
    if (unlink || references.some((piece) => piece.pieceSetId === set.id)) {
      await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { ...(unlink ? { sourcePieceSetId: null, quantityWarning: null } : {}), version: { increment: 1 } } });
      if (unlink) set.sourcePieceSetId = null;
    }
  }
}

async function replaceLaterPieces(tx: Prisma.TransactionClient, later: LaterProcess[], source: Awaited<ReturnType<typeof readSessakuPieceSet>>, sites: string[], before: Map<string, Awaited<ReturnType<typeof projection>>>, sourcePlannedQuantity: number | null, audit?: PieceAuditContext) {
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
    const set = process.set ?? await tx.productionScheduleSessakuPieceSet.create({ data: {
      ...sessakuPieceSetWhere(process.key), plannedQuantity: process.plannedQuantity, sourcePieceSetId: source!.id, version: 2
    } });
    if (process.set && process.set.sourcePieceSetId === source!.id) {
      await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { sourcePieceSetId: source!.id, version: { increment: 1 } } });
    }
    if (source?.pieces.length) await reconcileSessakuPieceQuantities(tx, process.key, process.plannedQuantity, true,
      !previous.length && !process.completed ? { set: source, plannedQuantity: sourcePlannedQuantity,
        target: { ...set, sourcePieceSetId: source.id, pieces: [] } } : undefined);
    const saved = await readSessakuPieceSet(tx, process.key);
    const removed = source?.pieces.length ? previous.filter((piece) => !saved?.pieces.some((next) => next.id === piece.id)) : previous;
    const added = saved?.pieces.filter((piece) => !previous.some((old) => old.id === piece.id)).map((piece) => `piece:${piece.id}`) ?? [];
    if (previous.length || added.length) for (const site of sites) await replaceSiteItems(tx, process.key, before.get(site)!, site,
      previous.length ? removed.map((piece) => `piece:${piece.id}`) : [parentId], source?.pieces.length ? added : [parentId], audit);
    await reconcileSessakuPieceProgress(tx, process.key, { emptyIsIncomplete: true, source: process.rowId ? {
      set: saved, rowId: process.rowId, externallyCompleted: process.externallyCompleted,
      previousCompleted: process.previousCompleted, plannedQuantity: process.plannedQuantity
    } : undefined });
    if (!source?.pieces.length) {
      // Existing pre-feature manual sets can be adopted; preserve their history before removal.
      await rememberPieceHistory(tx, process.key);
      await tx.productionScheduleSessakuPieceSet.delete({ where: { id: set.id } });
    }
  }
}

type AutoUnitSplitBatch = {
  tx: Prisma.TransactionClient; raw: Prisma.TransactionClient; audit?: PieceAuditContext; keys: SessakuPieceLogicalKey[]; lockedKeys: ReadonlySet<string>; rowIds: Set<string>;
  before?: Map<string, Awaited<ReturnType<typeof projection>>>;
  initialBefore?: Map<string, Awaited<ReturnType<typeof projection>>>;
  states?: Array<{ siteKey: string; seibanOrder: Prisma.JsonValue }>;
  source?: Awaited<ReturnType<typeof readProjectionSource>>;
  ranks?: Map<string, Awaited<ReturnType<typeof readRanks>>>;
};
const autoUnitSplitBatch = new AsyncLocalStorage<AutoUnitSplitBatch>();

/** Only the automatic runner shares this transaction; direct/manual splits keep operate's transaction. */
export async function runAutoUnitSplitBatch<T>(tx: Prisma.TransactionClient,
  parentIds: () => Promise<string[]>, work: () => Promise<T>, audit?: PieceAuditContext, raw: Prisma.TransactionClient = tx): Promise<T> {
  await tx.$queryRaw`SELECT set_config('lock_timeout', '250ms', true)`;
  await acquireFkojunstStatusMailCriticalTransactionLock(tx);
  // Discover every possible page before taking board locks, preserving critical -> logical -> board -> row.
  const keys = (await parentIds()).map(decodeSessakuPieceParentItemId);
  const lockedKeys = await acquireSessakuPieceLogicalLocks(tx, keys);
  await acquireSessakuPieceBoardStateLocks(tx);
  const rows = await readWinnerRowsByLogicalKeyFseibans(tx, [...new Set(keys.map((key) => key.fseiban))]);
  const selected = rows.filter((row) => lockedKeys.has(encodeSessakuPieceKey(sessakuPieceKeyFromRow(row.rowData))));
  selected.sort((a, b) => a.id.localeCompare(b.id));
  await acquireProductionScheduleParentRowLocksInTransaction(tx, selected.map((row) => row.id));
  if (selected.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "CsvDashboardRow"
    WHERE "id" IN (${Prisma.join(selected.map((row) => row.id))}) ORDER BY "id" FOR UPDATE`);
  const batch: AutoUnitSplitBatch = { tx, raw, audit, keys, lockedKeys, rowIds: new Set(selected.map((row) => row.id)) };
  return autoUnitSplitBatch.run(batch, async () => {
    const result = await work();
    if (batch.before) {
      await timed(audit, 'writeMs', () => flushSiteItems(tx, batch.before!, audit));
      await timed(audit, 'siteVersionMs', () => saveSiteVersions(tx, batch.before!, true));
    }
    return result;
  });
}

function copyBatchProjections(states: NonNullable<AutoUnitSplitBatch['before']>): NonNullable<AutoUnitSplitBatch['before']> {
  return new Map([...states].map(([site, state]) => [site, {
    ...state, overrides: new Map(state.overrides), laneWrites: {
      original: state.laneWrites.original, pending: new Set(state.laneWrites.pending),
      removed: new Set(state.laneWrites.removed), laneVisits: new Map(state.laneWrites.laneVisits)
    }
  }]));
}

/** Roll back both DB writes (including successful audits) and pending in-memory placements for one lot. */
export async function runAutoUnitSplitLot<T>(work: () => Promise<T>): Promise<T> {
  const batch = autoUnitSplitBatch.getStore();
  if (!batch) return work();
  const before = batch.before && copyBatchProjections(batch.before);
  const metrics = autoUnitSplitMetrics.getStore();
  const writtenRows = metrics?.writtenRowCount ?? 0;
  await batch.tx.$executeRaw`SAVEPOINT auto_unit_split_lot`;
  try {
    const result = await work();
    await batch.tx.$executeRaw`RELEASE SAVEPOINT auto_unit_split_lot`;
    return result;
  } catch (error) {
    // A human waiter cancels the entire runner, including prior lots and audits.
    if (isAutoUnitSplitYield(error) || isAutoUnitSplitBusyError(error)) throw error;
    // Recovery must run before any cooperative probe: PostgreSQL rejects SELECT while aborted.
    await batch.raw.$executeRaw`ROLLBACK TO SAVEPOINT auto_unit_split_lot`;
    await batch.raw.$executeRaw`RELEASE SAVEPOINT auto_unit_split_lot`;
    if (metrics) metrics.writtenRowCount = writtenRows;
    batch.before = before ?? (batch.initialBefore && copyBatchProjections(batch.initialBefore));
    throw error;
  }
}

async function operate(params: { dueSource?: 'excel' | 'scaw'; siteKey: string; parentItemId: string; expectedPieceSetVersion: number; audit?: PieceAuditContext; autoUnitSplit?: boolean; deadline?: number; discoverUnsplitLater?: boolean | ((set: Awaited<ReturnType<typeof readSessakuPieceSet>>) => boolean) }, action: (tx: Prisma.TransactionClient, context: {
  key: SessakuPieceLogicalKey; winner: NonNullable<Awaited<ReturnType<typeof findSessakuPieceWinner>>>;
  set: Awaited<ReturnType<typeof readSessakuPieceSet>>; current: Awaited<ReturnType<typeof projection>>;
  external: boolean; plannedQuantity: number | null; sites: string[]; later: LaterProcess[];
}) => Promise<void>): Promise<SessakuPiecesMutationResponse> {
  const batch = params.autoUnitSplit ? autoUnitSplitBatch.getStore() : undefined;
  const key = decodeSessakuPieceParentItemId(params.parentItemId);
  if (params.audit) Object.assign(params.audit, { parentItemId: params.parentItemId, fseiban: key.fseiban });
  if (!batch) await ensurePlanningBoardState(params.siteKey);
  const retryWithExpandedLocks = new Error('Later process lock scope changed');
  const discoveredKeys = new Map<string, SessakuPieceLogicalKey>();
  const execute = () => {
    if (params.deadline !== undefined && performance.now() >= params.deadline) conflict('AUTO_UNIT_SPLIT_BUDGET');
    const remainingMs = params.deadline === undefined ? 30000 : Math.max(1, Math.floor(params.deadline - performance.now()));
    const lockStarted = performance.now();
    let active = true;
    const pending: Promise<unknown>[] = [];
    const executionDeadline = Math.min(params.deadline ?? Infinity, performance.now() + remainingMs);
    const assertActive = () => {
      if (!active || performance.now() >= executionDeadline) conflict('AUTO_UNIT_SPLIT_BUDGET');
    };
    // Promise.all can reject with sibling queries/probes still running. Drain this lot before
    // restoring its SAVEPOINT and shared memory; its proxy must stay invalid afterwards.
    const transaction: typeof prisma.$transaction = batch
      ? ((callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => callback(batch.tx)
        .finally(async () => { active = false; await Promise.allSettled(pending); })) as typeof prisma.$transaction
      : prisma.$transaction.bind(prisma);
    return transaction(async (rawTx) => {
      // Prisma can reject a timed-out interactive transaction while its callback is still running.
      // Check before AND after every awaited query, including writes in nested helpers.
      const guard = <T extends object>(target: T): T => new Proxy(target, {
        get(object, property) {
          const value = Reflect.get(object, property);
          if (typeof value === 'function') return async (...args: unknown[]) => {
            if (params.autoUnitSplit) assertActive();
            if (params.audit?.timing) params.audit.timing.dbCallCount += 1;
            const query = Reflect.apply(value, object, args);
            if (batch) pending.push(Promise.resolve(query));
            const result = await query;
            if (params.autoUnitSplit) assertActive();
            return result;
          };
          return value && typeof value === 'object' ? guard(value) : value;
        }
      });
      const tx = params.autoUnitSplit || params.audit?.timing ? guard(rawTx) : rawTx;
      if (params.audit?.timing) params.audit.timing.lockWaitMs += performance.now() - lockStarted;
      if (!batch && params.deadline !== undefined) {
        await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${Math.min(250, remainingMs)}ms`}, true),
          set_config('statement_timeout', ${`${remainingMs}ms`}, true)`;
      }
      let lockedKeys: ReadonlySet<string> = new Set();
      const lockedRowIds = new Set<string>();
      if (!batch) await timed(params.audit, 'lockWaitMs', async () => {
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
      if (batch) { lockedKeys = batch.lockedKeys; for (const id of batch.rowIds) lockedRowIds.add(id); }
      const set = await readSessakuPieceSet(tx, key);
      const discoverUnsplit = typeof params.discoverUnsplitLater === 'function' ? params.discoverUnsplitLater(set) : params.discoverUnsplitLater === true;
      const later = await readLaterProcesses(tx, key, set, discoverUnsplit);
      const unlocked = later.filter((process) => !lockedKeys.has(encodeSessakuPieceKey(process.key)) || (process.rowId && !lockedRowIds.has(process.rowId)));
      if (batch && (!lockedKeys.has(encodeSessakuPieceKey(key)) || unlocked.length)) conflict('STALE_SESSAKU_PIECES');
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
      if (batch && !batch.rowIds.has(winner.id)) conflict('STALE_SESSAKU_PIECES');
      if (!batch) await timed(params.audit, 'lockWaitMs', async () => {
        await acquireProductionScheduleParentRowLockInTransaction(tx, winner.id);
        await tx.$queryRaw`SELECT "id" FROM "CsvDashboardRow" WHERE "id" = ${winner.id} FOR UPDATE`;
      });
      const detail = (await readRowDetails(tx, [winner.id])).get(winner.id);
      if (params.audit) params.audit.beforeJson = { count: set?.pieces.length ?? 0, quantities: (set?.pieces ?? []).map((p) => p.quantity), pieceIds: (set?.pieces ?? []).map((p) => p.id), completedPieceIds: (set?.pieces ?? []).filter((p) => p.isCompleted).map((p) => p.id), plannedQuantity: detail?.orderSupplements[0]?.plannedQuantity ?? null };
      if ((set?.version ?? 0) !== params.expectedPieceSetVersion) conflict();
      const laterBefore = await readLaterPieceAuditSnapshots(tx, [key]);
      if (params.audit?.timing) params.audit.timing.siteCount = sites.length;
      const current = await timed(params.audit, 'beforeProjectionMs', () => projection(tx, params.siteKey, key, false, undefined, undefined, undefined, params.dueSource));
      const writeStarted = performance.now();
      const beforeProjectionMs = params.audit?.timing?.beforeProjectionMs ?? 0;
      const batchProjectionMs = batch?.audit?.timing?.beforeProjectionMs ?? 0;
      const { saved, result } = await (async () => {
        try {
          await action(tx, { key, winner, set, current, external: detail?.productionScheduleExternalCompletion?.isExternallyCompleted === true, plannedQuantity: detail?.orderSupplements[0]?.plannedQuantity ?? null, sites, later });
          const saved = await readSessakuPieceSet(tx, key);
          const result = await reconcileSessakuPieceProgress(tx, key, { emptyIsIncomplete: true, source: params.autoUnitSplit ? {
            set: saved, rowId: winner.id, externallyCompleted: detail?.productionScheduleExternalCompletion?.isExternallyCompleted === true,
            previousCompleted: detail?.productionScheduleProgress?.isCompleted ?? null,
            plannedQuantity: detail?.orderSupplements[0]?.plannedQuantity ?? null
          } : undefined });
          return { saved, result };
        } finally {
          if (params.audit?.timing) params.audit.timing.writeMs += performance.now() - writeStarted - (params.audit.timing.beforeProjectionMs - beforeProjectionMs)
            - ((batch?.audit?.timing?.beforeProjectionMs ?? 0) - batchProjectionMs);
        }
      })();
      const after = await timed(params.audit, 'afterProjectionMs', () => projection(tx, params.siteKey, key, false, undefined, undefined, undefined, params.dueSource));
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
    }, { timeout: remainingMs, maxWait: params.deadline === undefined ? 15000 : Math.min(250, remainingMs) }).finally(() => { active = false; });
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
  if (!params.audit) return runSessakuPieceOperation({ action: params.autoUnitSplit ? 'auto_unit_split_lot' : 'split', siteKey: params.siteKey, expectedVersion: params.expectedPieceSetVersion,
    requestedQuantities: params.quantities, parentItemId: params.parentItemId, pieceIds: params.targetPieceId ? [params.targetPieceId] : [], itemRevision: params.itemRevision }, (audit) => splitSessakuPieces({ ...params, audit }));
  params.audit.requestedQuantities = params.quantities;
  try { params.audit.fseiban = decodeSessakuPieceParentItemId(params.parentItemId).fseiban; } catch { /* Invalid IDs are rejected by operate when enabled. */ }
  if (process.env.SESSAKU_PIECES_CREATE_ENABLED !== 'true') throw new ApiError(403, '分割作成は無効です', undefined, 'SESSAKU_PIECES_CREATE_DISABLED');
  return operate({ ...params, discoverUnsplitLater: true }, async (tx, c) => {
    assertCuttingPieceSet(c.set);
    if (params.autoUnitSplit) {
      const item = params.targetPieceId
        ? c.current.pieces.find((item) => item.pieceId === params.targetPieceId)
        : c.current.parents.find((item) => item.itemId === params.parentItemId);
      const capacity = await getGrindingPlanningBoardResourceCapacity({ siteKey: params.siteKey }, tx);
      if (!item || !isUnitSplitEnabled(item.effectiveResourceCd, capacity)
        || !Number.isSafeInteger(c.plannedQuantity) || c.plannedQuantity! < 2 || c.plannedQuantity! > 50
        || !Number.isSafeInteger(item.plannedQuantity) || item.plannedQuantity! < 2 || item.plannedQuantity! > 50) {
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
    const quantities = params.autoUnitSplit ? Array.from({ length: total! }, () => 1) : params.quantities;
    if (params.autoUnitSplit) params.audit!.requestedQuantities = quantities;
    if (quantities.length < 2 || quantities.some((q) => !Number.isSafeInteger(q) || q <= 0 || q > 2_147_483_647) || quantities.reduce((a, b) => a + b, 0) !== total) {
      throw new ApiError(400, '分割数量の合計が指示数と一致しません', undefined, 'PIECE_QUANTITY_CONFLICT');
    }
    // Same 50-piece cap as quantity sync; reject before touching later processes or history.
    if ((c.set?.pieces.length ?? 0) - (target ? 1 : 0) + quantities.length > 50) {
      throw new ApiError(400, '片は50までです', undefined, 'PIECE_QUANTITY_CONFLICT');
    }
    await assertNoOperationCompletions(tx, [...(target ? [target.id] : []), ...c.later.flatMap(({ set }) => set?.pieces.filter((piece) => piece.sourcePieceId === target?.id).map((piece) => piece.id) ?? [])]);
    assertLaterProcessesEditable(c.later);
    const batch = params.autoUnitSplit ? autoUnitSplitBatch.getStore() : undefined;
    const projectionAudit = batch?.audit ?? params.audit;
    const before = await timed(projectionAudit, 'beforeProjectionMs',
      () => beforeProjections(tx, c.sites, c.key, [itemId], c.later, projectionAudit, params.dueSource));
    // Automatic work never writes manual-edit history, including on failure.
    if (!params.autoUnitSplit) await rememberPieceHistory(tx, c.key);
    const added = await timed(params.audit, 'pieceCreationMs', async () => {
      const set = c.set ?? await tx.productionScheduleSessakuPieceSet.create({ data: { ...sessakuPieceSetWhere(c.key), plannedQuantity: total } });
      const pieces = c.set?.pieces ?? [];
      const insertAt = target ? pieces.findIndex((p) => p.id === target.id) : 0;
      const added = quantities.map((quantity) => ({ id: randomUUID(), quantity }));
      const ordered = [...pieces.slice(0, insertAt), ...added, ...pieces.slice(target ? insertAt + 1 : insertAt)];
      await removeLaterPieces(tx, c.later, target ? [target.id] : []);
      if (target) await tx.productionScheduleSessakuPiece.delete({ where: { id: target.id } });
      // Move surviving positions above both the old and new ranges before assigning final positions.
      const offset = Math.max(set.nextPosition, ...pieces.map((p) => p.position), ordered.length) + ordered.length + 1;
      if (pieces.length) await tx.productionScheduleSessakuPiece.updateMany({ where: { pieceSetId: set.id }, data: { position: { increment: offset } } });
      for (const [index, piece] of ordered.entries()) {
        if (pieces.some((p) => p.id === piece.id)) await tx.productionScheduleSessakuPiece.update({ where: { id: piece.id }, data: { position: index + 1 } });
      }
      await tx.productionScheduleSessakuPiece.createMany({ data: added.map((piece) => ({ ...piece, pieceSetId: set.id,
        position: ordered.findIndex((item) => item.id === piece.id) + 1 })) });
      await tx.productionScheduleSessakuPieceSet.update({ where: { id: set.id }, data: { ...(!pieces.length ? { plannedQuantity: total } : {}), nextPosition: Math.max(set.nextPosition, ordered.length + 1), ...(c.set ? { version: { increment: 1 } } : {}) } });
      return added;
    });
    for (const site of c.sites) await replaceSiteItems(tx, c.key, before.get(site)!, site, [itemId], added.map((p) => `piece:${p.id}`), params.audit);
    await timed(params.audit, 'propagationMs', async () => replaceLaterPieces(tx, c.later, await readSessakuPieceSet(tx, c.key), c.sites, before, c.plannedQuantity, params.audit));
    if (!autoUnitSplitBatch.getStore()) {
      await flushSiteItems(tx, before, params.audit);
      await timed(params.audit, 'siteVersionMs', () => saveSiteVersions(tx, before));
    }
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
    const all = selected.length === c.set.pieces.length;
    // Merging every piece removes the later sets as a whole, including pieces no longer linked to a cutting piece.
    await assertNoOperationCompletions(tx, [...params.pieceIds, ...c.later.flatMap(({ set }) => set?.pieces.filter((piece) => all || (piece.sourcePieceId && params.pieceIds.includes(piece.sourcePieceId))).map((piece) => piece.id) ?? [])]);
    assertLaterProcessesEditable(c.later);
    const before = await timed(params.audit, 'beforeProjectionMs', () => beforeProjections(tx, c.sites, c.key, params.pieceIds.map((id) => `piece:${id}`), c.later, params.audit, params.dueSource));
    await rememberPieceHistory(tx, c.key);
    await removeLaterPieces(tx, c.later, params.pieceIds);
    await tx.productionScheduleSessakuPiece.deleteMany({ where: { id: { in: params.pieceIds } } });
    const id = randomUUID();
    if (!all) await tx.productionScheduleSessakuPiece.create({ data: { id, pieceSetId: c.set.id, position: Math.min(...selected.map((p) => p.position)), quantity: selected.reduce((n, p) => n + p.quantity, 0) } });
    await tx.productionScheduleSessakuPieceSet.update({ where: { id: c.set.id }, data: { version: { increment: 1 }, quantityWarning: null } });
    for (const site of c.sites) await replaceSiteItems(tx, c.key, before.get(site)!, site, params.pieceIds.map((p) => `piece:${p}`), [all ? params.parentItemId : `piece:${id}`], params.audit);
    await timed(params.audit, 'propagationMs', async () => replaceLaterPieces(tx, c.later, await readSessakuPieceSet(tx, c.key), c.sites, before, c.plannedQuantity, params.audit));
    await flushSiteItems(tx, before, params.audit);
    await timed(params.audit, 'siteVersionMs', () => saveSiteVersions(tx, before));
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
