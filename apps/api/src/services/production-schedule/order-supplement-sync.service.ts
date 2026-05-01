import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
  dedupeSupplementRows,
  loadSupplementSourceRows,
  loadExistingSupplementsByKey,
  resolveWinnerIdByKey,
  buildReplacementCreateInputs,
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

    logger.info(result, '[ProductionScheduleOrderSupplementSyncService] Order supplement sync completed');
    return result;
  }
}
