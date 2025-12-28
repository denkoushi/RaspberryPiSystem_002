import type { StorageProvider } from './storage/storage-provider.interface.js';
import { LocalStorageProvider } from './storage/local-storage.provider.js';
import { DropboxStorageProvider } from './storage/dropbox-storage.provider.js';
import { DropboxOAuthService } from './dropbox-oauth.service.js';
import { ApiError } from '../../lib/errors.js';
import type { BackupConfig } from './backup-config.js';
import { logger } from '../../lib/logger.js';

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
  > = new Map<'local' | 'dropbox', (options: StorageProviderOptions) => StorageProvider>([
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
  ): StorageProvider;
  static createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: false
  ): StorageProvider;
  static createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: true
  ): { provider: 'local' | 'dropbox'; storageProvider: StorageProvider };
  static createFromConfig(
    config: BackupConfig,
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: boolean
  ): StorageProvider | { provider: 'local' | 'dropbox'; storageProvider: StorageProvider } {
    const options: StorageProviderOptions = {
      provider: config.storage.provider
    };

    // local/dropbox共通
    options.basePath = config.storage.options?.basePath as string | undefined;

    if (config.storage.provider === 'dropbox') {
      let accessToken = config.storage.options?.accessToken as string | undefined;
      const refreshToken = config.storage.options?.refreshToken as string | undefined;
      const appKey = config.storage.options?.appKey as string | undefined;
      const appSecret = config.storage.options?.appSecret as string | undefined;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage-provider-factory.ts:105',message:'Dropbox provider check',data:{configProvider:config.storage.provider,hasAccessToken:!!accessToken,accessTokenLength:accessToken?.length||0,accessTokenPrefix:accessToken?.substring(0,10)||'empty',hasRefreshToken:!!refreshToken,hasAppKey:!!appKey,hasAppSecret:!!appSecret},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      
      // accessTokenが空でもrefreshTokenがある場合は、refreshTokenからaccessTokenを取得
      if ((!accessToken || accessToken.trim() === '') && refreshToken && appKey && appSecret) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage-provider-factory.ts:109',message:'Attempting to refresh accessToken from refreshToken',data:{hasRefreshToken:!!refreshToken,hasAppKey:!!appKey,hasAppSecret:!!appSecret},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
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
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage-provider-factory.ts:119',message:'AccessToken refreshed successfully',data:{accessTokenLength:accessToken?.length||0,accessTokenPrefix:accessToken?.substring(0,10)||'empty'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          // トークン更新コールバックで設定ファイルを更新
          if (onTokenUpdate) {
            await onTokenUpdate(accessToken);
          }
        } catch (error) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage-provider-factory.ts:125',message:'Failed to refresh accessToken',data:{error:error instanceof Error?error.message:'Unknown error'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
          // #endregion
          logger?.error({ err: error }, '[StorageProviderFactory] Failed to refresh access token from refresh token, falling back to local storage');
          options.provider = 'local';
        }
      }
      
      // accessTokenが空の場合はlocalにフォールバック
      if (!accessToken || accessToken.trim() === '') {
        // ログに警告を出力してlocalにフォールバック
        console.warn('[StorageProviderFactory] Dropbox access token is empty, falling back to local storage');
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage-provider-factory.ts:133',message:'Fallback to local',data:{reason:'accessToken empty after refresh attempt'},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        options.provider = 'local';
      } else {
        options.accessToken = accessToken;
        options.refreshToken = refreshToken;
        options.appKey = appKey;
        options.appSecret = appSecret;
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage-provider-factory.ts:140',message:'Dropbox options set',data:{hasRefreshToken:!!options.refreshToken,hasAppKey:!!options.appKey,hasAppSecret:!!options.appSecret,refreshTokenLength:options.refreshToken?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
        // #endregion

        // リダイレクトURIを構築
        if (requestProtocol && requestHost) {
          options.redirectUri = `${requestProtocol}://${requestHost}/api/backup/oauth/callback`;
        }

        options.onTokenUpdate = onTokenUpdate;
      }
    }

    const storageProvider = this.create(options);
    const actualProvider = options.provider;
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'storage-provider-factory.ts:128',message:'Provider created',data:{actualProvider,requestedProvider:config.storage.provider,returnProvider},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion

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
  ): StorageProvider;
  static createFromTarget(
    config: BackupConfig,
    target: BackupConfig['targets'][0],
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: false
  ): StorageProvider;
  static createFromTarget(
    config: BackupConfig,
    target: BackupConfig['targets'][0],
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: true
  ): { provider: 'local' | 'dropbox'; storageProvider: StorageProvider };
  static createFromTarget(
    config: BackupConfig,
    target: BackupConfig['targets'][0],
    requestProtocol?: string,
    requestHost?: string,
    onTokenUpdate?: (token: string) => Promise<void>,
    returnProvider?: boolean
  ): StorageProvider | { provider: 'local' | 'dropbox'; storageProvider: StorageProvider } {
    // 対象ごとのストレージプロバイダーが指定されている場合はそれを使用
    const provider = target.storage?.provider ?? config.storage.provider;
    
    const options: StorageProviderOptions = {
      provider
    };

    // basePathは全体設定から取得（対象ごとの設定は将来の拡張用）
    options.basePath = config.storage.options?.basePath as string | undefined;

    if (provider === 'dropbox') {
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
