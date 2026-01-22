import type { StorageProvider } from './storage/storage-provider.interface.js';
import { LocalStorageProvider } from './storage/local-storage.provider.js';
import { DropboxStorageProvider } from './storage/dropbox-storage.provider.js';
import { DropboxOAuthService } from './dropbox-oauth.service.js';
import { GmailStorageProvider } from './storage/gmail-storage.provider.js';
import { GmailOAuthService } from './gmail-oauth.service.js';
import { OAuth2Client } from 'google-auth-library';
import { ApiError } from '../../lib/errors.js';
import type { BackupConfig } from './backup-config.js';
import { logger } from '../../lib/logger.js';

/**
 * ストレージプロバイダー作成オプション
 */
export interface StorageProviderOptions {
  provider: 'local' | 'dropbox' | 'gmail';
  accessToken?: string;
  basePath?: string;
  refreshToken?: string;
  appKey?: string;
  appSecret?: string;
  clientId?: string; // Gmail用
  clientSecret?: string; // Gmail用
  redirectUri?: string;
  subjectPattern?: string; // Gmail用
  fromEmail?: string; // Gmail用
  oauth2Client?: OAuth2Client; // Gmail用
  onTokenUpdate?: (token: string) => Promise<void>;
}

type StorageProviderCreateOptions = {
  returnProvider?: boolean;
  allowFallbackToLocal?: boolean;
};

/**
 * ストレージプロバイダーファクトリー
 * レジストリパターンを使用してストレージプロバイダーを作成する
 */
export class StorageProviderFactory {
  private static readonly providerCreators: Map<
    'local' | 'dropbox' | 'gmail',
    (options: StorageProviderOptions) => StorageProvider
  > = new Map<'local' | 'dropbox' | 'gmail', (options: StorageProviderOptions) => StorageProvider>([
    [
      'local',
      (options: StorageProviderOptions) => {
        // 環境変数は運用/CIでの上書き手段として最優先にする
        const envBaseDir = process.env.BACKUP_STORAGE_DIR;
        return new LocalStorageProvider({ baseDir: envBaseDir || options.basePath });
      }
    ],
    [
      'dropbox',
      (options: StorageProviderOptions) => {
        if (!options.accessToken) {
          throw new ApiError(400, 'Dropbox access token is required');
        }

        let oauthService: DropboxOAuthService | undefined;
        // リフレッシュトークンによる自動更新はredirectUri不要（token refresh APIにはredirect_uriは不要）
        if (options.refreshToken && options.appKey && options.appSecret) {
          oauthService = new DropboxOAuthService({
            appKey: options.appKey,
            appSecret: options.appSecret,
            redirectUri: options.redirectUri
          });
        }

        const envBasePathRaw = process.env.DROPBOX_BASE_PATH;
        const envBasePath = typeof envBasePathRaw === 'string' ? envBasePathRaw.trim() : undefined;

        return new DropboxStorageProvider({
          accessToken: options.accessToken,
          // 運用上の上書き手段（拠点別にDropbox保存先を分離する用途）
          basePath: envBasePath ? envBasePath : options.basePath,
          refreshToken: options.refreshToken,
          oauthService,
          onTokenUpdate: options.onTokenUpdate
        });
      }
    ],
    [
      'gmail',
      (options: StorageProviderOptions) => {
        if (!options.oauth2Client) {
          throw new ApiError(400, 'OAuth2Client is required for Gmail storage provider');
        }
        if (!options.accessToken) {
          throw new ApiError(400, 'Gmail access token is required');
        }

        let oauthService: GmailOAuthService | undefined;
        // リフレッシュトークンによる自動更新
        if (options.refreshToken && options.clientId && options.clientSecret) {
          oauthService = new GmailOAuthService({
            clientId: options.clientId,
            clientSecret: options.clientSecret,
            redirectUri: options.redirectUri
          });
        }

        return new GmailStorageProvider({
          oauth2Client: options.oauth2Client,
          accessToken: options.accessToken,
          refreshToken: options.refreshToken,
          subjectPattern: options.subjectPattern,
          fromEmail: options.fromEmail,
          oauthService,
          onTokenUpdate: options.onTokenUpdate
        });
      }
    ]
  ]);

  /**
   * 設定ファイルからストレージプロバイダーを作成
   * @returns 実際に使用されたプロバイダーとストレージプロバイダーのペア
   */
  static createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    options?: StorageProviderCreateOptions
  ): Promise<StorageProvider>;
  static createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    options?: StorageProviderCreateOptions | false
  ): Promise<StorageProvider>;
  static createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    options?: StorageProviderCreateOptions | true
  ): Promise<{ provider: 'local' | 'dropbox' | 'gmail'; storageProvider: StorageProvider }>;
  static async createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    options?: StorageProviderCreateOptions | boolean
  ): Promise<StorageProvider | { provider: 'local' | 'dropbox' | 'gmail'; storageProvider: StorageProvider }> {
    const resolvedOptions: StorageProviderCreateOptions = typeof options === 'boolean'
      ? { returnProvider: options }
      : (options ?? {});
    const allowFallbackToLocal = resolvedOptions.allowFallbackToLocal ?? true;
    const providerOptions: StorageProviderOptions = {
      provider: config.storage.provider
    };

    // local/dropbox/gmail共通
    providerOptions.basePath = config.storage.options?.basePath as string | undefined;

    if (config.storage.provider === 'gmail') {
      // 新構造優先: options.gmail.* → 後方互換: gmailAccessToken/gmailRefreshToken → 旧: accessToken/refreshToken
      const gmailOpts = config.storage.options?.gmail as { accessToken?: string; refreshToken?: string; clientId?: string; clientSecret?: string; redirectUri?: string; subjectPattern?: string; fromEmail?: string } | undefined;
      let accessToken =
        gmailOpts?.accessToken ??
        (config.storage.options?.gmailAccessToken as string | undefined) ??
        (config.storage.options?.accessToken as string | undefined);
      const refreshToken =
        gmailOpts?.refreshToken ??
        (config.storage.options?.gmailRefreshToken as string | undefined) ??
        (config.storage.options?.refreshToken as string | undefined);
      const clientId =
        gmailOpts?.clientId ??
        (config.storage.options?.clientId as string | undefined);
      const clientSecret =
        gmailOpts?.clientSecret ??
        (config.storage.options?.clientSecret as string | undefined);
      const redirectUri =
        gmailOpts?.redirectUri ??
        (config.storage.options?.redirectUri as string | undefined);
      const subjectPattern =
        gmailOpts?.subjectPattern ??
        (config.storage.options?.subjectPattern as string | undefined);
      const fromEmail =
        gmailOpts?.fromEmail ??
        (config.storage.options?.fromEmail as string | undefined);

      // accessTokenが空でもrefreshTokenがある場合は、refreshTokenからaccessTokenを取得
      if ((!accessToken || accessToken.trim() === '') && refreshToken && clientId && clientSecret) {
        try {
          const redirectUri = requestProtocol && requestHost 
            ? `${requestProtocol}://${requestHost}/api/gmail/oauth/callback`
            : undefined;
          const oauthService = new GmailOAuthService({
            clientId,
            clientSecret,
            redirectUri
          });
          const tokenInfo = await oauthService.refreshAccessToken(refreshToken);
          accessToken = tokenInfo.accessToken;
          // トークン更新コールバックで設定ファイルを更新
          if (onTokenUpdate) {
            await onTokenUpdate(accessToken);
          }
        } catch (error) {
          logger?.error({ err: error }, '[StorageProviderFactory] Failed to refresh Gmail access token from refresh token');
          if (allowFallbackToLocal) {
            providerOptions.provider = 'local';
          } else {
            throw error;
          }
        }
      }

      // accessTokenが空の場合はlocalにフォールバック
      if (!accessToken || accessToken.trim() === '') {
        logger?.warn('[StorageProviderFactory] Gmail access token is empty');
        if (allowFallbackToLocal) {
          providerOptions.provider = 'local';
        } else {
          throw new ApiError(400, 'Gmail access token is required');
        }
      } else {
        // OAuth2Clientを作成（設定ファイルのredirectUriを優先、なければ動的生成）
        const redirectUriForClient = redirectUri ?? (requestProtocol && requestHost 
          ? `${requestProtocol}://${requestHost}/api/gmail/oauth/callback`
          : undefined);
        const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUriForClient);
        
        providerOptions.accessToken = accessToken;
        providerOptions.refreshToken = refreshToken;
        providerOptions.clientId = clientId;
        providerOptions.clientSecret = clientSecret;
        providerOptions.subjectPattern = subjectPattern;
        providerOptions.fromEmail = fromEmail;
        providerOptions.oauth2Client = oauth2Client;

        // リダイレクトURIを構築
        if (requestProtocol && requestHost) {
          providerOptions.redirectUri = `${requestProtocol}://${requestHost}/api/gmail/oauth/callback`;
        }

        providerOptions.onTokenUpdate = onTokenUpdate;
      }
    } else if (config.storage.provider === 'dropbox') {
      // 新構造優先: options.dropbox.* → 後方互換: 旧 options.*
      const dropboxOpts = config.storage.options?.dropbox as { accessToken?: string; refreshToken?: string; appKey?: string; appSecret?: string } | undefined;
      let accessToken =
        dropboxOpts?.accessToken ??
        (config.storage.options?.accessToken as string | undefined);
      const refreshToken =
        dropboxOpts?.refreshToken ??
        (config.storage.options?.refreshToken as string | undefined);
      const appKey =
        dropboxOpts?.appKey ??
        (config.storage.options?.appKey as string | undefined);
      const appSecret =
        dropboxOpts?.appSecret ??
        (config.storage.options?.appSecret as string | undefined);
      
      // accessTokenが空でもrefreshTokenがある場合は、refreshTokenからaccessTokenを取得
      if ((!accessToken || accessToken.trim() === '') && refreshToken && appKey && appSecret) {
        try {
          const redirectUri = requestProtocol && requestHost 
            ? `${requestProtocol}://${requestHost}/api/backup/oauth/callback`
            : undefined;
          const oauthService = new DropboxOAuthService({
            appKey,
            appSecret,
            redirectUri
          });
          const tokenInfo = await oauthService.refreshAccessToken(refreshToken);
          accessToken = tokenInfo.accessToken;
          // トークン更新コールバックで設定ファイルを更新
          if (onTokenUpdate) {
            await onTokenUpdate(accessToken);
          }
        } catch (error) {
          logger?.error({ err: error }, '[StorageProviderFactory] Failed to refresh access token from refresh token, falling back to local storage');
          providerOptions.provider = 'local';
        }
      }
      
      // accessTokenが空の場合はlocalにフォールバック
      if (!accessToken || accessToken.trim() === '') {
        // ログに警告を出力してlocalにフォールバック
        console.warn('[StorageProviderFactory] Dropbox access token is empty, falling back to local storage');
        providerOptions.provider = 'local';
      } else {
        providerOptions.accessToken = accessToken;
        providerOptions.refreshToken = refreshToken;
        providerOptions.appKey = appKey;
        providerOptions.appSecret = appSecret;

        // リダイレクトURIを構築
        if (requestProtocol && requestHost) {
          providerOptions.redirectUri = `${requestProtocol}://${requestHost}/api/backup/oauth/callback`;
        }

        providerOptions.onTokenUpdate = onTokenUpdate;
      }
    }

    const storageProvider = this.create(providerOptions);
    const actualProvider = providerOptions.provider;

    if (resolvedOptions.returnProvider) {
      return { provider: actualProvider, storageProvider };
    }
    return storageProvider;
  }

  /**
   * バックアップ対象ごとのストレージプロバイダーを作成
   * 対象にstorage.providerが指定されている場合はそれを使用、未指定の場合は全体設定を使用
   * @returns 実際に使用されたプロバイダーとストレージプロバイダーのペア
   */
  static createFromTarget(
    config: BackupConfig,
    target: BackupConfig['targets'][0],
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    options?: StorageProviderCreateOptions
  ): Promise<StorageProvider>;
  static createFromTarget(
    config: BackupConfig,
    target: BackupConfig['targets'][0],
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    options?: StorageProviderCreateOptions | false
  ): Promise<StorageProvider>;
  static createFromTarget(
    config: BackupConfig,
    target: BackupConfig['targets'][0],
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    options?: StorageProviderCreateOptions | true
  ): Promise<{ provider: 'local' | 'dropbox' | 'gmail'; storageProvider: StorageProvider }>;
  static async createFromTarget(
    config: BackupConfig,
    target: BackupConfig['targets'][0],
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    options?: StorageProviderCreateOptions | boolean
  ): Promise<StorageProvider | { provider: 'local' | 'dropbox' | 'gmail'; storageProvider: StorageProvider }> {
    const resolvedOptions: StorageProviderCreateOptions = typeof options === 'boolean'
      ? { returnProvider: options }
      : (options ?? {});
    const allowFallbackToLocal = resolvedOptions.allowFallbackToLocal ?? true;
    // 対象ごとのストレージプロバイダーが指定されている場合はそれを使用
    const provider = target.storage?.provider ?? config.storage.provider;
    
    const providerOptions: StorageProviderOptions = {
      provider
    };

    // basePathは全体設定から取得（対象ごとの設定は将来の拡張用）
    providerOptions.basePath = config.storage.options?.basePath as string | undefined;

    if (provider === 'gmail') {
      // 新構造優先: options.gmail.* → 後方互換: gmailAccessToken/gmailRefreshToken → 旧: accessToken/refreshToken
      const gmailOpts = config.storage.options?.gmail as { accessToken?: string; refreshToken?: string; clientId?: string; clientSecret?: string; redirectUri?: string; subjectPattern?: string; fromEmail?: string } | undefined;
      let accessToken =
        gmailOpts?.accessToken ??
        (config.storage.options?.gmailAccessToken as string | undefined) ??
        (config.storage.options?.accessToken as string | undefined);
      const refreshToken =
        gmailOpts?.refreshToken ??
        (config.storage.options?.gmailRefreshToken as string | undefined) ??
        (config.storage.options?.refreshToken as string | undefined);
      const clientId =
        gmailOpts?.clientId ??
        (config.storage.options?.clientId as string | undefined);
      const clientSecret =
        gmailOpts?.clientSecret ??
        (config.storage.options?.clientSecret as string | undefined);
      const redirectUri =
        gmailOpts?.redirectUri ??
        (config.storage.options?.redirectUri as string | undefined);
      const subjectPattern =
        gmailOpts?.subjectPattern ??
        (config.storage.options?.subjectPattern as string | undefined);
      const fromEmail =
        gmailOpts?.fromEmail ??
        (config.storage.options?.fromEmail as string | undefined);

      // accessTokenが空でもrefreshTokenがある場合は、refreshTokenからaccessTokenを取得
      if ((!accessToken || accessToken.trim() === '') && refreshToken && clientId && clientSecret) {
        try {
          const redirectUri = requestProtocol && requestHost 
            ? `${requestProtocol}://${requestHost}/api/gmail/oauth/callback`
            : undefined;
          const oauthService = new GmailOAuthService({
            clientId,
            clientSecret,
            redirectUri
          });
          const tokenInfo = await oauthService.refreshAccessToken(refreshToken);
          accessToken = tokenInfo.accessToken;
          // トークン更新コールバックで設定ファイルを更新
          if (onTokenUpdate) {
            await onTokenUpdate(accessToken);
          }
        } catch (error) {
          logger?.error({ err: error }, '[StorageProviderFactory] Failed to refresh Gmail access token from refresh token');
          if (allowFallbackToLocal) {
            providerOptions.provider = 'local';
          } else {
            throw error;
          }
        }
      }

      // accessTokenが空の場合はlocalにフォールバック
      if (!accessToken || accessToken.trim() === '') {
        logger?.warn('[StorageProviderFactory] Gmail access token is empty');
        if (allowFallbackToLocal) {
          providerOptions.provider = 'local';
        } else {
          throw new ApiError(400, 'Gmail access token is required');
        }
      } else {
        // OAuth2Clientを作成（設定ファイルのredirectUriを優先、なければ動的生成）
        const redirectUriForClient = redirectUri ?? (requestProtocol && requestHost 
          ? `${requestProtocol}://${requestHost}/api/gmail/oauth/callback`
          : undefined);
        const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUriForClient);
        
        providerOptions.accessToken = accessToken;
        providerOptions.refreshToken = refreshToken;
        providerOptions.clientId = clientId;
        providerOptions.clientSecret = clientSecret;
        providerOptions.subjectPattern = subjectPattern;
        providerOptions.fromEmail = fromEmail;
        providerOptions.oauth2Client = oauth2Client;

        providerOptions.onTokenUpdate = onTokenUpdate;
      }
    } else if (provider === 'dropbox') {
      // 新構造優先: options.dropbox.* → 後方互換: 旧 options.*
      const dropboxOpts = config.storage.options?.dropbox as { accessToken?: string; refreshToken?: string; appKey?: string; appSecret?: string } | undefined;
      let accessToken =
        dropboxOpts?.accessToken ??
        (config.storage.options?.accessToken as string | undefined);
      const refreshToken =
        dropboxOpts?.refreshToken ??
        (config.storage.options?.refreshToken as string | undefined);
      const appKey =
        dropboxOpts?.appKey ??
        (config.storage.options?.appKey as string | undefined);
      const appSecret =
        dropboxOpts?.appSecret ??
        (config.storage.options?.appSecret as string | undefined);
      
      // accessTokenが空でもrefreshTokenがある場合は、refreshTokenからaccessTokenを取得
      if ((!accessToken || accessToken.trim() === '') && refreshToken && appKey && appSecret) {
        try {
          const redirectUri = requestProtocol && requestHost 
            ? `${requestProtocol}://${requestHost}/api/backup/oauth/callback`
            : undefined;
          const oauthService = new DropboxOAuthService({
            appKey,
            appSecret,
            redirectUri
          });
          const tokenInfo = await oauthService.refreshAccessToken(refreshToken);
          accessToken = tokenInfo.accessToken;
          // トークン更新コールバックで設定ファイルを更新
          if (onTokenUpdate) {
            await onTokenUpdate(accessToken);
          }
        } catch (error) {
          logger?.error({ err: error }, '[StorageProviderFactory] Failed to refresh access token from refresh token, falling back to local storage');
          providerOptions.provider = 'local';
        }
      }
      
      // accessTokenが空の場合はlocalにフォールバック
      if (!accessToken || accessToken.trim() === '') {
        console.warn('[StorageProviderFactory] Dropbox access token is empty, falling back to local storage');
        providerOptions.provider = 'local';
      } else {
        providerOptions.accessToken = accessToken;
        providerOptions.refreshToken = refreshToken;
        providerOptions.appKey = appKey;
        providerOptions.appSecret = appSecret;

        // リダイレクトURIを構築
        if (requestProtocol && requestHost) {
          providerOptions.redirectUri = `${requestProtocol}://${requestHost}/api/backup/oauth/callback`;
        }

        providerOptions.onTokenUpdate = onTokenUpdate;
      }
    }

    const storageProvider = this.create(providerOptions);
    const actualProvider = providerOptions.provider;

    if (resolvedOptions.returnProvider) {
      return { provider: actualProvider, storageProvider };
    }
    return storageProvider;
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
    provider: 'local' | 'dropbox' | 'gmail',
    creator: (options: StorageProviderOptions) => StorageProvider
  ): void {
    this.providerCreators.set(provider, creator);
  }

  /**
   * 登録されているストレージプロバイダーの種類を取得
   */
  static getRegisteredProviders(): ('local' | 'dropbox' | 'gmail')[] {
    return Array.from(this.providerCreators.keys());
  }
}
