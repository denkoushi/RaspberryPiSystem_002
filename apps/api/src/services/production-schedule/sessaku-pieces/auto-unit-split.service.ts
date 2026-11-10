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
import { autoUnitSplitCandidateSql, isFirstAutoUnitSplitProcess, type AutoUnitSplitRejectedInput } from './auto-unit-split-candidates.js';
import { runSessakuPieceOperation, pieceTimingStage, type PieceAuditContext } from './piece-audit.js';
import { sessakuPieceKeyFromRow, sessakuPieceParentItemId, readSessakuPieceSets } from './piece-key.js';
import { runAutoUnitSplitBatch, runAutoUnitSplitLot, splitSessakuPieces } from './sessaku-pieces.service.js';
import { isUnitSplitEnabled } from './unit-split-policy.js';

export const AUTO_UNIT_SPLIT_MAX_LOTS = 3;
export const AUTO_UNIT_SPLIT_BUDGET_MS = 3000;
export const AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS = 1000;
export const AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS = 1000;
export const AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS = AUTO_UNIT_SPLIT_BUDGET_MS + AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS + 6000;

const REJECTED_INPUT_TTL_MS = 3 * 60 * 1000;
const staleInputs = new Map<string, { inputVersion: string; expiresAt: number }>();
const rejectedInputs = new Map<string, AutoUnitSplitRejectedInput & { siteKey: string; expiresAt: number }>();

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

export async function autoSplitSessakuUnits(params: { siteKey: string; audit?: PieceAuditContext },
  // Server-side overrides let the opt-in DB benchmark exercise every N through the same complete call.
  limits = { maxLots: AUTO_UNIT_SPLIT_MAX_LOTS, budgetMs: AUTO_UNIT_SPLIT_BUDGET_MS }): Promise<SessakuPiecesAutoUnitSplitResponse> {
  const started = performance.now();
  const metrics: AutoUnitSplitMetrics = { writtenRowCount: 0, lockHeldMs: 0, yieldReason: null };
  let committed = false;
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
      previousStale = new Map(staleInputs);
      previousRejected = new Map(rejectedInputs);
      result = await autoSplitLocked(runner, params, Math.min(deadline, runnerDeadline), runnerDeadline, result, limits);
      await check(true);
      return result;
    }, { timeout: runnerTimeoutMs, maxWait: 1000 }));
    committed = true;
    return saved;
  } catch (error) {
    if (previousStale && previousRejected) {
      staleInputs.clear();
      for (const [key, value] of previousStale) staleInputs.set(key, value);
      rejectedInputs.clear();
      for (const [key, value] of previousRejected) rejectedInputs.set(key, value);
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
    metrics.lockHeldMs = metrics.lockStarted === undefined ? 0 : performance.now() - metrics.lockStarted;
    // Emit only after commit/rollback; rolled-back lots have no operation/audit log.
    logger.child({}, { level: 'info' }).info({ event: 'sessaku_piece.auto_unit_split_call', siteKey: params.siteKey,
      requestId: params.audit?.requestId, processedLotCount: committed ? result.splitCount : 0,
      writtenRowCount: committed ? metrics.writtenRowCount : 0, totalMs: performance.now() - started,
      lockHeldMs: metrics.lockHeldMs, yieldReason: metrics.yieldReason,
      candidateMs: metrics.candidateMs ?? 0, candidateSqlCount: metrics.candidateSqlCount ?? 0,
      yieldCheckCount: metrics.yieldCheckCount ?? 0, yieldCheckMs: metrics.yieldCheckMs ?? 0 }, 'Automatic unit split call');
  }
}

function assertRunnerDeadline(runnerDeadline: number): void {
  if (performance.now() >= runnerDeadline) throw new ApiError(409, '自動分割の時間予算を超えました', undefined, 'AUTO_UNIT_SPLIT_BUDGET');
}

async function setPreprocessingStatementTimeout(runner: Prisma.TransactionClient, runnerDeadline: number): Promise<void> {
  assertRunnerDeadline(runnerDeadline);
  const remainingMs = Math.max(1, Math.floor(runnerDeadline - performance.now()));
  await runner.$queryRaw`SELECT set_config('statement_timeout', ${`${remainingMs}ms`}, true)`;
  assertRunnerDeadline(runnerDeadline);
}

async function autoSplitLocked(runner: Prisma.TransactionClient, params: { siteKey: string; audit?: PieceAuditContext }, deadline: number, runnerDeadline: number,
  result: SessakuPiecesAutoUnitSplitResponse, limits: { maxLots: number; budgetMs: number }): Promise<SessakuPiecesAutoUnitSplitResponse> {
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
  const cachedRejections: AutoUnitSplitRejectedInput[] = [];
  const now = performance.now();
  for (const [key, rejected] of rejectedInputs) {
    if (rejected.expiresAt <= now) rejectedInputs.delete(key);
    else if (rejected.siteKey === params.siteKey) cachedRejections.push(rejected);
  }
  for (const [key, stale] of staleInputs) if (stale.expiresAt <= now) staleInputs.delete(key);
  let attempted = 0;
  let retryNeeded = false;
  return runSessakuPieceOperation({ ...params.audit, action: 'auto_unit_split', siteKey: params.siteKey }, (batchAudit) =>
    runAutoUnitSplitBatch(runner, async () => {
      await setPreprocessingStatementTimeout(runner, runnerDeadline);
      const rows = await runner.$queryRaw<Array<{ parentId: string }>>(Prisma.sql`SELECT "parentId" FROM (${autoUnitSplitCandidateSql(params.siteKey, order, policy, [], cachedRejections)}) AS lock_candidates`);
      return rows.map((row) => row.parentId);
    }, async () => {
      while (true) {
        const pageDeadline = excludedParentIds.size ? Math.min(deadline, runnerDeadline) : runnerDeadline;
        const candidateSql = autoUnitSplitCandidateSql(params.siteKey, order, policy, [...excludedParentIds], cachedRejections);
        await setPreprocessingStatementTimeout(runner, pageDeadline);
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
        assertRunnerDeadline(pageDeadline);
        if (!candidateRows.length) return { ...result, hasMore: retryNeeded };
        const candidateIds = new Set(candidateRows.map((row) => row.id));
        const candidateFseibans = [...new Set(candidateRows.map((row) => row.fseiban))];
        await setPreprocessingStatementTimeout(runner, pageDeadline);
        const rows = await readWinnerRowsByFseibans(runner, candidateFseibans);
        assertRunnerDeadline(pageDeadline);
        await setPreprocessingStatementTimeout(runner, pageDeadline);
        const pieceSets = await readSessakuPieceSets(runner, rows);
        await setPreprocessingStatementTimeout(runner, pageDeadline);
        const details = await readRowDetails(runner, rows.map((row) => row.id));
        await setPreprocessingStatementTimeout(runner, pageDeadline);
        const overrides = await readOverrides(runner, params.siteKey, [...rows.map((row) => buildGrindingPlanningBoardRowItemId(row.rowData)),
          ...[...pieceSets.values()].flatMap((set) => set.pieces.map((piece) => `piece:${piece.id}`))]);
        await setPreprocessingStatementTimeout(runner, pageDeadline);
        const ranks = await readRanks(runner, rows.map((row) => row.id), params.siteKey);
        assertRunnerDeadline(pageDeadline);
        const items = projectGrindingPlanningBoard({ rows, details, pieceSets, includePieces: true, overrides, ranks, seibanOrder: stateOrder(state), category: 'all' }).items;
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
          if (set.quantityWarning || set.pieces.some((piece) => piece.sourcePieceId)) blockedParents.add(parentId);
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
        assertRunnerDeadline(pageDeadline);
        // Rejections expire or are invalidated by any changed eligibility input.
        const rememberRejection = (parentId: string) => {
          const row = candidateRows.find((row) => row.parentId === parentId);
          if (!row?.inputVersion) return;
          rejectedInputs.set(JSON.stringify([params.siteKey, parentId]), {
            parentId, inputVersion: row.inputVersion, siteKey: params.siteKey, expiresAt: performance.now() + REJECTED_INPUT_TTL_MS
          });
        };
        for (const row of candidateRows) {
          const projected = items.find((item) => item.sourceRowId === row.id);
          if (projected && !isFirstAutoUnitSplitProcess(projected, items)) rememberRejection(row.parentId);
        }
        // All other exclusions last only for this request. History never gates discovery.
        const previousExcludedCount = excludedParentIds.size;
        for (const row of candidateRows) excludedParentIds.add(row.parentId);
        if (!candidates.length) {
          if (candidateRows.length <= limits.maxLots) return { ...result, hasMore: retryNeeded };
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
          const lotDeadline = Math.min(runnerDeadline, attempted === 0 ? now + limits.budgetMs : deadline);
          attempted += 1;
          let expectedVersion = pieces[0].pieceSetVersion ?? 0;
          const rejectionKey = JSON.stringify([params.siteKey, parentItemId]);
          try {
            await runAutoUnitSplitLot(async () => {
              for (const item of pieces) {
                const saved = await runSessakuPieceOperation({ action: 'auto_unit_split_lot', siteKey: params.siteKey, parentItemId,
                  requestId: params.audit?.requestId, actorClientDeviceId: params.audit?.actorClientDeviceId, actorDeviceName: params.audit?.actorDeviceName,
                  expectedVersion, itemRevision: item.itemRevision }, (audit) => {
                  return splitSessakuPieces({
                    siteKey: params.siteKey, parentItemId, expectedPieceSetVersion: expectedVersion, targetPieceId: item.pieceId, itemRevision: item.itemRevision,
                    quantities: Array.from({ length: item.plannedQuantity! }, () => 1), autoUnitSplit: true, deadline: lotDeadline, audit
                  });
                }, { tx: runner, successOnly: true });
                expectedVersion = saved.pieceSetVersion;
              }
            });
            staleInputs.delete(rejectionKey);
            result.splitCount += 1;
          } catch (error) {
            const code = (error as { code?: string })?.code;
            if (code === 'P2028' || code === 'P2024') throw error;
            if (isAutoUnitSplitBusyError(error) || isAutoUnitSplitYield(error)) throw error;
            if (error instanceof ApiError && error.statusCode >= 500) throw error;
            result.skippedCount += 1;
            let reloadable = code === 'P2034' || code?.startsWith('STALE_')
              || ['SOURCE_ITEM_MISSING', 'PIECE_REFERENCED', 'AUTO_UNIT_SPLIT_BUSY', 'AUTO_UNIT_SPLIT_BUDGET'].includes(code ?? '');
            if (code?.startsWith('STALE_')) {
              const row = candidateRows.find((row) => row.parentId === parentItemId);
              if (row?.inputVersion) {
                if (staleInputs.get(rejectionKey)?.inputVersion === row.inputVersion) {
                  reloadable = false;
                  staleInputs.delete(rejectionKey);
                } else staleInputs.set(rejectionKey, { inputVersion: row.inputVersion, expiresAt: performance.now() + REJECTED_INPUT_TTL_MS });
              }
            } else staleInputs.delete(rejectionKey);
            if (!reloadable) rememberRejection(parentItemId);
            retryNeeded ||= Boolean(reloadable);
            logger.warn({
              event: 'sessaku_piece.auto_unit_split_skipped', siteKey: params.siteKey, parentItemId,
              statusCode: error instanceof ApiError ? error.statusCode : undefined, code
            }, 'Automatic unit split skipped');
            // Only lock contention and deadline exhaustion stop work on unrelated lots.
            if (code === 'AUTO_UNIT_SPLIT_BUSY' || code === 'AUTO_UNIT_SPLIT_BUDGET') {
              const metrics = autoUnitSplitMetrics.getStore();
              if (metrics) metrics.yieldReason = code ?? null;
              if (code === 'AUTO_UNIT_SPLIT_BUSY') throw error;
              stopped = true; break;
            }
          }
        }
        if (stopped || performance.now() >= deadline || performance.now() >= runnerDeadline || result.splitCount >= limits.maxLots) {
          return { ...result, hasMore: true };
        }
        if (candidateRows.length <= limits.maxLots) return { ...result, hasMore: retryNeeded };
        if (excludedParentIds.size === previousExcludedCount) return { ...result, hasMore: true };
      }
    }, batchAudit), { tx: runner, successOnly: true });
}
