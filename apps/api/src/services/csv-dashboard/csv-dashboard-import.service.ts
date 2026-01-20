import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { CsvDashboardIngestor } from './csv-dashboard-ingestor.js';
import { CsvDashboardStorage } from '../../lib/csv-dashboard-storage.js';
import { CsvDashboardSourceService } from './csv-dashboard-source.service.js';

export type CsvDashboardIngestResult = {
  rowsProcessed: number;
  rowsAdded: number;
  rowsSkipped: number;
};

export class CsvDashboardImportService {
  private sourceService = new CsvDashboardSourceService();
  private ingestor = new CsvDashboardIngestor();

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

      const { buffer, messageId, messageSubject } = await this.sourceService.downloadCsv({
        provider,
        storageProvider,
        gmailSubjectPattern,
      });

      const csvContent = buffer.toString('utf-8');

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

      results[dashboardId] = result;
      logger?.info({ dashboardId, result }, '[CsvDashboardImportService] CSV dashboard ingestion completed');
    }

    return results;
  }
}

