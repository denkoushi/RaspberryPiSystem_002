import crypto from 'crypto';
import { AlertChannel, AlertDeliveryStatus, AlertSeverity } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import type { BackupKind } from './backup-types.js';
import type { BackupProvider } from './backup-execution.service.js';

export type BackupFailureDetails = {
  targetKind: BackupKind;
  failureType: 'execution-failed' | 'all-providers-failed' | 'partial-providers-failed';
  providerCount?: number;
  failedProviderCount?: number;
  failedProviders?: BackupProvider[];
};

export async function notifyScheduledBackupFailure(
  targetSource: string,
  details: BackupFailureDetails
): Promise<void> {
  const type = 'backup-scheduled-failed';
  const messages = {
    'execution-failed': '日次バックアップのスケジュール実行が失敗しました。',
    'all-providers-failed': '日次バックアップが全保存先で失敗しました。',
    'partial-providers-failed': '日次バックアップが一部の保存先で失敗しました。'
  };
  // 同じ種別の別対象を区別するが、source（パス・接続情報）は保存・配送しない。
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify([type, targetSource, details]))
    .digest('hex');

  try {
    await prisma.$transaction(async (tx) => {
      const alert = await tx.alert.create({
        data: {
          id: crypto.randomUUID(),
          type,
          severity: details.failureType === 'partial-providers-failed' ? AlertSeverity.WARNING : AlertSeverity.ERROR,
          message: messages[details.failureType],
          details,
          fingerprint,
          timestamp: new Date(),
          acknowledged: false
        }
      });
      await tx.alertDelivery.create({
        data: {
          alertId: alert.id,
          channel: AlertChannel.SLACK,
          routeKey: 'ops',
          status: AlertDeliveryStatus.PENDING,
          attemptCount: 0
        }
      });
    });
  } catch {
    logger?.warn('[BackupScheduler] Failed to enqueue backup failure alert');
  }
}
