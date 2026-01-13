import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger.js';

const getStorageBaseDir = () =>
  process.env.CSV_DASHBOARD_STORAGE_DIR ||
  (process.env.NODE_ENV === 'test' ? '/tmp/test-csv-dashboard-storage' : '/opt/RaspberryPiSystem_002/storage');

/**
 * CSVダッシュボード用のストレージ管理
 */
export class CsvDashboardStorage {
  private static readonly BASE_DIR = getStorageBaseDir();
  private static readonly CSV_DASHBOARDS_DIR = path.join(this.BASE_DIR, 'csv-dashboards');

  /**
   * ストレージディレクトリを初期化
   */
  static async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.CSV_DASHBOARDS_DIR, { recursive: true });
      logger?.info({ dir: this.CSV_DASHBOARDS_DIR }, '[CsvDashboardStorage] Directory initialized');
    } catch (error) {
      logger?.error({ err: error, dir: this.CSV_DASHBOARDS_DIR }, '[CsvDashboardStorage] Failed to initialize directory');
      throw error;
    }
  }

  /**
   * CSVファイルを保存（原本保存）
   * パス形式: storage/csv-dashboards/{dashboardId}/raw/{YYYY}/{MM}/{timestamp}-{messageId}.csv
   */
  static async saveRawCsv(
    dashboardId: string,
    csvContent: Buffer,
    messageId?: string
  ): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const timestamp = now.toISOString().replace(/[:.]/g, '-');
    const messageIdSuffix = messageId ? `-${messageId}` : '';
    const filename = `${timestamp}${messageIdSuffix}.csv`;

    const dashboardDir = path.join(this.CSV_DASHBOARDS_DIR, dashboardId);
    const rawDir = path.join(dashboardDir, 'raw', String(year), month);

    // ディレクトリを作成
    await fs.mkdir(rawDir, { recursive: true });

    const filePath = path.join(rawDir, filename);
    await fs.writeFile(filePath, csvContent, 'utf-8');

    logger?.info(
      { dashboardId, filePath, size: csvContent.length },
      '[CsvDashboardStorage] CSV file saved'
    );

    return filePath;
  }

  /**
   * 古いCSVファイルを削除（レテンション管理）
   * 前年(2025)は保持、前々年(2024)は削除、当年の前月分を月次で削除
   */
  static async cleanupOldFiles(): Promise<{ deletedCount: number; deletedSize: number }> {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const previousYear = currentYear - 1; // 前年
    const twoYearsAgo = currentYear - 2; // 前々年

    let deletedCount = 0;
    let deletedSize = 0;

    try {
      // 各ダッシュボードディレクトリを走査
      const dashboardDirs = await fs.readdir(this.CSV_DASHBOARDS_DIR, { withFileTypes: true });
      
      for (const dashboardDir of dashboardDirs) {
        if (!dashboardDir.isDirectory()) continue;

        const rawDir = path.join(this.CSV_DASHBOARDS_DIR, dashboardDir.name, 'raw');
        
        try {
          const yearDirs = await fs.readdir(rawDir, { withFileTypes: true });
          
          for (const yearDir of yearDirs) {
            if (!yearDir.isDirectory()) continue;
            
            const year = parseInt(yearDir.name, 10);
            if (isNaN(year)) continue;

            const yearPath = path.join(rawDir, yearDir.name);

            // 前々年(例: 2024)は削除（前年は保持）
            if (year <= twoYearsAgo) {
              await fs.rm(yearPath, { recursive: true, force: true });
              logger?.info({ year, path: yearPath }, '[CsvDashboardStorage] Deleted old year directory');
              continue;
            }

            // 前年は保持（何もしない）
            if (year === previousYear) {
              continue;
            }

            // 当年の場合、当月より前（= 過去月）を削除
            if (year === currentYear) {
              const monthDirs = await fs.readdir(yearPath, { withFileTypes: true });
              
              for (const monthDir of monthDirs) {
                if (!monthDir.isDirectory()) continue;
                
                const month = parseInt(monthDir.name, 10);
                if (isNaN(month)) continue;

                // 例: 2月(=currentMonth=2) になったら 1月データを削除、3月なら 1月/2月を削除
                // 前年(=previousYear)は保持するため、前年12月は削除しない
                if (month < currentMonth) {
                  const monthPath = path.join(yearPath, monthDir.name);
                  const files = await fs.readdir(monthPath);
                  
                  for (const file of files) {
                    const filePath = path.join(monthPath, file);
                    const stats = await fs.stat(filePath);
                    await fs.unlink(filePath);
                    deletedCount++;
                    deletedSize += stats.size;
                  }
                  
                  await fs.rmdir(monthPath);
                  logger?.info({ year, month, path: monthPath }, '[CsvDashboardStorage] Deleted old month directory');
                }
              }
            }
          }
        } catch (error) {
          // ディレクトリが存在しない場合はスキップ
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            logger?.warn({ err: error, path: rawDir }, '[CsvDashboardStorage] Failed to cleanup directory');
          }
        }
      }

      logger?.info(
        { deletedCount, deletedSize },
        '[CsvDashboardStorage] Cleanup completed'
      );

      return { deletedCount, deletedSize };
    } catch (error) {
      logger?.error({ err: error }, '[CsvDashboardStorage] Cleanup failed');
      throw error;
    }
  }
}
