import type { BackupConfig } from '../backup/backup-config.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { ensureFkobainoCsvImportSchedule } from './fkobaino-import-schedule.policy.js';
import { ensureFkojunstCsvImportSchedule } from './fkojunst-import-schedule.policy.js';
import { ensureFkojunstStatusMailCsvImportSchedule } from './fkojunst-status-mail-import-schedule.policy.js';
import { ensureSeibanMachineNameSupplementCsvImportSchedule } from './seiban-machine-name-supplement-import-schedule.policy.js';

export function ensureProductionScheduleCsvImportSchedules(config: BackupConfig): {
  config: BackupConfig;
  repaired: boolean;
} {
  const fkojunstEnsured = ensureFkojunstCsvImportSchedule(config);
  const fkojunstStatusMailEnsured = ensureFkojunstStatusMailCsvImportSchedule(fkojunstEnsured.config);
  const seibanEnsured = ensureSeibanMachineNameSupplementCsvImportSchedule(fkojunstStatusMailEnsured.config);
  const fkobainoEnsured = ensureFkobainoCsvImportSchedule(seibanEnsured.config);
  return {
    config: fkobainoEnsured.config,
    repaired:
      fkojunstEnsured.repaired ||
      fkojunstStatusMailEnsured.repaired ||
      seibanEnsured.repaired ||
      fkobainoEnsured.repaired,
  };
}

/**
 * backup.json 読み込み後に生産日程系の固定 Gmail スケジュールを保証し、必要ならディスクへ保存する。
 */
export async function loadBackupConfigWithFkojunstImportScheduleEnsured(): Promise<{
  config: BackupConfig;
  repaired: boolean;
}> {
  const config = await BackupConfigLoader.load();
  const { config: next, repaired } = ensureProductionScheduleCsvImportSchedules(config);
  if (repaired && typeof (BackupConfigLoader as { save?: (config: BackupConfig) => Promise<void> }).save === 'function') {
    await BackupConfigLoader.save(next);
  }
  return { config: next, repaired };
}
