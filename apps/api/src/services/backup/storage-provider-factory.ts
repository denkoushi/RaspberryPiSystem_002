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

        return new DropboxStorageProvider({
          accessToken: options.accessToken,
          basePath: options.basePath,
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
    onTokenUpdate?: (token: string) => Promise<void>
  ): Promise<StorageProvider>;
  static createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: false
  ): Promise<StorageProvider>;
  static createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: true
  ): Promise<{ provider: 'local' | 'dropbox' | 'gmail'; storageProvider: StorageProvider }>;
  static async createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: boolean
  ): Promise<StorageProvider | { provider: 'local' | 'dropbox' | 'gmail'; storageProvider: StorageProvider }> {
    const options: StorageProviderOptions = {
      provider: config.storage.provider
    };

    // local/dropbox/gmail共通
    options.basePath = config.storage.options?.basePath as string | undefined;

    if (config.storage.provider === 'gmail') {
      let accessToken = config.storage.options?.accessToken as string | undefined;
      const refreshToken = config.storage.options?.refreshToken as string | undefined;
      const clientId = config.storage.options?.clientId as string | undefined;
      const clientSecret = config.storage.options?.clientSecret as string | undefined;
      const subjectPattern = config.storage.options?.subjectPattern as string | undefined;
      const fromEmail = config.storage.options?.fromEmail as string | undefined;

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
          logger?.error({ err: error }, '[StorageProviderFactory] Failed to refresh Gmail access token from refresh token, falling back to local storage');
          options.provider = 'local';
        }
      }

      // accessTokenが空の場合はlocalにフォールバック
      if (!accessToken || accessToken.trim() === '') {
        logger?.warn('[StorageProviderFactory] Gmail access token is empty, falling back to local storage');
        options.provider = 'local';
      } else {
        // OAuth2Clientを作成
        const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
        
        options.accessToken = accessToken;
        options.refreshToken = refreshToken;
        options.clientId = clientId;
        options.clientSecret = clientSecret;
        options.subjectPattern = subjectPattern;
        options.fromEmail = fromEmail;
        options.oauth2Client = oauth2Client;

        // リダイレクトURIを構築
        if (requestProtocol && requestHost) {
          options.redirectUri = `${requestProtocol}://${requestHost}/api/gmail/oauth/callback`;
        }

        options.onTokenUpdate = onTokenUpdate;
      }
    } else if (config.storage.provider === 'dropbox') {
      let accessToken = config.storage.options?.accessToken as string | undefined;
      const refreshToken = config.storage.options?.refreshToken as string | undefined;
      const appKey = config.storage.options?.appKey as string | undefined;
      const appSecret = config.storage.options?.appSecret as string | undefined;
      
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
          options.provider = 'local';
        }
      }
      
      // accessTokenが空の場合はlocalにフォールバック
      if (!accessToken || accessToken.trim() === '') {
        // ログに警告を出力してlocalにフォールバック
        console.warn('[StorageProviderFactory] Dropbox access token is empty, falling back to local storage');
        options.provider = 'local';
      } else {
        options.accessToken = accessToken;
        options.refreshToken = refreshToken;
        options.appKey = appKey;
        options.appSecret = appSecret;

        // リダイレクトURIを構築
        if (requestProtocol && requestHost) {
          options.redirectUri = `${requestProtocol}://${requestHost}/api/backup/oauth/callback`;
        }

        options.onTokenUpdate = onTokenUpdate;
      }
    }

    const storageProvider = this.create(options);
    const actualProvider = options.provider;

    if (returnProvider) {
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
    onTokenUpdate?: (token: string) => Promise<void>
  ): Promise<StorageProvider>;
  static createFromTarget(
    config: BackupConfig,
    target: BackupConfig['targets'][0],
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: false
  ): Promise<StorageProvider>;
  static createFromTarget(
    config: BackupConfig,
    target: BackupConfig['targets'][0],
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: true
  ): Promise<{ provider: 'local' | 'dropbox' | 'gmail'; storageProvider: StorageProvider }>;
  static async createFromTarget(
    config: BackupConfig,
    target: BackupConfig['targets'][0],
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: boolean
  ): Promise<StorageProvider | { provider: 'local' | 'dropbox' | 'gmail'; storageProvider: StorageProvider }> {
    // 対象ごとのストレージプロバイダーが指定されている場合はそれを使用
    const provider = target.storage?.provider ?? config.storage.provider;
    
    const options: StorageProviderOptions = {
      provider
    };

    // basePathは全体設定から取得（対象ごとの設定は将来の拡張用）
    options.basePath = config.storage.options?.basePath as string | undefined;

    if (provider === 'gmail') {
      let accessToken = config.storage.options?.accessToken as string | undefined;
      const refreshToken = config.storage.options?.refreshToken as string | undefined;
      const clientId = config.storage.options?.clientId as string | undefined;
      const clientSecret = config.storage.options?.clientSecret as string | undefined;
      const subjectPattern = config.storage.options?.subjectPattern as string | undefined;
      const fromEmail = config.storage.options?.fromEmail as string | undefined;

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
          logger?.error({ err: error }, '[StorageProviderFactory] Failed to refresh Gmail access token from refresh token, falling back to local storage');
          options.provider = 'local';
        }
      }

      // accessTokenが空の場合はlocalにフォールバック
      if (!accessToken || accessToken.trim() === '') {
        logger?.warn('[StorageProviderFactory] Gmail access token is empty, falling back to local storage');
        options.provider = 'local';
      } else {
        // OAuth2Clientを作成
        const redirectUri = requestProtocol && requestHost 
          ? `${requestProtocol}://${requestHost}/api/gmail/oauth/callback`
          : undefined;
        const oauth2Client = new OAuth2Client(clientId, clientSecret, redirectUri);
        
        options.accessToken = accessToken;
        options.refreshToken = refreshToken;
        options.clientId = clientId;
        options.clientSecret = clientSecret;
        options.subjectPattern = subjectPattern;
        options.fromEmail = fromEmail;
        options.oauth2Client = oauth2Client;

        options.onTokenUpdate = onTokenUpdate;
      }
    } else if (provider === 'dropbox') {
      let accessToken = config.storage.options?.accessToken as string | undefined;
      const refreshToken = config.storage.options?.refreshToken as string | undefined;
      const appKey = config.storage.options?.appKey as string | undefined;
      const appSecret = config.storage.options?.appSecret as string | undefined;
      
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
          options.provider = 'local';
        }
      }
      
      // accessTokenが空の場合はlocalにフォールバック
      if (!accessToken || accessToken.trim() === '') {
        console.warn('[StorageProviderFactory] Dropbox access token is empty, falling back to local storage');
        options.provider = 'local';
      } else {
        options.accessToken = accessToken;
        options.refreshToken = refreshToken;
        options.appKey = appKey;
        options.appSecret = appSecret;

        // リダイレクトURIを構築
        if (requestProtocol && requestHost) {
          options.redirectUri = `${requestProtocol}://${requestHost}/api/backup/oauth/callback`;
        }

        options.onTokenUpdate = onTokenUpdate;
      }
    }

    const storageProvider = this.create(options);
    const actualProvider = options.provider;

    if (returnProvider) {
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
