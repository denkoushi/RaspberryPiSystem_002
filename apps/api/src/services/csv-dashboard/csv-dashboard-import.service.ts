import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { CsvDashboardIngestor } from './csv-dashboard-ingestor.js';
import { CsvDashboardStorage } from '../../lib/csv-dashboard-storage.js';
import { CsvDashboardSourceService } from './csv-dashboard-source.service.js';
import { NoMatchingMessageError } from '../backup/storage/gmail-storage.provider.js';
import { MeasuringInstrumentLoanEventService } from '../measuring-instruments/measuring-instrument-loan-event.service.js';

export type CsvDashboardIngestResult = {
  rowsProcessed: number;
  rowsAdded: number;
  rowsSkipped: number;
};

export class CsvDashboardImportService {
  private sourceService = new CsvDashboardSourceService();
  private ingestor = new CsvDashboardIngestor();
  private measuringInstrumentLoanEventService = new MeasuringInstrumentLoanEventService();

  private static readonly MEASURING_INSTRUMENT_LOANS_DASHBOARD_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  private static canPostProcessGmail(storageProvider: StorageProvider): storageProvider is StorageProvider & {
    markAsRead: (messageId: string) => Promise<void>;
    trashMessage: (messageId: string) => Promise<void>;
  } {
    const provider = storageProvider as StorageProvider & {
      markAsRead?: (messageId: string) => Promise<void>;
      trashMessage?: (messageId: string) => Promise<void>;
    };
    return typeof provider.markAsRead === 'function' && typeof provider.trashMessage === 'function';
  }

  /**
   * csvDashboardsターゲット群を取り込み、dashboardId -> 結果 を返す。
   * - ダッシュボード不存在/無効/gmailSubjectPattern未設定は安全側でスキップ（ログのみ）
   */
  async ingestTargets(params: {
    provider: string;
    storageProvider: StorageProvider;
    dashboardIds: string[];
  }): Promise<Record<string, CsvDashboardIngestResult>> {
    const { provider, storageProvider, dashboardIds } = params;
    const results: Record<string, CsvDashboardIngestResult> = {};

    for (const dashboardId of dashboardIds) {
      const dashboard = await prisma.csvDashboard.findUnique({ where: { id: dashboardId } });

      if (!dashboard) {
        logger?.warn({ dashboardId }, '[CsvDashboardImportService] CSV dashboard not found, skipping');
        continue;
      }

      if (!dashboard.enabled) {
        logger?.warn({ dashboardId }, '[CsvDashboardImportService] CSV dashboard is disabled, skipping');
        continue;
      }

      const gmailSubjectPattern = (dashboard as unknown as { gmailSubjectPattern?: string | null }).gmailSubjectPattern;
      if (!gmailSubjectPattern || gmailSubjectPattern.trim().length === 0) {
        logger?.warn(
          { dashboardId, provider },
          '[CsvDashboardImportService] CSV dashboard gmailSubjectPattern is not set, skipping'
        );
        continue;
      }

      logger?.info(
        { dashboardId, gmailSubjectPattern, provider },
        '[CsvDashboardImportService] Processing CSV dashboard ingestion'
      );

      let bufferResults: Array<{ buffer: Buffer; messageId?: string; messageSubject?: string }> = [];
      try {
        bufferResults = await this.sourceService.downloadCsv({
          provider,
          storageProvider,
          gmailSubjectPattern,
        });
      } catch (error) {
        if (error instanceof NoMatchingMessageError) {
          logger?.info(
            { dashboardId, gmailSubjectPattern, provider },
            '[CsvDashboardImportService] No matching Gmail message, skipping'
          );
          continue;
        }
        throw error;
      }

      let totalProcessed = 0;
      let totalAdded = 0;
      let totalSkipped = 0;
      let lastError: unknown | null = null;

      for (const bufferResult of bufferResults) {
        const { buffer, messageId, messageSubject } = bufferResult;
        const csvContent = buffer.toString('utf-8');

        try {
          // CSVファイルを原本として保存
          const csvFilePath = await CsvDashboardStorage.saveRawCsv(dashboardId, buffer, messageId);

          // 取り込み処理を実行
          const result = await this.ingestor.ingestFromGmail(
            dashboardId,
            csvContent,
            messageId,
            messageSubject,
            csvFilePath
          );

          totalProcessed += result.rowsProcessed;
          totalAdded += result.rowsAdded;
          totalSkipped += result.rowsSkipped;

          // 計測機器持出返却のイベント投影
          if (dashboardId === CsvDashboardImportService.MEASURING_INSTRUMENT_LOANS_DASHBOARD_ID) {
            await this.measuringInstrumentLoanEventService.projectEventsFromCsv({
              dashboardId,
              csvContent,
              messageId,
              messageSubject,
            });
          }

          // Gmail後処理（成功時のみ）
          if (provider === 'gmail' && messageId && CsvDashboardImportService.canPostProcessGmail(storageProvider)) {
            await storageProvider.markAsRead(messageId);
            await storageProvider.trashMessage(messageId);
          }
        } catch (error) {
          lastError = error;
          logger?.error(
            { err: error, dashboardId, messageId },
            '[CsvDashboardImportService] CSV dashboard ingestion failed for message'
          );
          continue;
        }
      }

      if (totalProcessed === 0 && lastError) {
        throw lastError;
      }

      const aggregatedResult = {
        rowsProcessed: totalProcessed,
        rowsAdded: totalAdded,
        rowsSkipped: totalSkipped,
      };
      results[dashboardId] = aggregatedResult;
      logger?.info({ dashboardId, result: aggregatedResult }, '[CsvDashboardImportService] CSV dashboard ingestion completed');
    }

    return results;
  }
}

