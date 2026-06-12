import { ImportStatus, type PrismaClient } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import { dedupeFkojunstMailRowsByLatest, loadFkojunstMailNormalizedRowsFromCsvFile } from '../fkojunst-status-mail-sync.pipeline.js';
import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from '../constants.js';
import {
  buildCanonicalScheduleDisappearanceKeysFromPairedMailSnapshot,
  type ScheduleDedupRowForDisappearance,
} from './schedule-csv-disappearance-canonical-keys.builder.js';

export type ScheduleDedupRowInput = ScheduleDedupRowForDisappearance;

export type ScheduleDisappearanceCanonicalCurrentKeysResolution =
  | {
      outcome: 'apply';
      keys: string[];
      diagnostics: {
        referenceAtIso: string;
        pairedStatusSnapshotAtIso: string;
        scheduleDedupRowCount: number;
        statusMailRowsScanned: number;
        statusMailNormalizedCount: number;
        statusMailDedupedCount: number;
        canonicalIntersectionKeyCount: number;
      };
    }
  | {
      outcome: 'skip_disappearance_sync';
      reason:
        | 'empty_schedule_batch'
        | 'no_status_ingest_run_at_or_before_reference_at'
        | 'no_status_csv_rows_at_or_before_reference_at';
      diagnostics: {
        referenceAtIso?: string;
        pairedStatusSnapshotAtIso?: string;
        scheduleDedupRowCount: number;
        statusMailRowsScanned: number;
        statusMailNormalizedCount: number;
      };
    };

/**
 * 順位ボードの「CSV消滅」入力となる **正本Cの現在キー集合** を構築する。
 *
 * - **2026-05-17 改訂**: 本体 dedupe winner だけでなく、**`FKOJUNST_Status`（`occurredAt <= tA` のスナップショット）と
 *   ADR-20260509 系の **3キー（FKOJUN + FKOTEICD/FSIGENCD + FSEZONO/ProductNo）** が一致する行のみを正本に含める。
 * - **`tA`**: **`scheduleIngestCompletedAt`**（Status 幕の `occurredAt` は取込時刻基準のため、本体CSV日付列と混同しない）。
 * - **`tA` 以前に Status CSV が1行も無い**ときは、**差分消失同期のみスキップ**する（手動・メール完了は維持）。
 * - 差分消滅の正本キーは、蓄積raw履歴ではなく `tA` に対応する **最新CSVスナップショット** から作る。
 *   通常の Status 同期 / 残骸materialization は、別途蓄積raw全体を読む。
 */
export class ProductionScheduleCanonicalCurrentKeysService {
  constructor(private readonly deps: { prismaClient: PrismaClient } = { prismaClient: prisma }) {}

  private async resolveLatestStatusIngestRunAtOrBefore(referenceAt: Date): Promise<{
    startedAt: Date;
    completedAt: Date;
    csvFilePath: string;
  } | null> {
    const latestRun = await this.deps.prismaClient.csvDashboardIngestRun.findFirst({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID,
        status: ImportStatus.COMPLETED,
        completedAt: { lte: referenceAt },
        csvFilePath: { not: null },
      },
      orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }],
      select: { startedAt: true, completedAt: true, csvFilePath: true },
    });
    if (!latestRun?.startedAt || !latestRun.completedAt || !latestRun.csvFilePath) {
      return null;
    }
    return {
      startedAt: latestRun.startedAt,
      completedAt: latestRun.completedAt,
      csvFilePath: latestRun.csvFilePath,
    };
  }

  async resolveScheduleCsvDisappearanceCanonicalCurrentKeys(params: {
    scheduleDedupRows: readonly ScheduleDedupRowInput[];
    /**
     * 生産日程CSV取込完了時刻（同期アンカー `tA`）。Status 幕の `occurredAt` は取込時刻基準のため必須。
     */
    scheduleIngestCompletedAt: Date;
  }): Promise<ScheduleDisappearanceCanonicalCurrentKeysResolution> {
    const scheduleDedupRowCount = params.scheduleDedupRows.length;
    if (scheduleDedupRowCount === 0) {
      return {
        outcome: 'skip_disappearance_sync',
        reason: 'empty_schedule_batch',
        diagnostics: { scheduleDedupRowCount: 0, statusMailRowsScanned: 0, statusMailNormalizedCount: 0 },
      };
    }

    const referenceAt = params.scheduleIngestCompletedAt;
    const latestStatusIngestRun = await this.resolveLatestStatusIngestRunAtOrBefore(referenceAt);
    if (!latestStatusIngestRun) {
      return {
        outcome: 'skip_disappearance_sync',
        reason: 'no_status_ingest_run_at_or_before_reference_at',
        diagnostics: {
          referenceAtIso: referenceAt.toISOString(),
          scheduleDedupRowCount,
          statusMailRowsScanned: 0,
          statusMailNormalizedCount: 0,
        },
      };
    }
    const load = await loadFkojunstMailNormalizedRowsFromCsvFile({
      csvFilePath: latestStatusIngestRun.csvFilePath,
      sourceIngestRunStartedAt: latestStatusIngestRun.startedAt,
      sourceIngestRunCompletedAt: latestStatusIngestRun.completedAt,
    });

    if (load.normalizedRows.length === 0) {
      return {
        outcome: 'skip_disappearance_sync',
        reason: 'no_status_csv_rows_at_or_before_reference_at',
        diagnostics: {
          referenceAtIso: referenceAt.toISOString(),
          pairedStatusSnapshotAtIso: latestStatusIngestRun.completedAt.toISOString(),
          scheduleDedupRowCount,
          statusMailRowsScanned: load.scanned,
          statusMailNormalizedCount: 0,
        },
      };
    }

    const dedupedMailRows = dedupeFkojunstMailRowsByLatest(load.normalizedRows);
    const keys = buildCanonicalScheduleDisappearanceKeysFromPairedMailSnapshot({
      scheduleDedupRows: params.scheduleDedupRows,
      dedupedMailRowsAtOrBeforeReference: dedupedMailRows,
    });

    return {
      outcome: 'apply',
      keys,
      diagnostics: {
        referenceAtIso: referenceAt.toISOString(),
        pairedStatusSnapshotAtIso: latestStatusIngestRun.completedAt.toISOString(),
        scheduleDedupRowCount,
        statusMailRowsScanned: load.scanned,
        statusMailNormalizedCount: load.normalizedRows.length,
        statusMailDedupedCount: dedupedMailRows.length,
        canonicalIntersectionKeyCount: keys.length,
      },
    };
  }
}
