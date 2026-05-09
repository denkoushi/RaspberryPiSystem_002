import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync } from './fkojunst-external-completion-sync.repository.js';
import { queryNonCScheduleDisappearanceCandidateKeys } from './production-schedule-nonc-window-winner-key.query.js';
import { queryWinnerLogicalKeys } from './production-schedule-winner-logical-key.query.js';

export type ProductionScheduleCsvIngestExternalCompletionApplyResult =
  | { skipped: true; reason: 'empty_schedule_csv' }
  | { skipped: false; disappearedDistinctKeys: number };

/**
 * 生産日程CSV DEDUP 取込後に、外部完了（CSV消滅）を反映する。
 *
 * **消滅の定義（置換後）**:
 * - 母集団: DB上の winner のうち `FKOJUNST_Status` 同期済みで **C 以外** かつ `occurredAt` が取り込み基準時刻±3か月窓内
 * - 今回CSVバッチの winner 論理キー集合に **含まれない** キーを「消滅」とみなす
 *
 * 旧来の「取込直前スナップショット比較」は、期間取得CSVとFKOJUNST窓のズレで誤判定しやすいため廃止。
 */
export class ProductionScheduleCsvIngestExternalCompletionSyncService {
  constructor(private readonly deps: { prismaClient: typeof prisma } = { prismaClient: prisma }) {}

  /**
   * @deprecated スナップショット比較は廃止。呼び出し側の互換のため **no-op**。
   */
  async capturePreIngestSnapshot(): Promise<void> {
    logger.info(
      {},
      '[ProductionScheduleCsvIngestExternalCompletionSync] capturePreIngestSnapshot is deprecated (no snapshot used)'
    );
  }

  /**
   * 取込完了後: `FKOJUNST 非C×窓内` 母集団から今回バッチキーを差し引き、消滅キーで外部完了を更新する。
   *
   * **現 winner（＝今回バッチ）が 0 件**のときは異常／信頼不能として**適用しない**（誤全件完了防止）。
   */
  async applyPostIngestFromSnapshot(params?: {
    currentWinnerKeys?: readonly string[];
    /** 窓計算・ログ用。省略時は `new Date()`（取込完了直後のサーバ時刻） */
    referenceAt?: Date;
  }): Promise<ProductionScheduleCsvIngestExternalCompletionApplyResult> {
    const currentKeys =
      params?.currentWinnerKeys !== undefined
        ? [...params.currentWinnerKeys]
        : await queryWinnerLogicalKeys(this.deps.prismaClient);

    if (currentKeys.length === 0) {
      logger.warn(
        {},
        '[ProductionScheduleCsvIngestExternalCompletionSync] skip schedule CSV disappearance diff (empty current winner keys)'
      );
      return { skipped: true, reason: 'empty_schedule_csv' };
    }

    const referenceAt = params?.referenceAt ?? new Date();
    const nonCInWindowKeys = await queryNonCScheduleDisappearanceCandidateKeys(this.deps.prismaClient, {
      referenceAt,
    });
    const currentSet = new Set(currentKeys);
    const disappearedKeys = nonCInWindowKeys.filter((k) => !currentSet.has(k));

    await this.deps.prismaClient.$transaction(async (tx) => {
      await replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync(tx, disappearedKeys);
    });

    const disappearedDistinctKeys = new Set(disappearedKeys).size;
    logger.info(
      {
        referenceAt,
        nonCInWindowDistinctKeys: nonCInWindowKeys.length,
        currentDistinctKeys: currentKeys.length,
        disappearedDistinctKeys,
      },
      '[ProductionScheduleCsvIngestExternalCompletionSync] schedule CSV disappearance diff applied (non-C window mother set)'
    );

    return { skipped: false, disappearedDistinctKeys };
  }
}
