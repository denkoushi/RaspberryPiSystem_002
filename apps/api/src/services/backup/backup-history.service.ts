import { prisma } from '../../lib/prisma.js';
import { BackupOperationType, BackupStatus, Prisma } from '@prisma/client';

export interface BackupSummary {
  targetKind?: string;
  targetSource?: string;
  sizeBytes?: number;
  hash?: string;
  path?: string;
}

/**
 * バックアップ・リストア履歴サービス
 */
export class BackupHistoryService {
  /**
   * バックアップ履歴を作成
   */
  async createHistory(params: {
    operationType: BackupOperationType;
    targetKind: string;
    targetSource: string;
    backupPath?: string;
    storageProvider?: string;
    sizeBytes?: number;
    hash?: string;
  }): Promise<string> {
    const history = await prisma.backupHistory.create({
      data: {
        operationType: params.operationType,
        targetKind: params.targetKind,
        targetSource: params.targetSource,
        backupPath: params.backupPath,
        storageProvider: params.storageProvider || 'local',
        sizeBytes: params.sizeBytes,
        hash: params.hash,
        status: BackupStatus.PROCESSING,
        startedAt: new Date()
      }
    });
    return history.id;
  }

  /**
   * バックアップ履歴を完了として更新
   */
  async completeHistory(
    historyId: string,
    summary?: BackupSummary
  ): Promise<void> {
    await prisma.backupHistory.update({
      where: { id: historyId },
      data: {
        status: BackupStatus.COMPLETED,
        completedAt: new Date(),
        summary: summary ? (summary as Prisma.JsonObject) : undefined,
        sizeBytes: summary?.sizeBytes,
        hash: summary?.hash
      }
    });
  }

  /**
   * バックアップ履歴を失敗として更新
   */
  async failHistory(
    historyId: string,
    errorMessage: string
  ): Promise<void> {
    await prisma.backupHistory.update({
      where: { id: historyId },
      data: {
        status: BackupStatus.FAILED,
        completedAt: new Date(),
        errorMessage
      }
    });
  }

  /**
   * バックアップ履歴を取得（フィルタ・ページネーション対応）
   */
  async getHistoryWithFilter(params: {
    operationType?: BackupOperationType;
    targetKind?: string;
    status?: BackupStatus;
    startDate?: Date;
    endDate?: Date;
    offset?: number;
    limit?: number;
  }): Promise<{
    history: Array<{
      id: string;
      operationType: BackupOperationType;
      targetKind: string;
      targetSource: string;
      backupPath: string | null;
      storageProvider: string;
      status: BackupStatus;
      sizeBytes: number | null;
      hash: string | null;
      summary: Prisma.JsonValue | null;
      errorMessage: string | null;
      startedAt: Date;
      completedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }>;
    total: number;
  }> {
    const where: Prisma.BackupHistoryWhereInput = {};

    if (params.operationType) {
      where.operationType = params.operationType;
    }

    if (params.targetKind) {
      where.targetKind = params.targetKind;
    }

    if (params.status) {
      where.status = params.status;
    }

    if (params.startDate || params.endDate) {
      where.startedAt = {};
      if (params.startDate) {
        where.startedAt.gte = params.startDate;
      }
      if (params.endDate) {
        where.startedAt.lte = params.endDate;
      }
    }

    const [history, total] = await Promise.all([
      prisma.backupHistory.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: params.offset ?? 0,
        take: params.limit ?? 100
      }),
      prisma.backupHistory.count({ where })
    ]);

    return { history, total };
  }

  /**
   * バックアップ履歴の詳細を取得
   */
  async getHistoryById(historyId: string) {
    const history = await prisma.backupHistory.findUnique({
      where: { id: historyId }
    });

    if (!history) {
      throw new Error(`Backup history not found: ${historyId}`);
    }

    return history;
  }

  /**
   * 古い履歴をクリーンアップ
   */
  async cleanupOldHistory(retentionDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await prisma.backupHistory.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate
        }
      }
    });

    return result.count;
  }

  /**
   * 最大件数を超える履歴のファイルステータスをDELETEDに更新（古いものから）
   */
  async markExcessHistoryAsDeleted(params: {
    targetKind: string;
    targetSource: string;
    maxCount: number;
  }): Promise<number> {
    // 対象の履歴を取得（新しい順、ファイルが存在するもののみ）
    const histories = await prisma.backupHistory.findMany({
      where: {
        targetKind: params.targetKind,
        targetSource: params.targetSource,
        status: BackupStatus.COMPLETED,
        fileStatus: 'EXISTS'
      },
      orderBy: { startedAt: 'desc' },
      select: { id: true }
    });

    // 最大件数を超えた分のファイルステータスをDELETEDに更新
    if (histories.length > params.maxCount) {
      const idsToUpdate = histories.slice(params.maxCount).map(h => h.id);
      const result = await prisma.backupHistory.updateMany({
        where: {
          id: { in: idsToUpdate }
        },
        data: {
          fileStatus: 'DELETED'
        }
      });
      return result.count;
    }

    return 0;
  }
}
