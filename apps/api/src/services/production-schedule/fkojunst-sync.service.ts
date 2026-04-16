import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
  buildFkojunstReplacementCreateInputs,
  dedupeFkojunstRows,
  loadFkojunstSourceRows,
  resolveFkojunstWinnerIdByKey,
  runFkojunstClearTransaction,
  runFkojunstReplacementTransaction,
} from './fkojunst-sync.pipeline.js';

export type ProductionScheduleFkojunstSyncResult = import('./fkojunst-sync.pipeline.js').FkojunstSyncResult;

/**
 * Syncs `ProductionScheduleFkojunstStatus` from the FKOJUNST CsvDashboard rows
 * onto the main production schedule dashboard (winner rows only). Latest CSV is authoritative.
 */
export class ProductionScheduleFkojunstSyncService {
  async syncFromFkojunstDashboard(): Promise<ProductionScheduleFkojunstSyncResult> {
    const { scanned, normalizedRows, skippedInvalidStatus } = await loadFkojunstSourceRows(prisma);

    if (normalizedRows.length === 0) {
      const result = await runFkojunstClearTransaction(prisma, scanned, skippedInvalidStatus);
      logger.info(result, '[ProductionScheduleFkojunstSyncService] FKOJUNST sync cleared (no normalized rows)');
      return result;
    }

    const dedupedRows = dedupeFkojunstRows(normalizedRows);
    const winnerIdByKey = await resolveFkojunstWinnerIdByKey(prisma, dedupedRows);
    const { matched, unmatched, createInputs } = buildFkojunstReplacementCreateInputs(dedupedRows, winnerIdByKey);

    const result = await runFkojunstReplacementTransaction(prisma, {
      scanned,
      normalized: dedupedRows.length,
      matched,
      unmatched,
      skippedInvalidStatus,
      createInputs,
    });

    if (result.skippedInvalidStatus > 0 || result.unmatched > 0) {
      logger.warn(
        {
          skippedInvalidStatus: result.skippedInvalidStatus,
          unmatched: result.unmatched,
        },
        '[ProductionScheduleFkojunstSyncService] FKOJUNST rows skipped during sync'
      );
    }

    logger.info(result, '[ProductionScheduleFkojunstSyncService] FKOJUNST sync completed');
    return result;
  }
}
