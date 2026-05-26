import { logger } from '../../../lib/logger.js';

export type ProductionScheduleCsvIngestExternalCompletionApplyResult =
  | { skipped: true; reason: 'empty_schedule_csv' }
  | { skipped: false; disappearedDistinctKeys: number };

/**
 * 生産日程CSV DEDUP 取込後に使われていた外部完了（CSV消滅）同期の互換サービス。
 *
 * 2026-05-26 以降、キオスク完了正本は手動完了 + FKOJUNST_Status C/X のみ。
 * CSV消滅は現場残存行を誤って完了扱いにし得るため、完了フラグ更新は行わない。
 */
export class ProductionScheduleCsvIngestExternalCompletionSyncService {
  constructor(_deps: unknown = {}) {
    void _deps;
  }

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
   * @deprecated CSV消滅完了は廃止。互換のため受け付けるが、DB更新は行わない。
   */
  async applyPostIngestFromSnapshot(params?: {
    /** 正本C current keys（本体 winner と Status CSV スナップショットの3キー交差。詳細は canonical サービス）。 */
    canonicalScheduleDisappearanceCurrentKeys?: readonly string[];
    /**
     * @deprecated {@link canonicalScheduleDisappearanceCurrentKeys} に改名。
     */
    currentWinnerKeys?: readonly string[];
    /** 窓計算・ログ用。省略時は `new Date()`（取込完了直後のサーバ時刻） */
    referenceAt?: Date;
  }): Promise<ProductionScheduleCsvIngestExternalCompletionApplyResult> {
    const currentKeyCount = (
      params?.canonicalScheduleDisappearanceCurrentKeys ?? params?.currentWinnerKeys ?? []
    ).length;
    logger.info(
      {
        referenceAt: params?.referenceAt,
        canonicalScheduleDisappearanceDistinctKeys: currentKeyCount,
        disappearedDistinctKeys: 0,
      },
      '[ProductionScheduleCsvIngestExternalCompletionSync] schedule CSV disappearance completion sync disabled by policy'
    );

    return { skipped: false, disappearedDistinctKeys: 0 };
  }
}
