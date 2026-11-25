import { replaceMissingStandardHoursProcesses } from '../missing-standard-hours-process.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../fkojunst-status-mail-critical-lock.js';
import { fetchFkojunstStatusMailGenerationSignals } from '../fkojunst-status-mail-generation-signals.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import {
  dedupeFkojunstMailRowsByLatest,
  loadFkojunstMailSourceRows,
  replaceFkojunstMailProjections,
} from '../fkojunst-status-mail-sync.pipeline.js';
import type { FkojunstMailNormalizedRow } from '../fkojunst-mail-row.types.js';
import { replaceAllWinnerExternalCompletionStatesFromMailSync } from './fkojunst-external-completion-sync.repository.js';
import { ProductionScheduleOrderAssignmentReconciliationService } from '../order-assignment/order-assignment-reconciliation.service.js';

export type FkojunstExternalCompletionSyncResult =
  | { skipped: true; reason: 'empty_status_csv' }
  | { skipped: false };

// 生産日程の取り込み後に、状態と付け替えの証拠の置き換えも同じ transaction で行う。メール同期と同じ上限にそろえる。
const EXTERNAL_COMPLETION_TX_TIMEOUT_MS = 300_000;
const EXTERNAL_COMPLETION_TX_MAX_WAIT_MS = 15_000;

/**
 * FKOJUNST_Status 取込同期の直後に呼ぶ。
 * CSV が空（正規化後・dedupe 後にキーが一つも無い）場合は異常扱いで何も更新しない。
 *
 * 最新の winner に厳密一致する状態行と、別資源の完了証拠を使って再計算する。
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
    return this.syncFromDedupedStatusMailRows(deduped, rowsRevision);
  }

  async syncFromDedupedStatusMailRows(
    dedupedRows: readonly FkojunstMailNormalizedRow[],
    scheduleIngestRowsRevision?: string
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
      async (tx) => {
        await acquireFkojunstStatusMailCriticalTransactionLock(tx);
        if (scheduleIngestRowsRevision != null) {
          const signals = await fetchFkojunstStatusMailGenerationSignals(tx);
          if (signals.rowsRevision === scheduleIngestRowsRevision) {
            // A previously matched resource can become unmatched when the schedule changes.
            await replaceFkojunstMailProjections(tx, dedupedRows, true);
          }
        }
        return replaceAllWinnerExternalCompletionStatesFromMailSync(tx, true);
      },
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
