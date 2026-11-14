import { replaceMissingStandardHoursProcesses } from '../missing-standard-hours-process.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { fetchFkojunstStatusMailGenerationSignals } from '../fkojunst-status-mail-generation-signals.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import {
  dedupeFkojunstMailRowsByLatest,
  loadFkojunstMailSourceRows,
  type FkojunstMailNormalizedRow,
} from '../fkojunst-status-mail-sync.pipeline.js';
import { replaceAllWinnerExternalCompletionStatesFromMailSync } from './fkojunst-external-completion-sync.repository.js';
import { ProductionScheduleOrderAssignmentReconciliationService } from '../order-assignment/order-assignment-reconciliation.service.js';

export type FkojunstExternalCompletionSyncResult =
  | { skipped: true; reason: 'empty_status_csv' }
  | { skipped: false };

const EXTERNAL_COMPLETION_TX_TIMEOUT_MS = 60_000;
const EXTERNAL_COMPLETION_TX_MAX_WAIT_MS = 15_000;

/**
 * FKOJUNST_Status 取込同期の直後に呼ぶ。
 * CSV が空（正規化後・dedupe 後にキーが一つも無い）場合は異常扱いで何も更新しない。
 *
 * 外部完了のメール由来は **同期済み `fkmail` の status が C/X か**のみで再計算する。
 */
type FkojunstExternalCompletionSyncServiceDeps = {
  prismaClient: typeof prisma;
  orderAssignmentReconciliationService: ProductionScheduleOrderAssignmentReconciliationService;
};

export class FkojunstExternalCompletionSyncService {
  private readonly deps: FkojunstExternalCompletionSyncServiceDeps;

  constructor(deps: Partial<FkojunstExternalCompletionSyncServiceDeps> = {}) {
    const prismaClient = deps.prismaClient ?? prisma;
    this.deps = {
      prismaClient,
      orderAssignmentReconciliationService:
        deps.orderAssignmentReconciliationService ??
        new ProductionScheduleOrderAssignmentReconciliationService({ prismaClient }),
    };
  }

  async syncFromCurrentStatusMailDashboard(): Promise<FkojunstExternalCompletionSyncResult> {
    const { normalizedRows, rowsRevision } = await loadFkojunstMailSourceRows(this.deps.prismaClient);
    const deduped = dedupeFkojunstMailRowsByLatest(normalizedRows);
    // Schedule ingest replaces donor IDs and may add the previously missing process.
    try {
      await this.deps.prismaClient.$transaction(async (tx) => {
        await acquireFkojunstStatusMailCriticalTransactionLock(tx);
        const signals = await fetchFkojunstStatusMailGenerationSignals(tx);
        if (signals.rowsRevision !== rowsRevision) {
          logger.warn(
            {},
            '[MissingStandardHours] raw source revision changed; skip replacement (next status-mail sync will rebuild candidates)'
          );
          return;
        }
        await replaceMissingStandardHoursProcesses(tx, deduped);
      }, { maxWait: EXTERNAL_COMPLETION_TX_MAX_WAIT_MS, timeout: EXTERNAL_COMPLETION_TX_TIMEOUT_MS });
    } catch (err) {
      logger.error({ err }, '[MissingStandardHours] replacement failed; continuing external completion sync');
    }
    return this.syncFromDedupedStatusMailRows(deduped);
  }

  async syncFromDedupedStatusMailRows(
    dedupedRows: readonly FkojunstMailNormalizedRow[]
  ): Promise<FkojunstExternalCompletionSyncResult> {
    if (dedupedRows.length === 0) {
      logger.warn(
        {},
        '[FkojunstExternalCompletionSyncService] skip external completion sync (no deduped FKOJUNST_Status rows)'
      );
      return { skipped: true, reason: 'empty_status_csv' };
    }

    const startedAt = Date.now();
    const writtenRows = await this.deps.prismaClient.$transaction(
      async (tx) => replaceAllWinnerExternalCompletionStatesFromMailSync(tx),
      {
        maxWait: EXTERNAL_COMPLETION_TX_MAX_WAIT_MS,
        timeout: EXTERNAL_COMPLETION_TX_TIMEOUT_MS,
      }
    );

    logger.info(
      { writtenRows, durationMs: Date.now() - startedAt },
      '[FkojunstExternalCompletionSyncService] external completion recalculated from FKOJUNST_Status mail rows'
    );

    await this.deps.orderAssignmentReconciliationService.reconcileStaleAssignments();

    return { skipped: false };
  }
}
