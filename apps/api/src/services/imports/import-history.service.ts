import { prisma } from '../../lib/prisma.js';
import { ImportStatus } from '@prisma/client';

export interface ImportSummary {
  employees?: {
    processed: number;
    created: number;
    updated: number;
  };
  items?: {
    processed: number;
    created: number;
    updated: number;
  };
}

/**
 * CSVインポート履歴サービス
 */
export class ImportHistoryService {
  /**
   * インポート履歴を作成
   */
  async createHistory(params: {
    scheduleId: string;
    scheduleName?: string;
    employeesPath?: string;
    itemsPath?: string;
  }): Promise<string> {
    const history = await prisma.csvImportHistory.create({
      data: {
        scheduleId: params.scheduleId,
        scheduleName: params.scheduleName,
        employeesPath: params.employeesPath,
        itemsPath: params.itemsPath,
        status: ImportStatus.PROCESSING,
        startedAt: new Date()
      }
    });
    return history.id;
  }

  /**
   * インポート履歴を完了として更新
   */
  async completeHistory(
    historyId: string,
    summary: ImportSummary
  ): Promise<void> {
    await prisma.csvImportHistory.update({
      where: { id: historyId },
      data: {
        status: ImportStatus.COMPLETED,
        summary: summary as Record<string, unknown>,
        completedAt: new Date()
      }
    });
  }

  /**
   * インポート履歴を失敗として更新
   */
  async failHistory(
    historyId: string,
    errorMessage: string
  ): Promise<void> {
    await prisma.csvImportHistory.update({
      where: { id: historyId },
      data: {
        status: ImportStatus.FAILED,
        errorMessage,
        completedAt: new Date()
      }
    });
  }

  /**
   * インポート履歴を取得
   */
  async getHistory(historyId: string) {
    return prisma.csvImportHistory.findUnique({
      where: { id: historyId }
    });
  }

  /**
   * スケジュールIDでインポート履歴を取得（最新順）
   */
  async getHistoryByScheduleId(
    scheduleId: string,
    limit: number = 100
  ) {
    return prisma.csvImportHistory.findMany({
      where: { scheduleId },
      orderBy: { startedAt: 'desc' },
      take: limit
    });
  }

  /**
   * すべてのインポート履歴を取得（最新順）
   */
  async getAllHistory(limit: number = 100) {
    return prisma.csvImportHistory.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit
    });
  }

  /**
   * 失敗したインポート履歴を取得（最新順）
   */
  async getFailedHistory(limit: number = 100) {
    return prisma.csvImportHistory.findMany({
      where: { status: ImportStatus.FAILED },
      orderBy: { startedAt: 'desc' },
      take: limit
    });
  }

  /**
   * 古い履歴を削除（保持期間を超えた履歴）
   */
  async cleanupOldHistory(retentionDays: number = 90): Promise<number> {
    const retentionDate = new Date();
    retentionDate.setDate(retentionDate.getDate() - retentionDays);
    
    const result = await prisma.csvImportHistory.deleteMany({
      where: {
        completedAt: {
          lt: retentionDate
        }
      }
    });
    
    return result.count;
  }
}
