import { prisma } from '../../../lib/prisma.js';
import { logger } from '../../../lib/logger.js';
import { replaceAllWinnerExternalCompletionStatesFromScheduleCsvSync } from './fkojunst-external-completion-sync.repository.js';
import { ProductionScheduleOrderAssignmentReconciliationService } from '../order-assignment/order-assignment-reconciliation.service.js';
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
 * - **正本Cの現在キー集合**: **生産日程本体 dedupe winner** のうち、取込完了時点 `tA` までに DB に存在する **`FKOJUNST_Status` スナップショット**と **ADR-20260509 系3キー** が一致する行の論理キーのみ（[`ProductionScheduleCanonicalCurrentKeysService`](./production-schedule-canonical-current-keys.service.ts)）。**`tA` 以前に Status 行が正規化できない場合は差分消失同期のみスキップ**。
 *
 * 旧来の「取込直前スナップショット比較」は、期間取得CSVとFKOJUNST窓のズレで誤判定しやすいため廃止。
 */
type ProductionScheduleCsvIngestExternalCompletionSyncServiceDeps = {
  prismaClient: typeof prisma;
  orderAssignmentReconciliationService: ProductionScheduleOrderAssignmentReconciliationService;
};

export class ProductionScheduleCsvIngestExternalCompletionSyncService {
  private readonly deps: ProductionScheduleCsvIngestExternalCompletionSyncServiceDeps;

  constructor(deps: Partial<ProductionScheduleCsvIngestExternalCompletionSyncServiceDeps> = {}) {
    const prismaClient = deps.prismaClient ?? prisma;
    this.deps = {
      prismaClient,
      orderAssignmentReconciliationService:
        deps.orderAssignmentReconciliationService ??
        new ProductionScheduleOrderAssignmentReconciliationService({ prismaClient }),
    };
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
   * 取込完了後: `FKOJUNST 非C×窓内` 母集団から **正本C現在キー** を差し引き、消滅キーで外部完了を更新する。
   *
   * **正本C現在キーが 0 件**のときは異常／信頼不能として**適用しない**（誤全件完了防止）。
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
    const resolvedIncomingKeys =
      params?.canonicalScheduleDisappearanceCurrentKeys ?? params?.currentWinnerKeys;

    const currentKeys =
      resolvedIncomingKeys !== undefined
        ? [...resolvedIncomingKeys]
        : await queryWinnerLogicalKeys(this.deps.prismaClient);

    if (currentKeys.length === 0) {
      logger.warn(
        {},
        '[ProductionScheduleCsvIngestExternalCompletionSync] skip schedule CSV disappearance diff (empty canonical schedule disappearance current keys)'
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

    await this.deps.orderAssignmentReconciliationService.reconcileStaleAssignments();

    const disappearedDistinctKeys = new Set(disappearedKeys).size;
    logger.info(
      {
        referenceAt,
        nonCInWindowDistinctKeys: nonCInWindowKeys.length,
        canonicalScheduleDisappearanceDistinctKeys: currentKeys.length,
        disappearedDistinctKeys,
      },
      '[ProductionScheduleCsvIngestExternalCompletionSync] schedule CSV disappearance diff applied (non-C window mother set)'
    );

    return { skipped: false, disappearedDistinctKeys };
  }
}
