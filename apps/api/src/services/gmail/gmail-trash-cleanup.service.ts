import type { BackupConfig } from '../backup/backup-config.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import { StorageProviderFactory } from '../backup/storage-provider-factory.js';
import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';
import type { GmailTrashCleanupResult } from '../backup/gmail-api-client.js';
import { logger } from '../../lib/logger.js';

type GmailTrashCleanupCapableProvider = {
  cleanupProcessedTrash: (params?: {
    processedLabelName?: string;
  }) => Promise<GmailTrashCleanupResult>;
};

function hasGmailTrashCleanup(
  provider: StorageProvider
): provider is StorageProvider & GmailTrashCleanupCapableProvider {
  return (
    typeof (provider as unknown as Partial<GmailTrashCleanupCapableProvider>).cleanupProcessedTrash ===
    'function'
  );
}

function hasRequiredGmailSettings(config: BackupConfig): boolean {
  const gmailOpts = config.storage.options?.gmail as
    | { accessToken?: string; refreshToken?: string; clientId?: string; clientSecret?: string }
    | undefined;
  const clientId = gmailOpts?.clientId ?? (config.storage.options?.clientId as string | undefined);
  const clientSecret = gmailOpts?.clientSecret ?? (config.storage.options?.clientSecret as string | undefined);
  const accessToken =
    gmailOpts?.accessToken ??
    (config.storage.options?.gmailAccessToken as string | undefined) ??
    (config.storage.options?.accessToken as string | undefined);
  const refreshToken =
    gmailOpts?.refreshToken ??
    (config.storage.options?.gmailRefreshToken as string | undefined) ??
    (config.storage.options?.refreshToken as string | undefined);

  return Boolean(clientId && clientSecret && (accessToken || refreshToken));
}

export class GmailTrashCleanupService {
  async cleanup(params?: {
    processedLabelName?: string;
  }): Promise<GmailTrashCleanupResult | null> {
    const latestConfig = await BackupConfigLoader.load();
    if (!hasRequiredGmailSettings(latestConfig)) {
      logger?.info('[GmailTrashCleanupService] Gmail settings are incomplete, skipping cleanup');
      return null;
    }

    const onTokenUpdate = async (newToken: string) => {
      const currentConfig = await BackupConfigLoader.load();
      currentConfig.storage.options = {
        ...(currentConfig.storage.options ?? {}),
        gmail: {
          ...(currentConfig.storage.options?.gmail as Record<string, unknown> | undefined),
          accessToken: newToken,
        },
      };
      await BackupConfigLoader.save(currentConfig);
    };

    const gmailConfig: BackupConfig = {
      ...latestConfig,
      storage: {
        ...latestConfig.storage,
        provider: 'gmail',
      },
    };

    const result = await StorageProviderFactory.createFromConfig(
      gmailConfig,
      undefined,
      undefined,
      onTokenUpdate,
      { returnProvider: true, allowFallbackToLocal: false }
    );

    if (typeof result === 'object' && result !== null && 'provider' in result && 'storageProvider' in result) {
      const typedResult = result as { provider: 'local' | 'dropbox' | 'gmail'; storageProvider: StorageProvider };
      const { provider, storageProvider } = typedResult;

      if (provider !== 'gmail') {
        logger?.warn({ provider }, '[GmailTrashCleanupService] Non-gmail provider resolved, skipping cleanup');
        return null;
      }

      if (!hasGmailTrashCleanup(storageProvider)) {
        logger?.warn('[GmailTrashCleanupService] Provider does not support cleanupProcessedTrash');
        return null;
      }

      return await storageProvider.cleanupProcessedTrash(params);
    }

    logger?.warn('[GmailTrashCleanupService] Unexpected return type from StorageProviderFactory');
    return null;
  }
}

