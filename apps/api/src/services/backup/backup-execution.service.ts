import { BackupOperationType } from '@prisma/client';

import type { BackupConfig } from './backup-config.js';
import type { BackupTarget } from './backup-target.interface.js';
import type { BackupKind } from './backup-types.js';
import { BackupService } from './backup.service.js';
import { BackupHistoryService } from './backup-history.service.js';
import { StorageProviderFactory } from './storage-provider-factory.js';

export type BackupProvider = 'local' | 'dropbox';

export type BackupExecutionResult = {
  provider: BackupProvider;
  success: boolean;
  path?: string;
  sizeBytes?: number;
  error?: string;
};

type ExecuteBackupAcrossProvidersParams = {
  config: BackupConfig;
  targetConfig?: BackupConfig['targets'][number];
  target: BackupTarget;
  targetKind: BackupKind;
  targetSource: string;
  protocol: string;
  host: string;
  onTokenUpdate?: (newToken: string) => Promise<void>;
  label?: string;
  includeDurationInSummary?: boolean;
  includeProviderInSummary?: boolean;
};

export function resolveBackupProviders(params: {
  config: BackupConfig;
  targetConfig?: BackupConfig['targets'][number];
}): BackupProvider[] {
  const { config, targetConfig } = params;
  const providers: BackupProvider[] = [];

  if (targetConfig?.storage?.providers && targetConfig.storage.providers.length > 0) {
    providers.push(
      ...targetConfig.storage.providers.filter(
        (p): p is BackupProvider => p === 'local' || p === 'dropbox'
      )
    );
  } else if (
    targetConfig?.storage?.provider &&
    (targetConfig.storage.provider === 'local' || targetConfig.storage.provider === 'dropbox')
  ) {
    providers.push(targetConfig.storage.provider);
  } else if (config.storage.provider === 'local' || config.storage.provider === 'dropbox') {
    providers.push(config.storage.provider);
  } else {
    providers.push('local');
  }

  return providers;
}

export async function executeBackupAcrossProviders(
  params: ExecuteBackupAcrossProvidersParams
): Promise<{ results: BackupExecutionResult[] }> {
  const {
    config,
    targetConfig,
    target,
    targetKind,
    targetSource,
    protocol,
    host,
    onTokenUpdate,
    label,
    includeDurationInSummary = false,
    includeProviderInSummary = false,
  } = params;

  const providers = resolveBackupProviders({ config, targetConfig });
  const historyService = new BackupHistoryService();
  const results: BackupExecutionResult[] = [];

  for (const requestedProvider of providers) {
    try {
      const targetWithProvider = targetConfig
        ? {
            ...targetConfig,
            storage: { provider: requestedProvider },
          }
        : undefined;
      const providerResult = targetWithProvider
        ? await StorageProviderFactory.createFromTarget(
            config,
            targetWithProvider,
            protocol,
            host,
            onTokenUpdate,
            true
          )
        : await StorageProviderFactory.createFromConfig(config, protocol, host, onTokenUpdate, true);
      const actualProvider = providerResult.provider;
      const safeProvider: BackupProvider =
        actualProvider === 'local' || actualProvider === 'dropbox' ? actualProvider : 'local';
      const storageProvider = providerResult.storageProvider;
      const backupService = new BackupService(storageProvider);

      const historyId = await historyService.createHistory({
        operationType: BackupOperationType.BACKUP,
        targetKind,
        targetSource,
        storageProvider: safeProvider,
      });

      try {
        const backupStart = Date.now();
        const result = await backupService.backup(target, { label });
        const durationMs = Date.now() - backupStart;

        if (result.success) {
          results.push({
            provider: safeProvider,
            success: true,
            path: result.path,
            sizeBytes: result.sizeBytes,
          });
          await historyService.completeHistory(historyId, {
            targetKind,
            targetSource,
            sizeBytes: result.sizeBytes,
            path: result.path,
            ...(includeDurationInSummary ? { durationMs } : {}),
            ...(includeProviderInSummary ? { provider: safeProvider } : {}),
          });
        } else {
          results.push({ provider: safeProvider, success: false, error: result.error });
          await historyService.failHistory(historyId, result.error || 'Unknown error');
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        results.push({ provider: safeProvider, success: false, error: errorMessage });
        await historyService.failHistory(historyId, errorMessage);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      results.push({ provider: requestedProvider, success: false, error: errorMessage });
    }
  }

  return { results };
}
