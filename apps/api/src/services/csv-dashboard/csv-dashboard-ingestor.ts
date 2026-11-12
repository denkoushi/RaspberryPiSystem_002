import { readSessakuPieceSets } from '../production-schedule/sessaku-pieces/piece-key.js';
import { publishSessakuPieceSourceCreates } from '../production-schedule/sessaku-pieces/piece-source-publication.js';
import { prepareSessakuPiecePublication, publishSessakuPieceProgress } from '../production-schedule/sessaku-pieces/piece-sync.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import {
  PRODUCTION_SCHEDULE_PRODUCT_NO_COLUMN,
  PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS,
  calculateProductionScheduleDataHash,
  resolveToMaxProductNoPerLogicalKey,
} from '../production-schedule/row-resolver/index.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
  PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID
} from '../production-schedule/constants.js';
import { acquireFkojunstStatusMailCriticalTransactionLock } from '../production-schedule/fkojunst-status-mail-critical-lock.js';
import { ProductionScheduleCleanupService } from '../production-schedule/retention/index.js';
import { ProgressSyncFromCsvService } from '../production-schedule/progress-sync-from-csv.service.js';
import { ProgressSyncEligibilityPolicy } from '../production-schedule/progress-sync-eligibility.policy.js';
import type { ColumnDefinition, NormalizedRowData } from './csv-dashboard.types.js';
import {
  parseCsv,
  createColumnMapping,
  normalizeRow,
  extractOccurredAt,
  calculateDataHash,
  validateProductionScheduleRow,
} from './csv-dashboard-row-normalizer.js';
import { computeCsvDashboardDedupDiff } from './diff/csv-dashboard-diff.js';
import { CsvDashboardDedupCleanupService } from './csv-dashboard-dedup-cleanup.service.js';
import { findCsvDashboardRowsByDataHashes } from './csv-dashboard-existing-rows-by-hash.reader.js';
import {
  applyFkojunstDeferredRowUpdatesInTransaction,
  FKOJUNST_STATUS_MAIL_COMPLETION_TX_TIMEOUT_MS,
  type FkojunstDeferredRowUpdate,
} from './fkojunst-status-mail-ingest-publication.js';
import { SCAW_STFUTEKIGO_DASHBOARD_ID } from '../scaw-stfutekigo/constants.js';

/**
 * CSVダッシュボード取り込みサービス
 */
export class CsvDashboardIngestor {
  private static readonly COMPLETED_PROGRESS_VALUE = '完了';
  private static readonly SAFE_SQL_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
  private static readonly COMPLETION_TX_TIMEOUT_MS = 60_000;
  private static readonly COMPLETION_TX_MAX_WAIT_MS = 15_000;
  private dedupCleanupService = new CsvDashboardDedupCleanupService();
  private progressSyncFromCsvService = new ProgressSyncFromCsvService();
  private progressSyncEligibilityPolicy = new ProgressSyncEligibilityPolicy();

  /**
   * Gmailから取得したCSVをダッシュボードに取り込む
   */
  async ingestFromGmail(
    dashboardId: string,
    csvContent: string,
    messageId?: string,
    messageSubject?: string,
    csvFilePath?: string,
    sourceReceivedAt?: Date | null
  ): Promise<{
    ingestRunId: string;
    rowsProcessed: number;
    rowsAdded: number;
    rowsSkipped: number;
  }> {
    const dashboard = await prisma.csvDashboard.findUnique({
      where: { id: dashboardId },
    });

    if (!dashboard) {
      throw new ApiError(404, 'CSVダッシュボードが見つかりません');
    }

    if (!dashboard.enabled) {
      throw new ApiError(400, 'CSVダッシュボードが無効です');
    }

    // 取り込み実行ログを作成
    const ingestRun = await prisma.csvDashboardIngestRun.create({
      data: {
        csvDashboardId: dashboardId,
        status: 'PROCESSING',
        messageId: messageId ?? null,
        messageSubject: messageSubject ?? null,
        csvFilePath: csvFilePath ?? null,
        sourceReceivedAt: sourceReceivedAt ?? null,
      },
    });

    try {
      // CSVをパース
      const rows = parseCsv(csvContent);
      const columnDefinitions = dashboard.columnDefinitions as unknown as ColumnDefinition[];

      // 列マッピングを作成（CSVヘッダー → 内部名）
      const columnMapping = createColumnMapping(rows[0] || [], columnDefinitions);
      const progressSyncEligibility = this.progressSyncEligibilityPolicy.evaluate({
        dashboardId,
        mappedInternalNames: columnMapping.map((m) => m.internalName),
      });

      // 日付列のインデックスを取得
      const dateColumnIndex = dashboard.dateColumnName
        ? columnMapping.findIndex((m) => m.internalName === dashboard.dateColumnName)
        : -1;

      // 行データを正規化
      const normalizedRows: Array<{
        data: NormalizedRowData;
        occurredAt: Date;
        sourceIngestRunId: string;
        sourceRowOrdinal: number;
        sourceIngestRunStartedAt: Date;
        hash?: string;
      }> = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const normalized = normalizeRow(
          row,
          columnMapping,
          dashboardId === SCAW_STFUTEKIGO_DASHBOARD_ID
        );
        const occurredAt = extractOccurredAt(row, dateColumnIndex, {
          dashboardId,
          dateColumnName: dashboard.dateColumnName ?? null,
        });
        if (dashboardId === PRODUCTION_SCHEDULE_DASHBOARD_ID) {
          validateProductionScheduleRow(normalized, i);
        }

        normalizedRows.push({
          data: normalized,
          occurredAt,
          sourceIngestRunId: ingestRun.id,
          sourceRowOrdinal: i,
          sourceIngestRunStartedAt: ingestRun.startedAt
        });
      }

      const rowsProcessed = normalizedRows.length;
      const isProductionScheduleDashboard = dashboardId === PRODUCTION_SCHEDULE_DASHBOARD_ID;

      // production schedule (DEDUP) のみ: 1年超過行は保存しない（取り込み時点で除外）
      const cleanupService = new ProductionScheduleCleanupService();
      let oneYearFilteredRows = normalizedRows;
      let oneYearDroppedCount = 0;
      if (isProductionScheduleDashboard && dashboard.ingestMode === 'DEDUP') {
        const filtered = cleanupService.filterIncomingRowsByOneYear({ rows: normalizedRows });
        oneYearFilteredRows = filtered.kept;
        oneYearDroppedCount = filtered.droppedCount;
      }

      const productionScheduleDedupRows =
        isProductionScheduleDashboard && dashboard.ingestMode === 'DEDUP'
          ? resolveToMaxProductNoPerLogicalKey(
              oneYearFilteredRows.map((row) => ({
                data: row.data,
                occurredAt: row.occurredAt,
                sourceIngestRunId: row.sourceIngestRunId,
                sourceRowOrdinal: row.sourceRowOrdinal,
                sourceIngestRunStartedAt: row.sourceIngestRunStartedAt
              }))
            )
          : oneYearFilteredRows.map((row) => ({
              data: row.data,
              occurredAt: row.occurredAt,
              sourceIngestRunId: row.sourceIngestRunId,
              sourceRowOrdinal: row.sourceRowOrdinal,
              sourceIngestRunStartedAt: row.sourceIngestRunStartedAt
            }));
      const productNoDedupSkippedRows = oneYearFilteredRows.length - productionScheduleDedupRows.length;
      const preDedupSkippedRows = oneYearDroppedCount + productNoDedupSkippedRows;
      const ingestRows: Array<{
        data: NormalizedRowData;
        occurredAt: Date;
        sourceIngestRunId: string;
        sourceRowOrdinal: number;
        sourceIngestRunStartedAt: Date;
        hash?: string;
      }> =
        dashboard.ingestMode === 'DEDUP'
          ? productionScheduleDedupRows.map((row) => ({
              ...row,
              hash: isProductionScheduleDashboard
                ? calculateProductionScheduleDataHash(row.data)
                : calculateDataHash(row.data, dashboard.dedupKeyColumns),
            }))
          : productionScheduleDedupRows;

      const pieceSets = isProductionScheduleDashboard
        ? await readSessakuPieceSets(prisma, ingestRows.map((row) => ({ rowData: row.data })))
        : new Map();
      const hasSessakuPieces = [...pieceSets.values()].some((set) => set.pieces.length > 0 || set.sourcePieceSetId);

      // 取り込み方式に応じて処理
      let rowsAdded = 0;
      let rowsSkipped = 0;
      const deferredExistingRowUpdates: FkojunstDeferredRowUpdate[] = [];

      if (dashboard.ingestMode === 'APPEND') {
        // 追加モード：すべて追加
        const createRows = ingestRows.map((row) => ({
            csvDashboardId: dashboardId,
            occurredAt: row.occurredAt,
            dataHash: null,
            rowData: row.data as Prisma.InputJsonValue,
            sourceIngestRunId: row.sourceIngestRunId,
            sourceRowOrdinal: row.sourceRowOrdinal,
            sourceIngestRunStartedAt: row.sourceIngestRunStartedAt,
          }));
        if (isProductionScheduleDashboard) {
          await publishSessakuPieceSourceCreates(prisma, createRows, { collectCreatedRows: false, pieceSets });
        } else await prisma.csvDashboardRow.createMany({ data: createRows });
        rowsAdded = ingestRows.length;
        rowsSkipped = preDedupSkippedRows;
      } else {
        // 重複除去モード：今回CSV内のハッシュだけをDBに問い合わせて差分反映
        const incomingHashes = ingestRows
          .map((row) => row.hash)
          .filter((hash): hash is string => !!hash);
        const existingRows = incomingHashes.length
          ? await findCsvDashboardRowsByDataHashes({
              client: prisma.csvDashboardRow,
              csvDashboardId: dashboardId,
              dataHashes: incomingHashes,
            })
          : [];

        const diff = computeCsvDashboardDedupDiff({
          dashboardId,
          incomingRows: ingestRows,
          existingRows,
          completedValue: CsvDashboardIngestor.COMPLETED_PROGRESS_VALUE,
          options: isProductionScheduleDashboard
            ? {
                maxProductNoWins: true,
                productNoColumn: PRODUCTION_SCHEDULE_PRODUCT_NO_COLUMN,
              }
            : dashboardId === PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID
              ? {
                  firstIncomingHashWins: true,
                  refreshSourceMetadataOnDuplicate: true,
                  preferLaterUnparseableDuplicate: true
                }
              : undefined
        });
        const { rowsToCreate, updates } = diff;
        rowsAdded = diff.rowsAdded;
        rowsSkipped = diff.rowsSkipped + preDedupSkippedRows;
        const progressSyncCandidates: Array<{
          rowId: string;
          rowData: Prisma.JsonValue;
          occurredAt: Date;
        }> = [];

        if (rowsToCreate.length > 0) {
          if (isProductionScheduleDashboard) {
            progressSyncCandidates.push(...await publishSessakuPieceSourceCreates(prisma, rowsToCreate, { pieceSets }));
          } else {
            await prisma.csvDashboardRow.createMany({ data: rowsToCreate });
          }
        }

        if (updates.length > 0) {
          if (dashboardId === PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID) {
            for (const update of updates) {
              if (
                update.sourceIngestRunId == null ||
                update.sourceRowOrdinal == null ||
                update.sourceIngestRunStartedAt == null
              ) {
                continue;
              }
              deferredExistingRowUpdates.push({
                id: update.id,
                occurredAt: update.occurredAt,
                rowData: update.rowData,
                sourceIngestRunId: update.sourceIngestRunId,
                sourceRowOrdinal: update.sourceRowOrdinal,
                sourceIngestRunStartedAt: update.sourceIngestRunStartedAt,
              });
            }
          } else {
            // 大量更新に備えて分割（トランザクションでまとめて実行）
            const chunkSize = 100;
            for (let i = 0; i < updates.length; i += chunkSize) {
              const chunk = updates.slice(i, i + chunkSize);
              if (hasSessakuPieces) {
                await prisma.$transaction(async (tx) => {
                  await acquireFkojunstStatusMailCriticalTransactionLock(tx);
                  const previous = await tx.csvDashboardRow.findMany({ where: { id: { in: chunk.map((u) => u.id) } }, select: { rowData: true } });
                  const states = await prepareSessakuPiecePublication(tx, [...previous, ...chunk]);
                  for (const u of chunk) await tx.csvDashboardRow.update({ where: { id: u.id }, data: {
                    occurredAt: u.occurredAt, rowData: u.rowData, sourceIngestRunId: u.sourceIngestRunId,
                    sourceRowOrdinal: u.sourceRowOrdinal, sourceIngestRunStartedAt: u.sourceIngestRunStartedAt
                  } });
                  await publishSessakuPieceProgress(tx, states);
                }, { timeout: 30000, maxWait: 15000 });
              } else await prisma.$transaction(
                chunk.map((u) =>
                  prisma.csvDashboardRow.update({
                    where: { id: u.id },
                    data: {
                      occurredAt: u.occurredAt,
                      rowData: u.rowData,
                      sourceIngestRunId: u.sourceIngestRunId,
                      sourceRowOrdinal: u.sourceRowOrdinal,
                      sourceIngestRunStartedAt: u.sourceIngestRunStartedAt
                    },
                  })
                )
              );
            }
          }
          if (isProductionScheduleDashboard) {
            progressSyncCandidates.push(
              ...updates.map((u) => ({
                rowId: u.id,
                rowData: u.rowData as Prisma.JsonValue,
                occurredAt: u.occurredAt,
              }))
            );
          }
        }

        if (isProductionScheduleDashboard && !progressSyncEligibility.eligible) {
          logger?.info(
            {
              dashboardId,
              reason: progressSyncEligibility.reason,
              messageId,
            },
            '[CsvDashboardIngestor] Skip progress sync by eligibility policy'
          );
        }

        if (isProductionScheduleDashboard && progressSyncCandidates.length > 0) {
          await this.progressSyncFromCsvService.sync({
            candidates: progressSyncCandidates,
            hasProgressColumn: progressSyncEligibility.eligible,
          });
        }
      }

      const completedAt = new Date();
      const isFkojunstStatusMailDashboard =
        dashboardId === PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID;

      const completionTxTimeoutMs =
        isFkojunstStatusMailDashboard && deferredExistingRowUpdates.length > 0
          ? FKOJUNST_STATUS_MAIL_COMPLETION_TX_TIMEOUT_MS
          : CsvDashboardIngestor.COMPLETION_TX_TIMEOUT_MS;

      await prisma.$transaction(
        async (tx) => {
          if (isFkojunstStatusMailDashboard) {
            await acquireFkojunstStatusMailCriticalTransactionLock(tx);
            await applyFkojunstDeferredRowUpdatesInTransaction(tx, deferredExistingRowUpdates);
          }

          await tx.csvDashboardIngestRun.update({
            where: { id: ingestRun.id },
            data: {
              status: 'COMPLETED',
              rowsProcessed,
              rowsAdded,
              rowsSkipped,
              completedAt,
            },
          });

          if (csvFilePath) {
            await tx.csvDashboard.update({
              where: { id: dashboardId },
              data: { csvFilePath },
            });
          }
        },
        {
          timeout: completionTxTimeoutMs,
          maxWait: CsvDashboardIngestor.COMPLETION_TX_MAX_WAIT_MS,
        }
      );

      // FKOJUNST_Status は dataHash で取込時に重複を防ぎ、公開時にも最新行へ絞る。
      // JSON列の全件走査になる loser 削除は行わない。
      if (dashboard.ingestMode === 'DEDUP' && !isFkojunstStatusMailDashboard) {
        try {
          const keyColumns =
            isProductionScheduleDashboard && dashboard.dedupKeyColumns.length === 0
              ? [...PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS, PRODUCTION_SCHEDULE_PRODUCT_NO_COLUMN]
              : dashboard.dedupKeyColumns;
          const dedupKeys = CsvDashboardIngestor.extractDedupKeysFromRows({
            rows: productionScheduleDedupRows,
            keyColumns,
          });
          const cleanupParams = {
            csvDashboardId: dashboardId,
            keyColumns,
            keys: dedupKeys,
            // 生産スケジュール以外はキー列に式indexが無く、キー一致だけだと毎回ダッシュボード全行の
            // JSON列を走査する。dataHash は dedupKeyColumns から作るので、今回のハッシュで候補を絞る。
            dataHashes: isProductionScheduleDashboard
              ? undefined
              : ingestRows.map((row) => row.hash).filter((hash): hash is string => !!hash),
            winnerOrder: CsvDashboardIngestor.buildDedupWinnerOrder({
              isProductionScheduleDashboard,
              dashboardId
            }),
          };
          let deletedCount = 0;
          if (hasSessakuPieces) {
            for (let i = 0; i < productionScheduleDedupRows.length; i += 100) {
              const chunk = productionScheduleDedupRows.slice(i, i + 100);
              const result = await prisma.$transaction(async (tx) => {
                await acquireFkojunstStatusMailCriticalTransactionLock(tx);
                const states = await prepareSessakuPiecePublication(tx, chunk.map((row) => ({ rowData: row.data })));
                const keys = CsvDashboardIngestor.extractDedupKeysFromRows({ rows: chunk, keyColumns });
                const result = await this.dedupCleanupService.deleteDuplicateLosersForKeys({ ...cleanupParams, keys }, tx);
                await publishSessakuPieceProgress(tx, states);
                return result;
              }, { timeout: 30000, maxWait: 15000 });
              deletedCount += result.deletedCount;
            }
          } else deletedCount = (await this.dedupCleanupService.deleteDuplicateLosersForKeys(cleanupParams)).deletedCount;
          logger.info(
            { dashboardId, deletedCount, keys: dedupKeys.length, keyColumns },
            '[CsvDashboardIngestor] Dashboard duplicate loser cleanup completed'
          );
        } catch (error) {
          logger.error(
            { err: error, dashboardId },
            '[CsvDashboardIngestor] Dashboard duplicate loser cleanup failed'
          );
        }
      }

      if (isProductionScheduleDashboard && dashboard.ingestMode === 'DEDUP') {
        logger.info(
          { dashboardId },
          '[CsvDashboardIngestor] Schedule CSV disappearance completion sync disabled by policy'
        );
      }

      logger.info(
        {
          dashboardId,
          dashboardName: dashboard.name,
          rowsProcessed,
          rowsAdded,
          rowsSkipped,
        },
        '[CsvDashboardIngestor] CSV ingestion completed'
      );

      return {
        ingestRunId: ingestRun.id,
        rowsProcessed,
        rowsAdded,
        rowsSkipped,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        { err: error, dashboardId, dashboardName: dashboard.name },
        '[CsvDashboardIngestor] CSV ingestion failed'
      );

      // 取り込み実行ログを失敗として更新
      await prisma.csvDashboardIngestRun.update({
        where: { id: ingestRun.id },
        data: {
          status: 'FAILED',
          errorMessage,
          completedAt: new Date(),
        },
      });

      throw error;
    }
  }

  static extractDedupKeysFromRows(params: {
    rows: Array<{ data: NormalizedRowData }>;
    keyColumns: string[];
    maxKeys?: number;
  }): Array<Record<string, string>> {
    const keyColumns = params.keyColumns.filter((v) => v.trim().length > 0);
    if (keyColumns.length === 0) {
      return [];
    }
    const maxKeys = Math.max(1, Math.min(params.maxKeys ?? 5000, 50000));
    const seen = new Set<string>();
    const result: Array<Record<string, string>> = [];
    for (const row of params.rows) {
      const key: Record<string, string> = {};
      for (const column of keyColumns) {
        const value = row.data[column];
        key[column] =
          typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
      }
      const signature = keyColumns.map((column) => key[column]).join('\t');
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      result.push(key);
      if (result.length >= maxKeys) {
        break;
      }
    }
    return result;
  }

  static buildDedupWinnerOrder(params: {
    isProductionScheduleDashboard: boolean;
    dashboardId: string;
  }): Array<{ expression: Prisma.Sql; direction: 'ASC' | 'DESC' }> {
    if (params.isProductionScheduleDashboard) {
      return [
        {
          expression: CsvDashboardIngestor.buildProductNoOrderExpression(PRODUCTION_SCHEDULE_PRODUCT_NO_COLUMN),
          direction: 'DESC',
        },
        { expression: Prisma.sql`r."createdAt"`, direction: 'DESC' },
        { expression: Prisma.sql`r."id"`, direction: 'DESC' },
      ];
    }

    if (params.dashboardId === PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID) {
      return [
        {
          expression: Prisma.sql`
            CASE
              WHEN r."sourceIngestRunId" IS NULL THEN 1
              WHEN EXISTS (
                SELECT 1
                FROM "CsvDashboardIngestRun" ir
                WHERE ir."id" = r."sourceIngestRunId"
                  AND ir."status" = 'COMPLETED'::"ImportStatus"
                  AND ir."completedAt" IS NOT NULL
              ) THEN 1
              ELSE 0
            END
          `,
          direction: 'DESC'
        },
        { expression: Prisma.sql`r."createdAt"`, direction: 'DESC' },
        { expression: Prisma.sql`r."id"`, direction: 'DESC' },
      ];
    }

    return [
      { expression: Prisma.sql`r."createdAt"`, direction: 'DESC' },
      { expression: Prisma.sql`r."id"`, direction: 'DESC' },
    ];
  }

  private static buildProductNoOrderExpression(productNoColumn: string): Prisma.Sql {
    if (!CsvDashboardIngestor.SAFE_SQL_IDENTIFIER.test(productNoColumn)) {
      throw new Error(`Invalid ProductNo column for winner order: ${productNoColumn}`);
    }
    const escaped = productNoColumn.replace(/'/g, "''");
    return Prisma.raw(`CASE
      WHEN (r."rowData"->>'${escaped}') ~ '^[0-9]+$'
      THEN (r."rowData"->>'${escaped}')::bigint
      ELSE -1
    END`);
  }
}
