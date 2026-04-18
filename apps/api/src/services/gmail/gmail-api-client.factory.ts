import { ApiError } from '../../lib/errors.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import type { BackupConfig } from '../backup/backup-config.js';
import { GmailStorageProvider } from '../backup/storage/gmail-storage.provider.js';
import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';
import { StorageProviderFactory } from '../backup/storage-provider-factory.js';

export async function persistGmailAccessToken(newToken: string): Promise<void> {
  const cfg = await BackupConfigLoader.load();
  const prevGmail = (cfg.storage.options?.gmail ?? {}) as Record<string, unknown>;
  cfg.storage.options = {
    ...(cfg.storage.options ?? {}),
    gmail: {
      ...prevGmail,
      accessToken: newToken,
    },
  };
  await BackupConfigLoader.save(cfg);
}

type GmailStorageFactoryResult = {
  provider: 'local' | 'dropbox' | 'gmail';
  storageProvider: StorageProvider;
};

/**
 * backup.json の Gmail 設定から GmailApiClient を解決する（トークン更新を永続化）
 */
export async function resolveGmailApiClientFromBackupConfig(config: BackupConfig): Promise<
  ReturnType<GmailStorageProvider['getGmailApiClient']>
> {
  const created = (await StorageProviderFactory.createFromConfig(
    config,
    'http',
    'localhost',
    persistGmailAccessToken,
    { returnProvider: true, allowFallbackToLocal: false, gmailAllowWait: true }
  )) as unknown as GmailStorageFactoryResult;
  if (!created || typeof created !== 'object' || !('storageProvider' in created)) {
    throw new ApiError(500, 'Gmailストレージの初期化に失敗しました', undefined, 'GMAIL_CLIENT_INIT');
  }
  if (created.provider !== 'gmail' || !(created.storageProvider instanceof GmailStorageProvider)) {
    throw new ApiError(
      400,
      'Gmail API を利用するには backup.json の storage.provider を gmail にし、有効なトークンを設定してください',
      undefined,
      'GMAIL_NOT_CONFIGURED'
    );
  }
  return created.storageProvider.getGmailApiClient();
}
