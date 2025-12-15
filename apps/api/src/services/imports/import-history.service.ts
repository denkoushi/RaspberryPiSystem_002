// 注意: マイグレーション実行後に有効化（Prisma ClientにcsvImportHistoryモデルが追加されるまで）
// import { prisma } from '../../lib/prisma.js';
// import { ImportStatus } from '@prisma/client';

/* eslint-disable @typescript-eslint/no-unused-vars */

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
  async createHistory(_params: {
    scheduleId: string;
    scheduleName?: string;
    employeesPath?: string;
    itemsPath?: string;
  }): Promise<string> {
    // マイグレーション実行後に有効化
    // const history = await prisma.csvImportHistory.create({
    //   data: {
    //     scheduleId: params.scheduleId,
    //     scheduleName: params.scheduleName,
    //     employeesPath: params.employeesPath,
    //     itemsPath: params.itemsPath,
    //     status: ImportStatus.PROCESSING,
    //     startedAt: new Date()
    //   }
    // });
    // return history.id;
    throw new Error('ImportHistoryService is disabled until migration is executed');
  }

  /**
   * インポート履歴を完了として更新
   */
  async completeHistory(
    _historyId: string,
    _summary: ImportSummary
  ): Promise<void> {
    // マイグレーション実行後に有効化
    // await prisma.csvImportHistory.update({
    //   where: { id: historyId },
    //   data: {
    //     status: ImportStatus.COMPLETED,
    //     summary: summary as Record<string, unknown>,
    //     completedAt: new Date()
    //   }
    // });
  }

  /**
   * インポート履歴を失敗として更新
   */
  async failHistory(
    _historyId: string,
    _errorMessage: string
  ): Promise<void> {
    // マイグレーション実行後に有効化
    // await prisma.csvImportHistory.update({
    //   where: { id: historyId },
    //   data: {
    //     status: ImportStatus.FAILED,
    //     errorMessage,
    //     completedAt: new Date()
    //   }
    // });
  }

  /**
   * インポート履歴を取得
   */
  async getHistory(_historyId: string) {
    // マイグレーション実行後に有効化
    // return prisma.csvImportHistory.findUnique({
    //   where: { id: historyId }
    // });
    return null;
  }

  /**
   * スケジュールIDでインポート履歴を取得（最新順）
   */
  async getHistoryByScheduleId(
    _scheduleId: string,
    _limit: number = 100
  ) {
    // マイグレーション実行後に有効化
    // return prisma.csvImportHistory.findMany({
    //   where: { scheduleId },
    //   orderBy: { startedAt: 'desc' },
    //   take: limit
    // });
    return [];
  }

  /**
   * すべてのインポート履歴を取得（最新順）
   */
  async getAllHistory(_limit: number = 100) {
    // マイグレーション実行後に有効化
    // return prisma.csvImportHistory.findMany({
    //   orderBy: { startedAt: 'desc' },
    //   take: limit
    // });
    return [];
  }

  /**
   * 失敗したインポート履歴を取得（最新順）
   */
  async getFailedHistory(_limit: number = 100) {
    // マイグレーション実行後に有効化
    // return prisma.csvImportHistory.findMany({
    //   where: { status: ImportStatus.FAILED },
    //   orderBy: { startedAt: 'desc' },
    //   take: limit
    // });
    return [];
  }

  /**
   * 古い履歴を削除（保持期間を超えた履歴）
   */
  async cleanupOldHistory(_retentionDays: number = 90): Promise<number> {
    // マイグレーション実行後に有効化
    // const retentionDate = new Date();
    // retentionDate.setDate(retentionDate.getDate() - retentionDays);
    // 
    // const result = await prisma.csvImportHistory.deleteMany({
    //   where: {
    //     completedAt: {
    //       lt: retentionDate
    //     }
    //   }
    // });
    // 
    // return result.count;
    return 0;
  }
}
