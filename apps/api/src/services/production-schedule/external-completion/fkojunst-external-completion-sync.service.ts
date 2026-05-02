import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import {
  dedupeFkojunstMailRowsByLatest,
  loadFkojunstMailSourceRows,
  buildFkojunstMailStatusKey,
  type FkojunstMailNormalizedRow,
} from '../fkojunst-status-mail-sync.pipeline.js';
import { replaceAllWinnerExternalCompletionStates } from './fkojunst-external-completion-sync.repository.js';

export type FkojunstExternalCompletionSyncResult =
  | { skipped: true; reason: 'empty_status_csv' }
  | { skipped: false; distinctKeys: number };

/**
 * FKOJUNST_Status 取込同期の直後に呼ぶ。
 * CSV が空（正規化後・dedupe 後にキーが一つも無い）場合は異常扱いで何も更新しない。
 */
export class FkojunstExternalCompletionSyncService {
  constructor(private readonly deps: { prismaClient: typeof prisma } = { prismaClient: prisma }) {}

  async syncFromCurrentStatusMailDashboard(): Promise<FkojunstExternalCompletionSyncResult> {
    const { normalizedRows } = await loadFkojunstMailSourceRows(this.deps.prismaClient);
    return this.syncFromDedupedStatusMailRows(dedupeFkojunstMailRowsByLatest(normalizedRows));
  }

  async syncFromDedupedStatusMailRows(dedupedRows: readonly FkojunstMailNormalizedRow[]): Promise<FkojunstExternalCompletionSyncResult> {
    if (dedupedRows.length === 0) {
      logger.warn(
        {},
        '[FkojunstExternalCompletionSyncService] skip external completion sync (no deduped FKOJUNST_Status rows)'
      );
      return { skipped: true, reason: 'empty_status_csv' };
    }

    const distinctKeys = [
      ...new Set(
        dedupedRows.map((row) =>
          buildFkojunstMailStatusKey({
            fkojun: row.fkojun,
            fkoteicd: row.fkoteicd,
            fsezono: row.fsezono,
          })
        )
      ),
    ];

    await this.deps.prismaClient.$transaction(async (tx) => {
      await replaceAllWinnerExternalCompletionStates(tx, distinctKeys);
    });

    return { skipped: false, distinctKeys: distinctKeys.length };
  }
}
