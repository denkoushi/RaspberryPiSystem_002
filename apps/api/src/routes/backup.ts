import type { FastifyInstance } from 'fastify';
import { registerBackupHistoryRoutes } from './backup/history.js';
import { registerBackupConfigReadRoutes } from './backup/config-read.js';
import { registerBackupConfigWriteRoutes } from './backup/config-write.js';
import { registerBackupOAuthRoutes } from './backup/oauth.js';
import { registerBackupPurgeRoutes } from './backup/purge.js';
import { registerBackupRestoreDropboxRoutes } from './backup/restore-dropbox.js';
import { registerBackupRestoreRoutes } from './backup/restore.js';
import { registerBackupStorageMaintenanceRoutes } from './backup/storage-maintenance.js';
import { registerBackupExecutionRoutes } from './backup/execution.js';

/**
 * バックアップルートを登録
 */
export async function registerBackupRoutes(app: FastifyInstance): Promise<void> {
  await registerBackupExecutionRoutes(app);

  await registerBackupHistoryRoutes(app);
  await registerBackupConfigReadRoutes(app);
  await registerBackupConfigWriteRoutes(app);
  await registerBackupOAuthRoutes(app);

  await registerBackupStorageMaintenanceRoutes(app);
  await registerBackupRestoreRoutes(app);
  await registerBackupRestoreDropboxRoutes(app);

  await registerBackupPurgeRoutes(app);
}
