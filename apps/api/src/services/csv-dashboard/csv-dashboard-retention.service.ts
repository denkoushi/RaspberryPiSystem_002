import { CsvDashboardService } from './csv-dashboard.service.js';
import { CsvDashboardStorage } from '../../lib/csv-dashboard-storage.js';

export type CsvDashboardRetentionResult = {
  deletedRows: number;
  deletedIngestRuns: number;
  deletedFiles: number;
  deletedSize: number;
};

/**
 * CSVダッシュボードのレテンション削除を集約するサービス。
 * - DB上の古いデータ削除（rows / ingestRuns）
 * - 原本CSVファイルの削除
 */
export class CsvDashboardRetentionService {
  constructor(
    private readonly csvDashboardService = new CsvDashboardService()
  ) {}

  async cleanup(): Promise<CsvDashboardRetentionResult> {
    const { deletedRows, deletedIngestRuns } = await this.csvDashboardService.cleanupOldData();
    const { deletedCount, deletedSize } = await CsvDashboardStorage.cleanupOldFiles();

    return {
      deletedRows,
      deletedIngestRuns,
      deletedFiles: deletedCount,
      deletedSize,
    };
  }
}

