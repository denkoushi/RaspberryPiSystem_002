import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
  dedupeSupplementRows,
  loadSupplementSourceRows,
  loadExistingSupplementsByKey,
  resolveWinnerIdByKey,
  buildReplacementCreateInputs,
  collectExpiredUnmatchedSupplementSourceRowIds,
  deleteExpiredUnmatchedSupplementSourceRows,
  runOrderSupplementReplacementTransaction,
} from './order-supplement-sync.pipeline.js';

/** @public API stable for callers / logs */
export type ProductionScheduleOrderSupplementSyncResult = import('./order-supplement-sync.pipeline.js').OrderSupplementSyncResult;

/**
 * Syncs `ProductionScheduleOrderSupplement` from the order-supplement CsvDashboard rows
 * onto the main production schedule dashboard (winner rows only).
 */
export class ProductionScheduleOrderSupplementSyncService {
  async syncFromSupplementDashboard(): Promise<ProductionScheduleOrderSupplementSyncResult> {
    const { scanned, normalizedRows } = await loadSupplementSourceRows(prisma);
    const dedupedRows = dedupeSupplementRows(normalizedRows);
    const winnerIdByKey = await resolveWinnerIdByKey(prisma, dedupedRows);
    const expiredUnmatchedSourceRowIds = collectExpiredUnmatchedSupplementSourceRowIds({
      normalizedRows,
      winnerIdByKey,
      now: new Date(),
    });
    const existingByKey = await loadExistingSupplementsByKey(prisma);
    const { matched, unmatched, createInputs, updateInputs } = buildReplacementCreateInputs(
      dedupedRows,
      winnerIdByKey,
      existingByKey,
      new Date()
    );

    const result = await runOrderSupplementReplacementTransaction(prisma, {
      scanned,
      normalized: dedupedRows.length,
      matched,
      unmatched,
      createInputs,
      updateInputs,
    });

    let sourceRowsPruned = 0;
    try {
      sourceRowsPruned = await deleteExpiredUnmatchedSupplementSourceRows(
        prisma,
        expiredUnmatchedSourceRowIds
      );
    } catch (error) {
      logger.warn(
        { err: error, candidateCount: expiredUnmatchedSourceRowIds.length },
        '[ProductionScheduleOrderSupplementSyncService] Order supplement source retention cleanup failed'
      );
    }

    logger.info(
      { ...result, sourceRowsPruned },
      '[ProductionScheduleOrderSupplementSyncService] Order supplement sync completed'
    );
    return result;
  }
}
