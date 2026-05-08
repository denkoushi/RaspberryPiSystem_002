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
import { FkojunstExternalCompletionSyncService } from './external-completion/fkojunst-external-completion-sync.service.js';

export type ProductionScheduleFkojunstMailStatusSyncResult = import('./fkojunst-status-mail-sync.pipeline.js').FkojunstMailSyncResult;

/**
 * Syncs `ProductionScheduleFkojunstMailStatus` from the FKOJUNST_Status CsvDashboard rows
 * onto the main production schedule dashboard (winner rows only). Latest FUPDTEDT per key is authoritative.
 */
export class ProductionScheduleFkojunstMailStatusSyncService {
  constructor(
    private readonly externalCompletionSyncService: FkojunstExternalCompletionSyncService = new FkojunstExternalCompletionSyncService()
  ) {}

  async syncFromStatusMailDashboard(): Promise<ProductionScheduleFkojunstMailStatusSyncResult> {
    const syncStartedAt = Date.now();
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
      logger.warn(
        { scanned },
        '[ProductionScheduleFkojunstMailStatusSyncService] skip external completion sync (no normalized FKOJUNST_Status rows)'
      );
      return result;
    }

    const dedupedRows = dedupeFkojunstMailRowsByLatest(normalizedRows);
    // #region agent log
    fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99aa8f'},body:JSON.stringify({sessionId:'99aa8f',runId:'fkmail-timeout-debug',hypothesisId:'H1|H3',location:'apps/api/src/services/production-schedule/fkojunst-status-mail-sync.service.ts:43',message:'prepared FKOJUNST mail rows for winner resolution',data:{scanned,normalizedRows:normalizedRows.length,dedupedRows:dedupedRows.length,skippedInvalidStatus,skippedUnparseableDate,elapsedMs:Date.now()-syncStartedAt},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    const winnerResolveStartedAt = Date.now();
    const winnerIdByKey = await resolveFkojunstMailWinnerIdByKey(prisma, dedupedRows);
    const { matched, unmatched, createInputs } = buildFkojunstMailReplacementCreateInputs(dedupedRows, winnerIdByKey);
    // #region agent log
    fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99aa8f'},body:JSON.stringify({sessionId:'99aa8f',runId:'fkmail-timeout-debug',hypothesisId:'H1|H2',location:'apps/api/src/services/production-schedule/fkojunst-status-mail-sync.service.ts:45',message:'winner resolution completed',data:{elapsedMs:Date.now()-winnerResolveStartedAt,winnerIds:winnerIdByKey.size,matched,unmatched,createInputs:createInputs.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    const replacementStartedAt = Date.now();
    const result = await runFkojunstMailReplacementTransaction(prisma, {
      scanned,
      normalized: dedupedRows.length,
      matched,
      unmatched,
      skippedInvalidStatus,
      skippedUnparseableDate,
      createInputs,
    });
    // #region agent log
    fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99aa8f'},body:JSON.stringify({sessionId:'99aa8f',runId:'fkmail-timeout-debug',hypothesisId:'H2|H3',location:'apps/api/src/services/production-schedule/fkojunst-status-mail-sync.service.ts:57',message:'replacement transaction completed',data:{elapsedMs:Date.now()-replacementStartedAt,upserted:result.upserted,pruned:result.pruned,matched:result.matched,unmatched:result.unmatched},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

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

    const extResult = await this.externalCompletionSyncService.syncFromDedupedStatusMailRows(dedupedRows);
    if (!extResult.skipped) {
      // #region agent log
      fetch('http://127.0.0.1:7426/ingest/2502f74a-7c46-49e5-b1c6-8c32b7781f8e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'99aa8f'},body:JSON.stringify({sessionId:'99aa8f',runId:'fkmail-timeout-debug',hypothesisId:'H3',location:'apps/api/src/services/production-schedule/fkojunst-status-mail-sync.service.ts:72',message:'external completion sync completed after FKOJUNST mail sync',data:{dedupedStatusMailRows:dedupedRows.length,totalElapsedMs:Date.now()-syncStartedAt},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      logger.info(
        {
          dedupedStatusMailRows: dedupedRows.length,
        },
        '[ProductionScheduleFkojunstMailStatusSyncService] external completion sync completed'
      );
    }

    return result;
  }
}
