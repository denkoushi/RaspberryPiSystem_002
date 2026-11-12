import { autoUnitSplitMetrics, cooperativeAutoUnitSplitTransaction, isAutoUnitSplitYield, type AutoUnitSplitMetrics } from './auto-unit-split-transaction.js';
import { isAutoUnitSplitBusyError, sessakuPieceSqlState } from './piece-db-error.js';
import type { GrindingPlanningBoardItem, GrindingPlanningBoardResourceCapacityResponse, SessakuPiecesAutoUnitSplitResponse } from '@raspi-system/shared-types';
import { Prisma } from '@prisma/client';
import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { getGrindingPlanningBoardResourceCapacity } from '../grinding-planning-board-resource-capacity.service.js';
import { buildGrindingPlanningBoardRowItemId, projectGrindingPlanningBoard } from '../grinding-planning-board-projection.js';
import { readOverrides, readRanks, readRowDetails, readWinnerRowsByFseibans } from '../grinding-planning-board/source.js';
import { ensurePlanningBoardState, stateOrder } from '../grinding-planning-board/state.js';
import { getResourceCategoryPolicy, isProductionScheduleCuttingResourceCd } from '../policies/resource-category-policy.service.js';
import { autoUnitSplitCandidateSql, isFirstAutoUnitSplitProcess, type AutoUnitSplitRejectedInput, type AutoUnitSplitCursor } from './auto-unit-split-candidates.js';
import { runSessakuPieceOperation, pieceTimingStage, type PieceAuditContext } from './piece-audit.js';
import { sessakuPieceItemIds, sessakuPieceKeyFromRow, sessakuPieceParentItemId, readSessakuPieceSets } from './piece-key.js';
import { runAutoUnitSplitBatch, runAutoUnitSplitLot, splitSessakuPieces } from './sessaku-pieces.service.js';
import { isUnitSplitEnabled } from './unit-split-policy.js';

export const AUTO_UNIT_SPLIT_MAX_LOTS = 3;
export const AUTO_UNIT_SPLIT_MAX_LOCK_PARENTS = 8;
export const AUTO_UNIT_SPLIT_BUDGET_MS = 20000;
export const AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS = 1000;
export const AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS = 1000;
export const AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS = AUTO_UNIT_SPLIT_BUDGET_MS + AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS + 6000;

// Keep traversal independent of rejection TTLs and scheduler backoff. Wrap after reaching the tail.
const candidateCursors = new Map<string, AutoUnitSplitCursor>();

const REJECTED_INPUT_TTL_MS = 3 * 60 * 1000;
const staleInputs = new Map<string, { inputVersion: string; reason: 'stale'; expiresAt: number }>();
const rejectedInputs = new Map<string, AutoUnitSplitRejectedInput & { siteKey: string; expiresAt: number }>();

// Only retry delays live in memory; eligibility and completed work always come from the DB.
const deferredLots = new Map<string, { siteKey: string; parentId: string; reason: string; delayMs: number; expiresAt: number }>();
function deferLot(siteKey: string, parentId: string, reason: string) {
  const key = JSON.stringify([siteKey, parentId]);
  const previous = deferredLots.get(key);
  const delayMs = reason === 'human_write'
    ? Math.min(previous?.reason === reason ? previous.delayMs * 2 : 30000, 300000) : REJECTED_INPUT_TTL_MS;
  deferredLots.set(key, { siteKey, parentId, reason, delayMs, expiresAt: performance.now() + delayMs });
  logger.warn({ event: 'sessaku_piece.auto_unit_split_deferred', siteKey, parentItemId: parentId, reason, retryAfterMs: delayMs },
    'Automatic unit split lot deferred');
}

export function autoUnitSplitCandidates(items: readonly GrindingPlanningBoardItem[], capacity: GrindingPlanningBoardResourceCapacityResponse,
  isCutting: (resourceCd: string) => boolean): GrindingPlanningBoardItem[] {
  // History is retained for auditing, but never blocks enabled resources.
  const parentsWithPieces = new Set(items.map((item) => item.parentItemId));
  return items.filter((item) => !item.sourcePieceId && !item.isLaterProcess
    && (item.kind === 'piece' || item.pieceSetVersion === undefined || !parentsWithPieces.has(item.itemId))
    && item.fseiban.trim() !== '********' && item.fseiban.trim() !== '' && item.fhincd.trim() !== '' && item.processOrder.trim() !== ''
    && item.originalResourceCd != null && isCutting(item.originalResourceCd)
    && isUnitSplitEnabled(item.effectiveResourceCd, capacity) && !item.isCompleted && !item.quantityWarning
    && (item.parentPlannedQuantity == null || item.parentPlannedQuantity >= 2 && item.parentPlannedQuantity <= 50)
    && Number.isSafeInteger(item.plannedQuantity) && item.plannedQuantity! >= 2 && item.plannedQuantity! <= 50
    && isFirstAutoUnitSplitProcess(item, items));
}

export async function autoSplitSessakuUnits(params: { siteKey: string; audit?: PieceAuditContext; onYield?: (reason: string) => void },
  // Server-side overrides let the opt-in DB benchmark exercise every N through the same complete call.
  limits = { maxLots: AUTO_UNIT_SPLIT_MAX_LOTS, budgetMs: AUTO_UNIT_SPLIT_BUDGET_MS }): Promise<SessakuPiecesAutoUnitSplitResponse> {
  const started = performance.now();
  const metrics: AutoUnitSplitMetrics = { writtenRowCount: 0, lockHeldMs: 0, yieldReason: null, completedParentItemIds: [] };
  let committed = false;
  let previousCursor: { value: AutoUnitSplitCursor | undefined } | undefined;
  let previousStale: typeof staleInputs | undefined;
  let previousRejected: typeof rejectedInputs | undefined;
  const deadline = performance.now() + limits.budgetMs;
  const runnerTimeoutMs = limits.budgetMs + AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS + 6000;
  // The runner owns both the exclusion lock and all successful lot writes.
  let result: SessakuPiecesAutoUnitSplitResponse = { splitCount: 0, skippedCount: 0, hasMore: true };
  try {
    if (process.env.SESSAKU_PIECES_CREATE_ENABLED !== 'true') {
      metrics.yieldReason = 'disabled';
      return { splitCount: 0, skippedCount: 0, hasMore: false };
    }
    const saved = await autoUnitSplitMetrics.run(metrics, () => prisma.$transaction(async (raw) => {
      const { tx: runner, check } = cooperativeAutoUnitSplitTransaction(raw, metrics);
      // Reserve time for the shared transaction to flush placements and commit.
      const runnerDeadline = performance.now() + runnerTimeoutMs - AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS;
      const [lock] = await raw.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended('sessaku-auto-unit-split', 0)) AS acquired`;
      if (!lock.acquired) { metrics.yieldReason = 'runner_busy'; return result; }
      metrics.lockStarted = performance.now();
      // KB-452: JIT compilation ignores statement_timeout. Production row counts can push plan costs
      // past jit_above_cost, so keep this transaction (and only this one) out of JIT.
      await raw.$executeRaw`SET LOCAL jit = off`;
      previousCursor = { value: candidateCursors.get(params.siteKey) };
      previousStale = new Map(staleInputs);
      previousRejected = new Map(rejectedInputs);
      result = await autoSplitLocked(runner, params, Math.min(deadline, runnerDeadline), runnerDeadline, result, limits, started, raw);
      await check(true);
      return result;
    }, { timeout: runnerTimeoutMs, maxWait: 1000 }));
    committed = true;
    for (const parentId of metrics.completedParentItemIds ?? []) deferredLots.delete(JSON.stringify([params.siteKey, parentId]));
    return saved;
  } catch (error) {
    if (previousCursor) {
      if (previousCursor.value) candidateCursors.set(params.siteKey, previousCursor.value);
      else candidateCursors.delete(params.siteKey);
    }
    metrics.errorCode = (error as { code?: string })?.code ?? 'error';
    metrics.errorMessage = error instanceof Error ? error.message : String(error);
    metrics.failedParentItemId = metrics.currentParentItemId ?? null;
    if (previousStale && previousRejected) {
      staleInputs.clear();
      for (const [key, value] of previousStale) staleInputs.set(key, value);
      rejectedInputs.clear();
      for (const [key, value] of previousRejected) rejectedInputs.set(key, value);
    }
    const deferredParentId = metrics.currentParentItemId ?? metrics.completedParentItemIds?.at(-1);
    if (deferredParentId) {
      deferLot(params.siteKey, deferredParentId, isAutoUnitSplitYield(error) ? 'human_write' : metrics.errorCode);
    }
    metrics.yieldReason = isAutoUnitSplitYield(error) ? 'human_write' : sessakuPieceSqlState(error)
      ?? (error as { code?: string })?.code ?? 'error';
    if (error instanceof ApiError && error.code === 'AUTO_UNIT_SPLIT_CANDIDATE_TIMEOUT') {
      logger.warn({ event: 'sessaku_piece.auto_unit_split_candidate_timeout', siteKey: params.siteKey }, 'Automatic unit split candidate query timed out');
      return { splitCount: 0, skippedCount: result.skippedCount, hasMore: true };
    }
    if (isAutoUnitSplitYield(error) || isAutoUnitSplitBusyError(error) || error instanceof ApiError && error.code === 'AUTO_UNIT_SPLIT_BUDGET') return { splitCount: 0, skippedCount: result.skippedCount, hasMore: true };
    throw error;
  } finally {
    if (metrics.yieldReason) params.onYield?.(metrics.yieldReason);
    metrics.lockHeldMs = metrics.lockStarted === undefined ? 0 : performance.now() - metrics.lockStarted;
    // Emit only after commit/rollback; rolled-back lots have no operation/audit log.
    logger.child({}, { level: 'info' }).info({ event: 'sessaku_piece.auto_unit_split_call', siteKey: params.siteKey,
      requestId: params.audit?.requestId, processedLotCount: committed ? result.splitCount : 0,
      writtenRowCount: committed ? metrics.writtenRowCount : 0, totalMs: performance.now() - started,
      lockHeldMs: metrics.lockHeldMs, yieldReason: metrics.yieldReason,
      errorCode: metrics.errorCode ?? null, errorMessage: metrics.errorMessage ?? null,
      failedParentItemId: metrics.failedParentItemId ?? null,
      candidateMs: metrics.candidateMs ?? 0, candidateSqlCount: metrics.candidateSqlCount ?? 0,
      yieldCheckCount: metrics.yieldCheckCount ?? 0, yieldCheckMs: metrics.yieldCheckMs ?? 0 }, 'Automatic unit split call');
  }
}

function assertRunnerDeadline(runnerDeadline: number): void {
  if (performance.now() >= runnerDeadline) throw new ApiError(409, '自動分割の時間予算を超えました', undefined, 'AUTO_UNIT_SPLIT_BUDGET');
}

async function setPreprocessingStatementTimeout(runner: Prisma.TransactionClient, runnerDeadline: number, yieldOnDeadline = false): Promise<boolean> {
  if (yieldOnDeadline && performance.now() >= runnerDeadline) return false;
  assertRunnerDeadline(runnerDeadline);
  const remainingMs = Math.max(1, Math.floor(runnerDeadline - performance.now()));
  await runner.$queryRaw`SELECT set_config('statement_timeout', ${`${remainingMs}ms`}, true)`;
  if (yieldOnDeadline && performance.now() >= runnerDeadline) return false;
  assertRunnerDeadline(runnerDeadline);
  return true;
}

async function autoSplitLocked(runner: Prisma.TransactionClient, params: { siteKey: string; audit?: PieceAuditContext }, deadline: number, runnerDeadline: number,
  result: SessakuPiecesAutoUnitSplitResponse, limits: { maxLots: number; budgetMs: number }, started: number, raw: Prisma.TransactionClient): Promise<SessakuPiecesAutoUnitSplitResponse> {
  assertRunnerDeadline(runnerDeadline);
  await ensurePlanningBoardState(params.siteKey);
  await setPreprocessingStatementTimeout(runner, runnerDeadline);
  const state = await runner.productionScheduleGrindingPlanningBoardState.findUniqueOrThrow({
    where: { csvDashboardId_siteKey: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey } }
  });
  assertRunnerDeadline(runnerDeadline);
  const order = stateOrder(state);
  if (!order.length) return { splitCount: 0, skippedCount: 0, hasMore: false };
  const policy = await getResourceCategoryPolicy(params);
  assertRunnerDeadline(runnerDeadline);
  await setPreprocessingStatementTimeout(runner, runnerDeadline);
  const capacity = await getGrindingPlanningBoardResourceCapacity(params, runner);
  assertRunnerDeadline(runnerDeadline);
  const excludedParentIds = new Set<string>();
  for (const [key, deferred] of deferredLots) {
    if (deferred.expiresAt + 300000 <= performance.now()) deferredLots.delete(key);
    else if (deferred.siteKey === params.siteKey && deferred.expiresAt > performance.now()) excludedParentIds.add(deferred.parentId);
  }
  const cachedRejections: AutoUnitSplitRejectedInput[] = [];
  const now = performance.now();
  for (const [key, rejected] of rejectedInputs) {
    if (rejected.expiresAt <= now) rejectedInputs.delete(key);
    else if (rejected.siteKey === params.siteKey) cachedRejections.push(rejected);
  }
  for (const [key, stale] of staleInputs) if (stale.expiresAt <= now) staleInputs.delete(key);
  let attempted = 0;
  let retryNeeded = false;
  let hasUnlockedCandidates = false;
  const cursor = candidateCursors.get(params.siteKey);
  const after = cursor && order.includes(cursor.fseiban) ? cursor : undefined;
  let lockedCandidates: AutoUnitSplitCursor[] = [];
  let firstRetryIndex: number | undefined;
  let lastLockedCandidate: AutoUnitSplitCursor | undefined;
  const finishWindow = () => {
    if (firstRetryIndex !== undefined) {
      const preceding = firstRetryIndex === 0 ? after : lockedCandidates[firstRetryIndex - 1];
      if (preceding) candidateCursors.set(params.siteKey, preceding);
      else candidateCursors.delete(params.siteKey);
    } else if (hasUnlockedCandidates && lastLockedCandidate) candidateCursors.set(params.siteKey, lastLockedCandidate);
    else candidateCursors.delete(params.siteKey);
    return { ...result, hasMore: retryNeeded || hasUnlockedCandidates || after !== undefined };
  };
  return runSessakuPieceOperation({ ...params.audit, action: 'auto_unit_split', siteKey: params.siteKey }, (batchAudit) =>
    runAutoUnitSplitBatch(runner, async () => {
      await setPreprocessingStatementTimeout(runner, runnerDeadline);
      const rows = await runner.$queryRaw<AutoUnitSplitCursor[]>(Prisma.sql`SELECT "id", "fseiban", "parentId" FROM (${autoUnitSplitCandidateSql(params.siteKey, order, policy, [...excludedParentIds], cachedRejections, { includeInputVersion: false, after })}) AS lock_candidates LIMIT ${AUTO_UNIT_SPLIT_MAX_LOCK_PARENTS + 1}`);
      hasUnlockedCandidates = rows.length > AUTO_UNIT_SPLIT_MAX_LOCK_PARENTS;
      const selected = rows.slice(0, AUTO_UNIT_SPLIT_MAX_LOCK_PARENTS);
      lockedCandidates = selected;
      lastLockedCandidate = selected.at(-1);
      return selected.map((row) => row.parentId);
    }, async (parentIds) => {
      while (true) {
        const pageDeadline = excludedParentIds.size ? Math.min(deadline, runnerDeadline) : runnerDeadline;
        if (result.splitCount > 0 && performance.now() >= deadline) return { ...result, hasMore: true };
        // Later discovery must not abort writes from completed lots.
        const preserveCompletedLots = result.splitCount > 0;
        if (preserveCompletedLots) await runner.$executeRaw`SAVEPOINT auto_unit_split_page`;
        let page;
        try {
          page = await (async () => {
            const candidateSql = autoUnitSplitCandidateSql(params.siteKey, order, policy, [...excludedParentIds], cachedRejections, { parentIds });
            if (!await setPreprocessingStatementTimeout(runner, pageDeadline, preserveCompletedLots)) return;
            let candidateRows: Array<{ id: string; fseiban: string; parentId: string; inputVersion: string }>;
            const candidateStarted = performance.now();
            try {
              candidateRows = await pieceTimingStage.run('candidateMs', () => runner.$queryRaw(Prisma.sql`${candidateSql} LIMIT ${limits.maxLots + 1}`));
            } catch (error) {
              if (sessakuPieceSqlState(error) !== '57014') throw error;
              throw new ApiError(503, '自動分割の候補取得がタイムアウトしました', undefined, 'AUTO_UNIT_SPLIT_CANDIDATE_TIMEOUT');
            }
            const candidateMs = performance.now() - candidateStarted;
            if (batchAudit.timing) { batchAudit.timing.candidateMs += candidateMs; batchAudit.timing.candidateSqlCount += 1; }
            const metrics = autoUnitSplitMetrics.getStore();
            if (metrics) {
              metrics.candidateMs = (metrics.candidateMs ?? 0) + candidateMs;
              metrics.candidateSqlCount = (metrics.candidateSqlCount ?? 0) + 1;
            }
            if (result.splitCount > 0 && performance.now() >= pageDeadline) return;
            assertRunnerDeadline(pageDeadline);
            if (!candidateRows.length) return { empty: true as const };
            const candidateIds = new Set(candidateRows.map((row) => row.id));
            const candidateFseibans = [...new Set(candidateRows.map((row) => row.fseiban))];
            if (!await setPreprocessingStatementTimeout(runner, pageDeadline, preserveCompletedLots)) return;
            const rows = await readWinnerRowsByFseibans(runner, candidateFseibans);
            if (result.splitCount > 0 && performance.now() >= pageDeadline) return;
            assertRunnerDeadline(pageDeadline);
            if (!await setPreprocessingStatementTimeout(runner, pageDeadline, preserveCompletedLots)) return;
            const pieceSets = await readSessakuPieceSets(runner, rows);
            if (!await setPreprocessingStatementTimeout(runner, pageDeadline, preserveCompletedLots)) return;
            const details = await readRowDetails(runner, rows.map((row) => row.id));
            if (!await setPreprocessingStatementTimeout(runner, pageDeadline, preserveCompletedLots)) return;
            const overrides = await readOverrides(runner, params.siteKey, [...rows.map((row) => buildGrindingPlanningBoardRowItemId(row.rowData)),
              ...[...pieceSets.values()].flatMap((set) => set.pieces.flatMap(sessakuPieceItemIds))]);
            if (!await setPreprocessingStatementTimeout(runner, pageDeadline, preserveCompletedLots)) return;
            const ranks = await readRanks(runner, rows.map((row) => row.id), params.siteKey);
            if (result.splitCount > 0 && performance.now() >= pageDeadline) return;
            assertRunnerDeadline(pageDeadline);
            const items = projectGrindingPlanningBoard({ rows, details, pieceSets, includePieces: true, overrides, ranks, seibanOrder: stateOrder(state), category: 'all' }).items;
            if (result.splitCount > 0 && performance.now() >= pageDeadline) return;
            assertRunnerDeadline(pageDeadline);
            const structuralCandidates = autoUnitSplitCandidates(items, capacity, (resourceCd) => isProductionScheduleCuttingResourceCd(resourceCd, policy));
            const setsByPiece = new Map([...pieceSets.values()].flatMap((set) => set.pieces.map((piece) => [piece.id, set] as const)));
            const setsById = new Map([...pieceSets.values()].map((set) => [set.id, set]));
            const completedParents = new Set(items.filter((item) => item.isCompleted).map((item) => item.parentItemId ?? item.itemId));
            for (const row of rows) {
              const detail = details.get(row.id);
              if (detail?.productionScheduleProgress?.isCompleted || detail?.productionScheduleExternalCompletion?.isExternallyCompleted) {
                completedParents.add(sessakuPieceParentItemId(sessakuPieceKeyFromRow(row.rowData)));
              }
            }
            const blockedParents = new Set<string>();
            const protectedPieces = new Set<string>();
            for (const set of pieceSets.values()) {
              const parentId = sessakuPieceParentItemId(set);
              if (set.autoUnitSplitHeldAt || set.quantityWarning || set.pieces.some((piece) => piece.sourcePieceId)) blockedParents.add(parentId);
              if (set.quantityWarning || completedParents.has(parentId) || set.pieces.some((piece) => piece.isCompleted)) {
                const sourceIds = new Set([set.sourcePieceSetId, ...set.pieces.map((piece) => piece.sourcePieceId ? setsByPiece.get(piece.sourcePieceId)?.id : null)]);
                for (const id of sourceIds) {
                  const source = id ? setsById.get(id) : undefined;
                  if (source) blockedParents.add(sessakuPieceParentItemId(source));
                }
              }
              for (const piece of set.pieces) if (piece.opCompletions?.length) {
                protectedPieces.add(piece.id);
                if (piece.sourcePieceId) protectedPieces.add(piece.sourcePieceId);
              }
            }
            const candidates = structuralCandidates.filter((item) => candidateIds.has(item.sourceRowId)
              && !blockedParents.has(item.parentItemId ?? item.itemId) && !protectedPieces.has(item.pieceId!));
            if (result.splitCount > 0 && performance.now() >= pageDeadline) return;
            assertRunnerDeadline(pageDeadline);
            return { empty: false as const, candidateRows, items, candidates, metrics };
          })();
        } catch (error) {
          if (!preserveCompletedLots) throw error;
          // The cooperative runner cannot query an aborted PostgreSQL transaction.
          await raw.$executeRaw`ROLLBACK TO SAVEPOINT auto_unit_split_page`;
          await raw.$executeRaw`RELEASE SAVEPOINT auto_unit_split_page`;
          if (sessakuPieceSqlState(error) === '57014' || error instanceof ApiError
            && ['AUTO_UNIT_SPLIT_BUDGET', 'AUTO_UNIT_SPLIT_CANDIDATE_TIMEOUT'].includes(error.code ?? '')) {
            return { ...result, hasMore: true };
          }
          throw error;
        }
        if (!page) {
          // Also restore statement_timeout before flushing the completed lots.
          await raw.$executeRaw`ROLLBACK TO SAVEPOINT auto_unit_split_page`;
          await raw.$executeRaw`RELEASE SAVEPOINT auto_unit_split_page`;
          return { ...result, hasMore: true };
        }
        if (preserveCompletedLots) await runner.$executeRaw`RELEASE SAVEPOINT auto_unit_split_page`;
        if (page.empty) return finishWindow();
        const { candidateRows, candidates, metrics } = page;
        // Rejections expire or are invalidated by any changed eligibility input.
        const rememberRejection = (parentId: string) => {
          const row = candidateRows.find((row) => row.parentId === parentId);
          if (!row?.inputVersion) return;
          rejectedInputs.set(JSON.stringify([params.siteKey, parentId]), {
            parentId, inputVersion: row.inputVersion, siteKey: params.siteKey, expiresAt: performance.now() + REJECTED_INPUT_TTL_MS
          });
        };
        for (const row of candidateRows) {
          // Fingerprints cover temporary eligibility too, so invalid heads cannot occupy
          // every bounded window forever. Changed inputs become eligible again.
          if (!candidates.some((item) => (item.parentItemId ?? item.itemId) === row.parentId)) rememberRejection(row.parentId);
        }
        // All other exclusions last only for this request. History never gates discovery.
        const previousExcludedCount = excludedParentIds.size;
        for (const row of candidateRows) excludedParentIds.add(row.parentId);
        if (!candidates.length) {
          if (candidateRows.length <= limits.maxLots) return finishWindow();
          if (excludedParentIds.size === previousExcludedCount) return { ...result, hasMore: true };
          continue;
        }
        let stopped = false;
        const lots = new Map<string, GrindingPlanningBoardItem[]>();
        for (const item of candidates) {
          const parentId = item.parentItemId ?? item.itemId;
          const pieces = lots.get(parentId) ?? [];
          pieces.push(item);
          lots.set(parentId, pieces);
        }
        // Each lot keeps its checks and propagation, with a SAVEPOINT for independent rejection.
        for (const [parentItemId, pieces] of lots) {
          if (result.splitCount >= limits.maxLots) break;
          const now = performance.now();
          if (now >= runnerDeadline || attempted > 0 && now >= deadline) break;
          const rejectionKey = JSON.stringify([params.siteKey, parentItemId]);
          const inputVersion = candidateRows.find((row) => row.parentId === parentItemId)?.inputVersion;
          let previous = staleInputs.get(rejectionKey);
          if (previous && previous.expiresAt <= performance.now()) {
            staleInputs.delete(rejectionKey);
            previous = undefined;
          }
          const lotDeadline = Math.min(runnerDeadline,
            attempted === 0 ? now + limits.budgetMs : deadline);
          attempted += 1;
          let expectedVersion = pieces[0].pieceSetVersion ?? 0;
          let lotTiming: PieceAuditContext['timing'];
          if (metrics) metrics.currentParentItemId = parentItemId;
          try {
            await runAutoUnitSplitLot(async () => {
              for (const item of pieces) {
                const saved = await runSessakuPieceOperation({ action: 'auto_unit_split_lot', siteKey: params.siteKey, parentItemId,
                  requestId: params.audit?.requestId, actorClientDeviceId: params.audit?.actorClientDeviceId, actorDeviceName: params.audit?.actorDeviceName,
                  expectedVersion, itemRevision: item.itemRevision }, (audit) => {
                  lotTiming = audit.timing;
                  return splitSessakuPieces({
                    siteKey: params.siteKey, parentItemId, expectedPieceSetVersion: expectedVersion, targetPieceId: item.pieceId, itemRevision: item.itemRevision,
                    quantities: Array.from({ length: item.plannedQuantity! }, () => 1), autoUnitSplit: true, deadline: lotDeadline, audit
                  });
                }, { tx: runner, successOnly: true });
                expectedVersion = saved.pieceSetVersion;
              }
            });
            staleInputs.delete(rejectionKey);
            metrics?.completedParentItemIds?.push(parentItemId);
            result.splitCount += 1;
          } catch (error) {
            const code = (error as { code?: string })?.code;
            if (code === 'P2028' || code === 'P2024') throw error;
            if (isAutoUnitSplitBusyError(error) || isAutoUnitSplitYield(error)) throw error;
            if (error instanceof ApiError && error.statusCode >= 500) throw error;
            result.skippedCount += 1;
            let reloadable = code === 'P2034' || code?.startsWith('STALE_')
              || ['SOURCE_ITEM_MISSING', 'PIECE_REFERENCED', 'AUTO_UNIT_SPLIT_BUDGET'].includes(code ?? '');
            if (code === 'AUTO_UNIT_SPLIT_BUDGET') {
              deferLot(params.siteKey, parentItemId, code);
              staleInputs.delete(rejectionKey);
            } else if (code?.startsWith('STALE_')) {
              if (inputVersion) {
                const reason = 'stale';
                if (previous?.inputVersion === inputVersion && previous.reason === reason) {
                  reloadable = false;
                  staleInputs.delete(rejectionKey);
                } else staleInputs.set(rejectionKey, { inputVersion, reason, expiresAt: performance.now() + REJECTED_INPUT_TTL_MS });
              } else staleInputs.delete(rejectionKey);
            } else staleInputs.delete(rejectionKey);
            // A slow transient conflict must not reclaim the head on every round either.
            if (reloadable && code !== 'AUTO_UNIT_SPLIT_BUDGET' && performance.now() >= deadline) {
              deferLot(params.siteKey, parentItemId, code ?? 'error');
            }
            if (!reloadable) rememberRejection(parentItemId);
            else if (code !== 'AUTO_UNIT_SPLIT_BUDGET') {
              const index = lockedCandidates.findIndex((row) => row.parentId === parentItemId);
              if (index >= 0 && (firstRetryIndex === undefined || index < firstRetryIndex)) firstRetryIndex = index;
            }
            retryNeeded ||= Boolean(reloadable);
            logger.warn({
              event: 'sessaku_piece.auto_unit_split_skipped', siteKey: params.siteKey, parentItemId,
              lotIndex: attempted - 1, elapsedMs: performance.now() - started, lotTiming,
              message: error instanceof Error ? error.message : String(error),
              statusCode: error instanceof ApiError ? error.statusCode : undefined, code
            }, 'Automatic unit split skipped');
            // Deadline exhaustion stops work on unrelated lots.
            if (code === 'AUTO_UNIT_SPLIT_BUDGET') {
              if (metrics) {
                metrics.yieldReason = code;
                metrics.errorCode = code;
                metrics.errorMessage = error instanceof Error ? error.message : String(error);
                metrics.failedParentItemId = metrics.currentParentItemId ?? null;
                metrics.currentParentItemId = null;
              }
              stopped = true; break;
            }
          }
          if (metrics) metrics.currentParentItemId = null;
        }
        if (stopped || performance.now() >= deadline || performance.now() >= runnerDeadline || result.splitCount >= limits.maxLots) {
          return { ...result, hasMore: true };
        }
        if (candidateRows.length <= limits.maxLots) return finishWindow();
        if (excludedParentIds.size === previousExcludedCount) return { ...result, hasMore: true };
      }
    }, batchAudit, raw), { tx: runner, successOnly: true });
}
