import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import {
  dedupeFkojunstMailRowsByLatest,
  loadFkojunstMailSourceRows,
  type FkojunstMailNormalizedRow,
} from '../fkojunst-status-mail-sync.pipeline.js';
import { replaceAllWinnerExternalCompletionStatesFromMailSync } from './fkojunst-external-completion-sync.repository.js';

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
export class FkojunstExternalCompletionSyncService {
  constructor(private readonly deps: { prismaClient: typeof prisma } = { prismaClient: prisma }) {}

  async syncFromCurrentStatusMailDashboard(): Promise<FkojunstExternalCompletionSyncResult> {
    const { normalizedRows } = await loadFkojunstMailSourceRows(this.deps.prismaClient);
    return this.syncFromDedupedStatusMailRows(dedupeFkojunstMailRowsByLatest(normalizedRows));
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

    await this.deps.prismaClient.$transaction(
      async (tx) => {
        await replaceAllWinnerExternalCompletionStatesFromMailSync(tx);
      },
      {
        maxWait: EXTERNAL_COMPLETION_TX_MAX_WAIT_MS,
        timeout: EXTERNAL_COMPLETION_TX_TIMEOUT_MS,
      }
    );

    logger.info(
      {},
      '[FkojunstExternalCompletionSyncService] external completion recalculated from FKOJUNST_Status mail rows'
    );

    return { skipped: false };
  }
}
