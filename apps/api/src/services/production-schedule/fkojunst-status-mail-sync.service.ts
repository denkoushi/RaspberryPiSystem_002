import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import {
  buildFkojunstMailReplacementCreateInputs,
  dedupeFkojunstMailRowsByLatest,
  loadFkojunstMailSourceRows,
  resolveFkojunstMailWinnerIdByKey,
  runFkojunstMailClearTransaction,
  runFkojunstMailReplacementTransaction,
} from './fkojunst-status-mail-sync.pipeline.js';

export type ProductionScheduleFkojunstMailStatusSyncResult = import('./fkojunst-status-mail-sync.pipeline.js').FkojunstMailSyncResult;

/**
 * Syncs `ProductionScheduleFkojunstMailStatus` from the FKOJUNST_Status CsvDashboard rows
 * onto the main production schedule dashboard (winner rows only). Latest FUPDTEDT per key is authoritative.
 */
export class ProductionScheduleFkojunstMailStatusSyncService {
  async syncFromStatusMailDashboard(): Promise<ProductionScheduleFkojunstMailStatusSyncResult> {
    const { scanned, normalizedRows, skippedInvalidStatus, skippedUnparseableDate } =
      await loadFkojunstMailSourceRows(prisma);

    if (normalizedRows.length === 0) {
      const result = await runFkojunstMailClearTransaction(
        prisma,
        scanned,
        skippedInvalidStatus,
        skippedUnparseableDate
      );
      logger.info(result, '[ProductionScheduleFkojunstMailStatusSyncService] FKOJUNST_Status mail sync cleared (no normalized rows)');
      return result;
    }

    const dedupedRows = dedupeFkojunstMailRowsByLatest(normalizedRows);
    const winnerIdByKey = await resolveFkojunstMailWinnerIdByKey(prisma, dedupedRows);
    const { matched, unmatched, createInputs } = buildFkojunstMailReplacementCreateInputs(dedupedRows, winnerIdByKey);

    const result = await runFkojunstMailReplacementTransaction(prisma, {
      scanned,
      normalized: dedupedRows.length,
      matched,
      unmatched,
      skippedInvalidStatus,
      skippedUnparseableDate,
      createInputs,
    });

    if (result.skippedInvalidStatus > 0 || result.skippedUnparseableDate > 0 || result.unmatched > 0) {
      logger.warn(
        {
          skippedInvalidStatus: result.skippedInvalidStatus,
          skippedUnparseableDate: result.skippedUnparseableDate,
          unmatched: result.unmatched,
        },
        '[ProductionScheduleFkojunstMailStatusSyncService] FKOJUNST_Status mail rows skipped during sync'
      );
    }

    logger.info(result, '[ProductionScheduleFkojunstMailStatusSyncService] FKOJUNST_Status mail sync completed');
    return result;
  }
}
