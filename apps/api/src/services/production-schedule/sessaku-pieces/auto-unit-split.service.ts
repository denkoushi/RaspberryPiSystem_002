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
import { autoUnitSplitCandidateSql, isFirstAutoUnitSplitProcess } from './auto-unit-split-candidates.js';
import { runSessakuPieceOperation, type PieceAuditContext } from './piece-audit.js';
import { sessakuPieceParentItemId, decodeSessakuPieceParentItemId } from './piece-key.js';
import { splitSessakuPieces } from './sessaku-pieces.service.js';
import { isUnitSplitEnabled } from './unit-split-policy.js';

export const AUTO_UNIT_SPLIT_MAX_LOTS = 5;
export const AUTO_UNIT_SPLIT_MAX_EXCLUDED_PARENTS = 60;
export const AUTO_UNIT_SPLIT_BUDGET_MS = 3000;
export const AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS = 1000;
export const AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS = 1000;
export const AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS = AUTO_UNIT_SPLIT_BUDGET_MS + AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS + 6000;
const structuralConflictCodes = new Set(['LATER_PROCESS_PIECE_COMPLETED', 'LATER_PROCESS_PIECE_LOCKED', 'PIECE_OPERATION_COMPLETED']);

export function autoUnitSplitCandidates(items: readonly GrindingPlanningBoardItem[], capacity: GrindingPlanningBoardResourceCapacityResponse,
  isCutting: (resourceCd: string) => boolean, touchedParentIds: ReadonlySet<string> = new Set()): GrindingPlanningBoardItem[] {
  return items.filter((item) => !touchedParentIds.has(item.itemId) && item.kind === 'row' && item.pieceSetVersion === undefined && !item.isLaterProcess
    && item.fseiban.trim() !== '********' && item.fseiban.trim() !== '' && item.fhincd.trim() !== '' && item.processOrder.trim() !== ''
    && item.originalResourceCd != null && isCutting(item.originalResourceCd)
    && isUnitSplitEnabled(item.effectiveResourceCd, capacity) && !item.isCompleted && !item.quantityWarning
    && Number.isSafeInteger(item.plannedQuantity) && item.plannedQuantity! >= 2 && item.plannedQuantity! <= 50
    && isFirstAutoUnitSplitProcess(item, items));
}

export async function autoSplitSessakuUnits(params: { siteKey: string; audit?: PieceAuditContext }): Promise<SessakuPiecesAutoUnitSplitResponse> {
  if (process.env.SESSAKU_PIECES_CREATE_ENABLED !== 'true') return { splitCount: 0, skippedCount: 0, hasMore: false };
  const deadline = performance.now() + AUTO_UNIT_SPLIT_BUDGET_MS;
  // This lock only excludes other auto-split runners; individual lots retain their own transactions.
  let result: SessakuPiecesAutoUnitSplitResponse = { splitCount: 0, skippedCount: 0, hasMore: true };
  const paging: AutoUnitSplitPaging = { extraPage: false, skippedCount: 0 };
  try {
    return await prisma.$transaction(async (runner) => {
      // The runner owns the global lock, while splits use other connections.
      // Reserve time for connection acquisition/commit before its lock can expire.
      const runnerDeadline = performance.now() + AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS - AUTO_UNIT_SPLIT_RUNNER_MARGIN_MS;
      const [lock] = await runner.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtextextended('sessaku-auto-unit-split', 0)) AS acquired`;
      if (!lock.acquired) return result;
      result = await autoSplitLocked(runner, params, Math.min(deadline, runnerDeadline), runnerDeadline, paging);
      return result;
    }, { timeout: AUTO_UNIT_SPLIT_RUNNER_TIMEOUT_MS, maxWait: 1000 });
  } catch (error) {
    // A page after exclusions is bounded by the discovery deadline; a retry would restart from the same head.
    if (paging.extraPage && (error instanceof ApiError && error.code === 'AUTO_UNIT_SPLIT_BUDGET' || sessakuPieceSqlState(error) === '57014')) {
      logger.info({ event: 'sessaku_piece.auto_unit_split_discovery_stopped', siteKey: params.siteKey, reason: 'page_deadline' },
        'Automatic unit split discovery stopped');
      return { splitCount: 0, skippedCount: paging.skippedCount, hasMore: false };
    }
    if (isAutoUnitSplitBusyError(error) || error instanceof ApiError && error.code === 'AUTO_UNIT_SPLIT_BUDGET') return { ...result, hasMore: true };
    throw error;
  }
}

type AutoUnitSplitPaging = { extraPage: boolean; skippedCount: number };

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
  paging: AutoUnitSplitPaging = { extraPage: false, skippedCount: 0 }): Promise<SessakuPiecesAutoUnitSplitResponse> {
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
  const skippedTouched = new Set<string>();
  let candidateRows: Array<{ id: string; fseiban: string; parentId: string }>;
  let candidates: GrindingPlanningBoardItem[];
  while (true) {
    paging.extraPage = excludedParentIds.size > 0;
    const pageDeadline = paging.extraPage ? Math.min(deadline, runnerDeadline) : runnerDeadline;
    const candidateSql = autoUnitSplitCandidateSql(params.siteKey, order, policy, [...excludedParentIds]);
    await setPreprocessingStatementTimeout(runner, pageDeadline);
    candidateRows = await runner.$queryRaw<Array<{ id: string; fseiban: string; parentId: string }>>(Prisma.sql`${candidateSql} LIMIT ${AUTO_UNIT_SPLIT_MAX_LOTS + 1}`);
    assertRunnerDeadline(pageDeadline);
    if (!candidateRows.length) return { splitCount: 0, skippedCount: skippedTouched.size, hasMore: false };
    const candidateIds = new Set(candidateRows.map((row) => row.id));
    const candidateFseibans = [...new Set(candidateRows.map((row) => row.fseiban))];
    await setPreprocessingStatementTimeout(runner, pageDeadline);
    const rows = await readWinnerRowsByFseibans(runner, candidateFseibans);
    assertRunnerDeadline(pageDeadline);
    const keySelect = { fseiban: true, fhincd: true, fsigencd: true, fkojun: true } as const;
    await setPreprocessingStatementTimeout(runner, pageDeadline);
    const [details, existingKeys, overrides, ranks, history] = await Promise.all([
      readRowDetails(runner, rows.map((row) => row.id)),
      runner.productionScheduleSessakuPieceSet.findMany({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: { in: candidateFseibans } }, select: keySelect
      }),
      readOverrides(runner, params.siteKey, rows.map((row) => buildGrindingPlanningBoardRowItemId(row.rowData))), readRanks(runner, rows.map((row) => row.id), params.siteKey),
      runner.productionScheduleSessakuPieceHistory.findMany({
        where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, fseiban: { in: candidateFseibans } }, select: keySelect
      })
    ]);
    assertRunnerDeadline(pageDeadline);
    const items = projectGrindingPlanningBoard({ rows, details, overrides, ranks, seibanOrder: stateOrder(state), category: 'all' }).items;
    assertRunnerDeadline(pageDeadline);
    const structuralCandidates = autoUnitSplitCandidates(items, capacity, (resourceCd) => isProductionScheduleCuttingResourceCd(resourceCd, policy));
    const touched = new Set([...existingKeys, ...history].map(sessakuPieceParentItemId));
    candidates = structuralCandidates.filter((item) => !touched.has(item.itemId) && candidateIds.has(item.sourceRowId));
    for (const item of structuralCandidates) {
      if (touched.has(item.itemId) && candidateIds.has(item.sourceRowId)) skippedTouched.add(item.itemId);
    }
    paging.skippedCount = skippedTouched.size;
    assertRunnerDeadline(pageDeadline);
    if (!candidates.length) {
      if (candidateRows.length <= AUTO_UNIT_SPLIT_MAX_LOTS) return { splitCount: 0, skippedCount: skippedTouched.size, hasMore: false };
      const nextExcluded = new Set([...excludedParentIds, ...candidateRows.map((row) => row.parentId)]);
      // Exclusions last only for this request, so a retry would rescan the same head without progress.
      // Report no more work instead of inviting futile client polling; the bound is a documented limit.
      if (nextExcluded.size > AUTO_UNIT_SPLIT_MAX_EXCLUDED_PARENTS || nextExcluded.size === excludedParentIds.size
        || performance.now() >= deadline) {
        logger.info({ event: 'sessaku_piece.auto_unit_split_discovery_stopped', siteKey: params.siteKey, excludedCount: excludedParentIds.size,
          reason: performance.now() >= deadline ? 'deadline' : 'exclusion_limit' }, 'Automatic unit split discovery stopped');
        return { splitCount: 0, skippedCount: skippedTouched.size, hasMore: false };
      }
      for (const parentId of nextExcluded) excludedParentIds.add(parentId);
      continue;
    }
    paging.extraPage = false;
    break;
  }
  return runSessakuPieceOperation({ ...params.audit, action: 'auto_unit_split', siteKey: params.siteKey }, async () => {
    let splitCount = 0;
    let skippedCount = skippedTouched.size;
    let attempted = 0;
    let retryNeeded = false;
    let markedHistory = false;
    // Each split owns its existing transaction, lock, optimistic checks, propagation and audit.
    for (const item of candidates.slice(0, AUTO_UNIT_SPLIT_MAX_LOTS)) {
      const now = performance.now();
      if (now >= runnerDeadline || attempted > 0 && now >= deadline) break;
      // The first-lot grace never extends beyond the runner's safe deadline.
      const lotDeadline = Math.min(runnerDeadline,
        attempted === 0 && now >= deadline ? now + AUTO_UNIT_SPLIT_FIRST_LOT_GRACE_MS : deadline);
      attempted += 1;
      try {
        await runSessakuPieceOperation({ action: 'auto_unit_split_lot', siteKey: params.siteKey, parentItemId: item.itemId,
          requestId: params.audit?.requestId, actorClientDeviceId: params.audit?.actorClientDeviceId, actorDeviceName: params.audit?.actorDeviceName,
          expectedVersion: 0, itemRevision: item.itemRevision }, (audit) => splitSessakuPieces({
          siteKey: params.siteKey, parentItemId: item.itemId, expectedPieceSetVersion: 0, itemRevision: item.itemRevision,
          quantities: Array.from({ length: item.plannedQuantity! }, () => 1), autoUnitSplit: true, deadline: lotDeadline, audit
        }));
        splitCount += 1;
      } catch (error) {
        if (isAutoUnitSplitBusyError(error)) return { splitCount, skippedCount: skippedCount + 1, hasMore: true };
        const code = (error as { code?: string })?.code;
        if (error instanceof ApiError ? error.statusCode >= 500 : code !== 'P2034') throw error;
        skippedCount += 1;
        retryNeeded ||= !(error instanceof ApiError) && code === 'P2034';
        if (error instanceof ApiError) logger.warn({
          event: 'sessaku_piece.auto_unit_split_skipped', siteKey: params.siteKey, parentItemId: item.itemId,
          statusCode: error.statusCode, code: error.code
        }, 'Automatic unit split skipped');
        if (error instanceof ApiError && error.code && structuralConflictCodes.has(error.code)) {
          await prisma.productionScheduleSessakuPieceHistory.createMany({ data: [{
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, ...decodeSessakuPieceParentItemId(item.itemId)
          }], skipDuplicates: true });
          markedHistory = true;
        }
        // Only lock contention and deadline exhaustion stop work on unrelated lots.
        if (code === 'AUTO_UNIT_SPLIT_BUSY' || code === 'AUTO_UNIT_SPLIT_BUDGET') {
          return { splitCount, skippedCount, hasMore: true };
        }
      }
    }
    return { splitCount, skippedCount, hasMore: retryNeeded
      || attempted < Math.min(candidates.length, AUTO_UNIT_SPLIT_MAX_LOTS)
      || (splitCount > 0 || markedHistory) && (candidates.length > attempted || candidateRows.length > AUTO_UNIT_SPLIT_MAX_LOTS) };
  });
}
