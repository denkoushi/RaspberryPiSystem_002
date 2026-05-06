import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync } from './fkojunst-external-completion-sync.repository.js';
import { queryWinnerLogicalKeys } from './production-schedule-winner-logical-key.query.js';
import {
  loadScheduleCsvIngestSnapshotKeys,
  replaceScheduleCsvIngestLogicalKeySnapshot,
} from './schedule-csv-logical-key-snapshot.repository.js';

/**
 * 生産日程CSV DEDUP 取込の前後で winner 論理キーをスナップショットし、消滅キーを CSV 由来完了に反映する。
 */
export class ProductionScheduleCsvIngestExternalCompletionSyncService {
  constructor(private readonly deps: { prismaClient: typeof prisma } = { prismaClient: prisma }) {}

  /**
   * 取込直前: 現DB上の winner 論理キー集合を丸ごとスナップショットする。
   */
  async capturePreIngestSnapshot(): Promise<void> {
    const keys = await queryWinnerLogicalKeys(this.deps.prismaClient);
    await this.deps.prismaClient.$transaction(async (tx) => {
      await replaceScheduleCsvIngestLogicalKeySnapshot(tx, keys);
    });
    logger.info({ keyCount: keys.length }, '[ProductionScheduleCsvIngestExternalCompletionSync] pre-ingest snapshot captured');
  }

  /**
   * 取込・アーカイブ処理後: 直前スナップショットと現 winner 集合の差分で完了フラグを更新し、スナップショットを現状態に更新する。
   */
  async applyPostIngestFromSnapshot(params?: {
    currentWinnerKeys?: readonly string[];
  }): Promise<{ disappearedDistinctKeys: number }> {
    const previousKeys = await loadScheduleCsvIngestSnapshotKeys(this.deps.prismaClient);
    const currentKeys = params?.currentWinnerKeys
      ? [...params.currentWinnerKeys]
      : await queryWinnerLogicalKeys(this.deps.prismaClient);
    const currentSet = new Set(currentKeys);
    const disappearedKeys = previousKeys.filter((k) => !currentSet.has(k));

    await this.deps.prismaClient.$transaction(async (tx) => {
      await replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync(tx, disappearedKeys);
      await replaceScheduleCsvIngestLogicalKeySnapshot(tx, currentKeys);
    });

    const disappearedDistinctKeys = new Set(disappearedKeys).size;
    logger.info(
      {
        previousDistinctKeys: previousKeys.length,
        currentDistinctKeys: currentKeys.length,
        disappearedDistinctKeys,
      },
      '[ProductionScheduleCsvIngestExternalCompletionSync] schedule CSV disappearance diff applied'
    );

    return { disappearedDistinctKeys };
  }
}
