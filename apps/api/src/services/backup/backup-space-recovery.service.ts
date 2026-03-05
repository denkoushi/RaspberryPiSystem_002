import type { BackupTarget } from './backup-target.interface.js';
import type { BackupResult, BackupOptions } from './backup-types.js';
import { logger } from '../../lib/logger.js';
import { BackupHistoryService } from './backup-history.service.js';
import { BackupService } from './backup.service.js';

const INSUFFICIENT_SPACE_PATTERNS = ['insufficient_space', 'insufficient space', 'quota'];

export function isDropboxInsufficientSpaceErrorMessage(message?: string): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return INSUFFICIENT_SPACE_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export async function recoverAndRetryBackupOnInsufficientSpace(params: {
  backupService: BackupService;
  target: BackupTarget;
  backupOptions?: BackupOptions;
  errorMessage?: string;
  maxDeleteCount?: number;
}): Promise<{ recovered: boolean; result?: BackupResult; deletedPaths: string[] }> {
  const {
    backupService,
    target,
    backupOptions,
    errorMessage,
    maxDeleteCount = 100
  } = params;

  if (!isDropboxInsufficientSpaceErrorMessage(errorMessage)) {
    return { recovered: false, deletedPaths: [] };
  }

  const targetKind = target.info.type;
  const sourceForFilter = target.info.source ?? '';
  const prefix = targetKind;

  const backups = await backupService.listBackups({ prefix });
  const matchesSource = (p: string | null | undefined): boolean => {
    if (!sourceForFilter) return true;
    if (!p) return false;
    if (targetKind === 'database') {
      return p.endsWith(`/${sourceForFilter}.sql.gz`) || p.endsWith(`/${sourceForFilter}.sql`);
    }
    if (targetKind === 'csv') {
      return p.endsWith(`/${sourceForFilter}.csv`);
    }
    return p.endsWith(`/${sourceForFilter}`);
  };
  const targetBackups = backups
    .filter((entry) => !!entry.path && matchesSource(entry.path))
    .sort((a, b) => {
      const aTs = (a.modifiedAt ?? a.timestamp).getTime();
      const bTs = (b.modifiedAt ?? b.timestamp).getTime();
      return aTs - bTs;
    });

  if (targetBackups.length === 0) {
    return { recovered: false, deletedPaths: [] };
  }

  const historyService = new BackupHistoryService();
  const deletedPaths: string[] = [];
  const toDelete = targetBackups.slice(0, Math.max(1, maxDeleteCount));

  for (const entry of toDelete) {
    if (!entry.path) continue;
    try {
      await backupService.deleteBackup(entry.path);
      deletedPaths.push(entry.path);
      await historyService.markHistoryAsDeletedByPath(entry.path).catch(() => {});
      logger?.warn({ path: entry.path }, '[BackupSpaceRecovery] Deleted oldest backup to recover space');
    } catch (error) {
      logger?.error({ err: error, path: entry.path }, '[BackupSpaceRecovery] Failed to delete backup during space recovery');
      continue;
    }

    const retried = await backupService.backup(target, backupOptions);
    if (retried.success) {
      logger?.info(
        { deletedCount: deletedPaths.length, path: retried.path },
        '[BackupSpaceRecovery] Backup retried successfully after deleting old backups'
      );
      return { recovered: true, result: retried, deletedPaths };
    }
  }

  return { recovered: false, deletedPaths };
}
