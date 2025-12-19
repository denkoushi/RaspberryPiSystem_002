import type { StorageProvider } from './storage/storage-provider.interface.js';
import { LocalStorageProvider } from './storage/local-storage.provider.js';
import { DropboxStorageProvider } from './storage/dropbox-storage.provider.js';
import { DropboxOAuthService } from './dropbox-oauth.service.js';
import { ApiError } from '../../lib/errors.js';
import type { BackupConfig } from './backup-config.js';

/**
 * ストレージプロバイダー作成オプション
 */
export interface StorageProviderOptions {
  provider: 'local' | 'dropbox';
  accessToken?: string;
  basePath?: string;
  refreshToken?: string;
  appKey?: string;
  appSecret?: string;
  redirectUri?: string;
  onTokenUpdate?: (token: string) => Promise<void>;
}

/**
 * ストレージプロバイダーファクトリー
 * レジストリパターンを使用してストレージプロバイダーを作成する
 */
export class StorageProviderFactory {
  private static readonly providerCreators: Map<
    'local' | 'dropbox',
    (options: StorageProviderOptions) => StorageProvider
  > = new Map([
    ['local', () => new LocalStorageProvider()],
    [
      'dropbox',
      (options: StorageProviderOptions) => {
        if (!options.accessToken) {
          throw new ApiError(400, 'Dropbox access token is required');
        }

        let oauthService: DropboxOAuthService | undefined;
        if (options.refreshToken && options.appKey && options.appSecret && options.redirectUri) {
          oauthService = new DropboxOAuthService({
            appKey: options.appKey,
            appSecret: options.appSecret,
            redirectUri: options.redirectUri
          });
        }

        return new DropboxStorageProvider({
          accessToken: options.accessToken,
          basePath: options.basePath,
          refreshToken: options.refreshToken,
          oauthService,
          onTokenUpdate: options.onTokenUpdate
        });
      }
    ]
  ]);

  /**
   * 設定ファイルからストレージプロバイダーを作成
   */
  static createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>
  ): StorageProvider {
    const options: StorageProviderOptions = {
      provider: config.storage.provider
    };

    if (config.storage.provider === 'dropbox') {
      const accessToken = config.storage.options?.accessToken as string | undefined;
      if (!accessToken) {
        throw new ApiError(400, 'Dropbox access token is required in config file');
      }

      options.accessToken = accessToken;
      options.basePath = config.storage.options?.basePath as string | undefined;
      options.refreshToken = config.storage.options?.refreshToken as string | undefined;
      options.appKey = config.storage.options?.appKey as string | undefined;
      options.appSecret = config.storage.options?.appSecret as string | undefined;

      // リダイレクトURIを構築
      if (requestProtocol && requestHost) {
        options.redirectUri = `${requestProtocol}://${requestHost}/api/backup/oauth/callback`;
      }

      options.onTokenUpdate = onTokenUpdate;
    }

    return this.create(options);
  }

  /**
   * ストレージプロバイダーを作成
   */
  static create(options: StorageProviderOptions): StorageProvider {
    const creator = this.providerCreators.get(options.provider);
    if (!creator) {
      throw new ApiError(400, `Unknown storage provider: ${options.provider}`);
    }

    return creator(options);
  }

  /**
   * ストレージプロバイダーを登録（拡張用）
   */
  static register(
    provider: 'local' | 'dropbox',
    creator: (options: StorageProviderOptions) => StorageProvider
  ): void {
    this.providerCreators.set(provider, creator);
  }

  /**
   * 登録されているストレージプロバイダーの種類を取得
   */
  static getRegisteredProviders(): ('local' | 'dropbox')[] {
    return Array.from(this.providerCreators.keys());
  }
}
