import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import {
  dedupeFkojunstMailRowsByLatest,
  loadFkojunstMailSourceRows,
  buildFkojunstMailStatusKey,
  type FkojunstMailNormalizedRow,
} from '../fkojunst-status-mail-sync.pipeline.js';
import { replaceAllWinnerExternalCompletionStatesFromMailSync } from './fkojunst-external-completion-sync.repository.js';
import {
  loadPreviousDedupeKeys,
  replaceDedupeKeySnapshot,
} from './fkojunst-status-mail-dedupe-key-snapshot.repository.js';

export type FkojunstExternalCompletionSyncResult =
  | { skipped: true; reason: 'empty_status_csv' }
  | { skipped: false; distinctKeys: number; disappearedDistinctKeys: number };

/**
 * FKOJUNST_Status 取込同期の直後に呼ぶ。
 * CSV が空（正規化後・dedupe 後にキーが一つも無い）場合は異常扱いで何も更新しない。
 *
 * 外部完了は「今回の CSV にキーが無いから」ではなく、
 * **直前成功同期の dedupe キー集合にあり、今回の dedupe キー集合から消えたキー**に対応する winner のみ true とする。
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

    const currentDistinctKeys = [
      ...new Set(
        dedupedRows.map((row) =>
          buildFkojunstMailStatusKey({
            fkojun: row.fkojun,
            fkoteicd: row.fkoteicd,
            fsezono: row.fsezono,
          })
        )
      ),
    ].sort((a, b) => a.localeCompare(b));

    const previousKeys = await loadPreviousDedupeKeys(this.deps.prismaClient);
    const currentSet = new Set(currentDistinctKeys);
    const disappearedKeys = previousKeys.filter((k) => !currentSet.has(k));

    await this.deps.prismaClient.$transaction(async (tx) => {
      await replaceAllWinnerExternalCompletionStatesFromMailSync(tx, disappearedKeys);
      await replaceDedupeKeySnapshot(tx, currentDistinctKeys);
    });

    const disappearedDistinctKeys = new Set(disappearedKeys).size;

    logger.info(
      {
        previousDistinctKeys: previousKeys.length,
        currentDistinctKeys: currentDistinctKeys.length,
        disappearedDistinctKeys,
      },
      '[FkojunstExternalCompletionSyncService] external completion sync applied (disappearance diff)'
    );

    return { skipped: false, distinctKeys: currentDistinctKeys.length, disappearedDistinctKeys };
  }
}
