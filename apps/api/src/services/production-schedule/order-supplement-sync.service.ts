import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
  dedupeSupplementRows,
  loadSupplementSourceRows,
  resolveWinnerIdByKey,
  buildReplacementCreateInputs,
  runOrderSupplementClearTransaction,
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

    if (normalizedRows.length === 0) {
      const result = await runOrderSupplementClearTransaction(prisma, scanned);
      logger.info(result, '[ProductionScheduleOrderSupplementSyncService] Order supplement sync cleared (no normalized rows)');
      return result;
    }

    const dedupedRows = dedupeSupplementRows(normalizedRows);
    const winnerIdByKey = await resolveWinnerIdByKey(prisma, dedupedRows);
    const { matched, unmatched, createInputs } = buildReplacementCreateInputs(dedupedRows, winnerIdByKey);

    const result = await runOrderSupplementReplacementTransaction(prisma, {
      scanned,
      normalized: dedupedRows.length,
      matched,
      unmatched,
      createInputs,
    });

    logger.info(result, '[ProductionScheduleOrderSupplementSyncService] Order supplement sync completed');
    return result;
  }
}
