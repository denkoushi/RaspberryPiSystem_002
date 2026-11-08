import { createHash } from 'crypto';
import { BackupOperationType, BackupStatus } from '@prisma/client';
import { ApiError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { decryptBackupIfEncrypted, isEncryptedBackup, loadBackupEncryptionKey } from './storage/backup-encryption.js';

/** 必ず復元開始前のDBで照合する。呼び出し側の照合値は使用しない。 */
export async function validateBackupForRestore(
  raw: Buffer,
  context: { backupPath?: string } = {}
): Promise<Buffer> {
  let reason: string;
  if (isEncryptedBackup(raw)) {
    let key: Buffer | undefined;
    try {
      key = loadBackupEncryptionKey();
    } catch {
      key = undefined;
    }
    if (!key) {
      reason = 'encryption key is not configured';
    } else {
      try {
        return decryptBackupIfEncrypted(key, raw);
      } catch {
        reason = 'encrypted backup could not be authenticated';
      }
    }
  } else {
    const where = { operationType: BackupOperationType.BACKUP, status: BackupStatus.COMPLETED };
    const encrypted = await prisma.backupHistory.findFirst({
      where: { ...where, summary: { path: ['encrypted'], equals: true } },
      select: { id: true }
    });
    if (encrypted) {
      reason = 'plaintext backup after encrypted backup history';
    } else {
      const hash = createHash('sha256').update(raw).digest('hex');
      const match = await prisma.backupHistory.findFirst({ where: { ...where, hash }, select: { id: true } });
      if (match) return raw;
      reason = 'plaintext backup has no matching completed backup history';
    }
  }
  logger?.warn({ reason, backupPath: context.backupPath }, '[BackupRestore] Backup rejected');
  throw new ApiError(400, 'このバックアップは復元できません');
}
