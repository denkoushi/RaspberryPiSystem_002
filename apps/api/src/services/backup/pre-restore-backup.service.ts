import { ApiError } from '../../lib/errors.js';
import { BackupTargetFactory } from './backup-target-factory.js';
import type { BackupKind } from './backup-types.js';
import type { BackupConfig } from './backup-config.js';
import { executeBackupAcrossProviders } from './backup-execution.service.js';

export async function runPreRestoreBackup(params: {
  config: BackupConfig;
  targetKind: BackupKind;
  targetSource: string;
  protocol: string;
  host: string;
}): Promise<void> {
  const { config, targetKind, targetSource, protocol, host } = params;
  const targetConfig = config.targets.find((t) => t.kind === targetKind && t.source === targetSource);
  const preBackupLabel = `pre-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const target = BackupTargetFactory.createFromConfig(config, targetKind, targetSource, { label: preBackupLabel });

  const { results } = await executeBackupAcrossProviders({
    config,
    targetConfig,
    target,
    targetKind,
    targetSource,
    protocol,
    host,
    label: preBackupLabel,
  });

  const allFailed = results.every((r) => !r.success);
  if (allFailed) {
    const errorMessages = results.map((r) => `${r.provider}: ${r.error || 'Unknown error'}`).join('; ');
    throw new ApiError(500, `Pre-backup failed on all providers: ${errorMessages}`);
  }
}
