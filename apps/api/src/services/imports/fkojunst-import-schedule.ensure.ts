import type { BackupConfig } from '../backup/backup-config.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { ensureFkojunstCsvImportSchedule } from './fkojunst-import-schedule.policy.js';

/**
 * backup.json 読み込み後に FKOJUNST 用 Gmail スケジュールを保証し、必要ならディスクへ保存する。
 */
export async function loadBackupConfigWithFkojunstImportScheduleEnsured(): Promise<{
  config: BackupConfig;
  repaired: boolean;
}> {
  const config = await BackupConfigLoader.load();
  const { config: next, repaired } = ensureFkojunstCsvImportSchedule(config);
  if (repaired && typeof (BackupConfigLoader as { save?: (config: BackupConfig) => Promise<void> }).save === 'function') {
    await BackupConfigLoader.save(next);
  }
  return { config: next, repaired };
}
