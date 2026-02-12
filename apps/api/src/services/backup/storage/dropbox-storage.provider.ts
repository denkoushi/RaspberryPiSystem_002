import { Dropbox } from 'dropbox';
import * as https from 'https';
import * as tls from 'tls';
import fetch from 'node-fetch';
import type { RequestInit as NodeFetchRequestInit } from 'node-fetch';
import type { FileInfo, StorageProvider } from './storage-provider.interface';
import { logger } from '../../../lib/logger.js';
import { getString, isRecord, toErrorInfo } from '../../../lib/type-guards.js';
import { verifyDropboxCertificate } from './dropbox-cert-pinning.js';
import { DropboxOAuthService } from '../dropbox-oauth.service.js';

/**
 * Dropbox APIを使用したストレージプロバイダー。
 * セキュリティ対策として証明書ピニング、TLS検証、リトライロジックを実装。
 * リフレッシュトークンによる自動アクセストークン更新機能をサポート。
 */
export class DropboxStorageProvider implements StorageProvider {
  private dbx: Dropbox;
  private readonly basePath: string;
  private accessToken: string;
  private refreshToken?: string;
  private oauthService?: DropboxOAuthService;
  private onTokenUpdate?: (token: string) => Promise<void>;

  private createPinnedFetch(httpsAgent: https.Agent) {
    return (url: string, init?: NodeFetchRequestInit) => {
      const nextInit = {
        ...(init as Record<string, unknown>),
        agent: httpsAgent
      };
      return fetch(url, nextInit as NodeFetchRequestInit);
    };
  }

  constructor(options: {
    accessToken: string;
    basePath?: string;
    refreshToken?: string;
    oauthService?: DropboxOAuthService;
    onTokenUpdate?: (token: string) => Promise<void>;
  }) {
    // HTTPSエージェントの設定（証明書検証を有効化、証明書ピニング対応）
    const httpsAgent = new https.Agent({
      rejectUnauthorized: true, // 証明書検証を有効化（必須）
      keepAlive: true,
      keepAliveMsecs: 1000,
      maxSockets: 5,
      timeout: 30000, // 30秒タイムアウト
      secureProtocol: 'TLSv1_2_method', // TLS 1.2以上を強制
      // 証明書ピニングの検証
      checkServerIdentity: (servername: string, cert: tls.PeerCertificate) => {
        const pinningError = verifyDropboxCertificate(servername, cert);
        if (pinningError) {
          return pinningError;
        }
        // デフォルトの検証を継続
        return tls.checkServerIdentity(servername, cert);
      }
    });

    // カスタムfetch関数（HTTPSエージェントを使用）
    const customFetch = this.createPinnedFetch(httpsAgent);

    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.oauthService = options.oauthService;
    this.onTokenUpdate = options.onTokenUpdate;

    this.dbx = new Dropbox({
      accessToken: this.accessToken,
      fetch: customFetch as unknown as (input: string, init?: NodeFetchRequestInit) => Promise<unknown>
    });

    this.basePath = options.basePath || '/backups';
  }

  /**
   * アクセストークンを更新する
   */
  private async refreshAccessTokenIfNeeded(): Promise<void> {
    if (!this.refreshToken || !this.oauthService) {
      return; // リフレッシュトークンまたはOAuthサービスが設定されていない場合は何もしない
    }

    try {
      const tokenInfo = await this.oauthService.refreshAccessToken(this.refreshToken);
      this.accessToken = tokenInfo.accessToken;
      
      // Dropboxインスタンスを更新
      const httpsAgent = new https.Agent({
        rejectUnauthorized: true,
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 5,
        timeout: 30000,
        secureProtocol: 'TLSv1_2_method',
        checkServerIdentity: (servername: string, cert: tls.PeerCertificate) => {
          const pinningError = verifyDropboxCertificate(servername, cert);
          if (pinningError) {
            return pinningError;
          }
          return tls.checkServerIdentity(servername, cert);
        }
      });

      const customFetch = this.createPinnedFetch(httpsAgent);

      this.dbx = new Dropbox({
        accessToken: this.accessToken,
        fetch: customFetch as unknown as (input: string, init?: NodeFetchRequestInit) => Promise<unknown>
      });

      // トークン更新コールバックを呼び出す
      if (this.onTokenUpdate) {
        await this.onTokenUpdate(this.accessToken);
      }

      logger?.info('[DropboxStorageProvider] Access token refreshed successfully');
    } catch (error) {
      logger?.error({ err: error }, '[DropboxStorageProvider] Failed to refresh access token');
      throw error;
    }
  }

  /**
   * エラーが401（認証エラー）または400（malformed token）の場合、リフレッシュトークンで自動更新を試みる
   */
  private async handleAuthError<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      // 401エラー、expired_access_tokenエラー、または400エラー（malformed token）の場合、リフレッシュを試みる
      const status = this.getErrorStatus(error);
      const errorTag = this.getDropboxTag(error);
      const message = this.getErrorMessage(error);
      const isAuthError = status === 401 || errorTag === 'expired_access_token';
      // 400エラーでmalformed/invalid tokenの場合を検出（errorが文字列またはオブジェクトの両方に対応）
      const dropboxError = this.getDropboxErrorRecord(error);
      const errorMessage = typeof dropboxError === 'string' ? dropboxError : String(dropboxError ?? '');
      const errorMessageLower = errorMessage.toLowerCase();
      const isMalformedToken = status === 400 &&
        (errorMessageLower.includes('malformed') || errorMessageLower.includes('invalid') ||
         message.toLowerCase().includes('malformed') || message.toLowerCase().includes('invalid'));
      
      if (isAuthError || isMalformedToken) {
        logger?.warn(
          { status, error: dropboxError, message, isAuthError, isMalformedToken },
          '[DropboxStorageProvider] Access token invalid or expired, attempting refresh'
        );
        await this.refreshAccessTokenIfNeeded();
        // リフレッシュ後に再試行
        return await operation();
      }
      throw error;
    }
  }

  /**
   * ファイルをアップロードする
   * リトライロジック: レート制限エラー（429）時に指数バックオフでリトライ
   * 認証エラー（401）時はリフレッシュトークンで自動更新
   */
  async upload(file: Buffer, path: string): Promise<void> {
    const fullPath = this.normalizePath(path);
    const maxRetries = 5;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        await this.handleAuthError(async () => {
          await this.dbx.filesUpload({
            path: fullPath,
            contents: file,
            mode: { '.tag': 'overwrite' }
          });
        });
        logger?.info({ path: fullPath, size: file.length }, '[DropboxStorageProvider] File uploaded');
        return;
      } catch (error: unknown) {
        // レート制限エラー（429）の場合、リトライ
        if (this.isRateLimitError(error)) {
          const retryAfter = this.extractRetryAfter(error);
          const delay = this.calculateBackoffDelay(retryCount, retryAfter);
          
          logger?.warn(
            { path: fullPath, retryCount, delay, retryAfter },
            '[DropboxStorageProvider] Rate limit hit, retrying'
          );
          
          await this.sleep(delay);
          retryCount++;
          continue;
        }

        // その他のエラーは再スロー
        logger?.error({ err: error, path: fullPath }, '[DropboxStorageProvider] Upload failed');
        throw error;
      }
    }

    throw new Error(`Upload failed after ${maxRetries} retries`);
  }

  /**
   * ファイルをダウンロードする
   * リトライロジック: レート制限エラー（429）とネットワークエラー時に指数バックオフでリトライ
   * 認証エラー（401）時はリフレッシュトークンで自動更新
   */
  async download(path: string): Promise<Buffer> {
    const fullPath = this.normalizePath(path);
    const maxRetries = 5;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        return await this.handleAuthError(async () => {
          const response = await this.dbx.filesDownload({ path: fullPath });
          
          // Dropbox SDKのfilesDownloadは、result.fileBinaryまたはresult.result.fileBinaryを返す
          const fileBinary = this.getFileBinaryFromDownloadResponse(response);
          if (!fileBinary) {
            throw new Error('No file binary in response');
          }

          return this.toBufferFromFileBinary(fileBinary);
        });
      } catch (error: unknown) {
        // 409エラーまたはpath_lookupエラーの場合、詳細なメッセージを返す（リトライしない）
        if (this.isPathLookupError(error) || this.getDropboxErrorSummary(error)?.includes('not_found')) {
          const errorTag = this.getDropboxTag(error) || 'not_found';
          const errorSummary = this.getDropboxErrorSummary(error) || 'File not found';
          logger?.error({ path: fullPath, errorTag, errorSummary }, '[DropboxStorageProvider] File not found');
          throw new Error(`Backup file not found in Dropbox: ${fullPath}. Error: ${errorSummary}`);
        }
        
        // レート制限エラー（429）の場合、リトライ
        if (this.isRateLimitError(error)) {
          const retryAfter = this.extractRetryAfter(error);
          const delay = this.calculateBackoffDelay(retryCount, retryAfter);
          
          logger?.warn(
            { path: fullPath, retryCount, delay, retryAfter },
            '[DropboxStorageProvider] Rate limit hit during download, retrying'
          );
          
          await this.sleep(delay);
          retryCount++;
          continue;
        }
        
        // ネットワークエラー（タイムアウト、接続エラーなど）の場合、リトライ
        if (this.isNetworkError(error) && retryCount < maxRetries - 1) {
          const delay = this.calculateBackoffDelay(retryCount, 0);
          
          logger?.warn(
            { path: fullPath, retryCount, delay, errorCode: this.getErrorCode(error), errorMessage: this.getErrorMessage(error) },
            '[DropboxStorageProvider] Network error during download, retrying'
          );
          
          await this.sleep(delay);
          retryCount++;
          continue;
        }
        
        // その他のエラーは再スロー
        logger?.error({ err: error, path: fullPath, retryCount }, '[DropboxStorageProvider] Download failed');
        throw error;
      }
    }

    throw new Error(`Download failed after ${maxRetries} retries`);
  }

  /**
   * ファイルを削除する
   * リトライロジック: レート制限エラー（429）とネットワークエラー時に指数バックオフでリトライ
   * 認証エラー（401）時はリフレッシュトークンで自動更新
   */
  async delete(path: string): Promise<void> {
    const fullPath = this.normalizePath(path);
    const maxRetries = 5;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        await this.handleAuthError(async () => {
          await this.dbx.filesDeleteV2({ path: fullPath });
        });
        logger?.info({ path: fullPath }, '[DropboxStorageProvider] File deleted');
        return;
      } catch (error: unknown) {
        // ファイルが存在しない場合はエラーにしない（リトライしない）
        if (this.isPathLookupError(error)) {
          logger?.warn({ path: fullPath }, '[DropboxStorageProvider] File not found, skipping delete');
          return;
        }
        
        // レート制限エラー（429）の場合、リトライ
        if (this.isRateLimitError(error)) {
          const retryAfter = this.extractRetryAfter(error);
          const delay = this.calculateBackoffDelay(retryCount, retryAfter);
          
          logger?.warn(
            { path: fullPath, retryCount, delay, retryAfter },
            '[DropboxStorageProvider] Rate limit hit during delete, retrying'
          );
          
          await this.sleep(delay);
          retryCount++;
          continue;
        }
        
        // ネットワークエラー（タイムアウト、接続エラーなど）の場合、リトライ
        if (this.isNetworkError(error) && retryCount < maxRetries - 1) {
          const delay = this.calculateBackoffDelay(retryCount, 0);
          
          logger?.warn(
            { path: fullPath, retryCount, delay, errorCode: this.getErrorCode(error), errorMessage: this.getErrorMessage(error) },
            '[DropboxStorageProvider] Network error during delete, retrying'
          );
          
          await this.sleep(delay);
          retryCount++;
          continue;
        }
        
        // その他のエラーは再スロー
        logger?.error({ err: error, path: fullPath, retryCount }, '[DropboxStorageProvider] Delete failed');
        throw error;
      }
    }

    throw new Error(`Delete failed after ${maxRetries} retries`);
  }

  /**
   * ファイル一覧を取得する
   * 認証エラー（401）時はリフレッシュトークンで自動更新
   */
  async list(path: string): Promise<FileInfo[]> {
    // listメソッドでは、basePathを含む完全パスを直接使用
    // pathが空文字列または'/'の場合はbasePathを使用
    let fullPath: string;
    if (!path || path === '/' || path === '') {
      fullPath = this.basePath;
    } else if (path.startsWith(this.basePath)) {
      // 既にbasePathが含まれている場合はそのまま使用
      fullPath = path;
    } else {
      // basePathが含まれていない場合は結合
      fullPath = `${this.basePath}${path.startsWith('/') ? path : '/' + path}`;
    }
    // 連続するスラッシュを1つに
    fullPath = fullPath.replace(/\/+/g, '/');
    
    const results: FileInfo[] = [];

    try {
      const response = await this.handleAuthError(async () => {
        return await this.dbx.filesListFolder({ path: fullPath });
      });
      
      for (const entry of response.result.entries) {
        if (entry['.tag'] === 'file') {
          results.push({
            path: entry.path_display || entry.path_lower || '',
            sizeBytes: entry.size,
            modifiedAt: entry.server_modified ? new Date(entry.server_modified) : undefined
          });
        } else if (entry['.tag'] === 'folder') {
          // 再帰的にフォルダ内を探索
          const subResults = await this.list(entry.path_display || entry.path_lower || '');
          results.push(...subResults);
        }
      }

      // ページネーション対応
      if (response.result.has_more) {
        const cursor = response.result.cursor;
        const moreResults = await this.listContinue(cursor);
        results.push(...moreResults);
      }

      return results;
    } catch (error: unknown) {
      // フォルダが存在しない場合は空配列を返す
      if (this.isPathLookupError(error)) {
        return [];
      }
      logger?.error({ err: error, path: fullPath }, '[DropboxStorageProvider] List failed');
      throw error;
    }
  }

  /**
   * ページネーション継続
   */
  private async listContinue(cursor: string): Promise<FileInfo[]> {
    const results: FileInfo[] = [];

    try {
      const response = await this.handleAuthError(async () => {
        return await this.dbx.filesListFolderContinue({ cursor });
      });
      
      for (const entry of response.result.entries) {
        if (entry['.tag'] === 'file') {
          results.push({
            path: entry.path_display || entry.path_lower || '',
            sizeBytes: entry.size,
            modifiedAt: entry.server_modified ? new Date(entry.server_modified) : undefined
          });
        } else if (entry['.tag'] === 'folder') {
          const subResults = await this.list(entry.path_display || entry.path_lower || '');
          results.push(...subResults);
        }
      }

      if (response.result.has_more) {
        const moreResults = await this.listContinue(response.result.cursor);
        results.push(...moreResults);
      }

      return results;
    } catch (error) {
      logger?.error({ err: error, cursor }, '[DropboxStorageProvider] List continue failed');
      throw error;
    }
  }

  /**
   * パスを正規化する（basePathをプレフィックスとして追加）
   */
  private normalizePath(path: string): string {
    const normalizedBasePath = this.basePath.replace(/\/+$/g, '') || '/backups';
    const baseNoLeadingSlash = normalizedBasePath.replace(/^\/+/g, '');

    const trimmed = String(path ?? '').trim();
    if (!trimmed) return normalizedBasePath;

    // 正規化の前にスラッシュを潰す（比較を安定させる）
    const collapsed = trimmed.replace(/\/+/g, '/');

    // すでに basePath を含む完全パス（/backups/...）はそのまま使う
    if (collapsed === normalizedBasePath || collapsed.startsWith(`${normalizedBasePath}/`)) {
      return collapsed;
    }

    // basePath の先頭スラッシュ無し表現（backups/...）が来た場合は、先頭に "/" を付けて返す
    const noLeadingSlash = collapsed.startsWith('/') ? collapsed.slice(1) : collapsed;
    if (noLeadingSlash === baseNoLeadingSlash || noLeadingSlash.startsWith(`${baseNoLeadingSlash}/`)) {
      return `/${noLeadingSlash}`.replace(/\/+/g, '/');
    }

    // それ以外は相対パスとして basePath 配下に配置
    return `${normalizedBasePath}/${noLeadingSlash}`.replace(/\/+/g, '/');
  }

  private getErrorStatus(error: unknown): number | undefined {
    const errorInfo = toErrorInfo(error);
    return typeof errorInfo.status === 'number' ? errorInfo.status : undefined;
  }

  private getErrorCode(error: unknown): string | undefined {
    const errorInfo = toErrorInfo(error);
    if (typeof errorInfo.code === 'string') return errorInfo.code;
    if (typeof errorInfo.code === 'number') return String(errorInfo.code);
    return undefined;
  }

  private getErrorMessage(error: unknown): string {
    return toErrorInfo(error).message ?? '';
  }

  private getDropboxErrorRecord(error: unknown): Record<string, unknown> | undefined {
    if (!isRecord(error)) return undefined;
    const errorField = error.error;
    return isRecord(errorField) ? errorField : undefined;
  }

  private getDropboxTag(error: unknown): string | undefined {
    const first = this.getDropboxErrorRecord(error);
    if (!first) return undefined;
    const second = first.error;
    if (!isRecord(second)) return undefined;
    const tag = second['.tag'];
    return typeof tag === 'string' ? tag : undefined;
  }

  private getDropboxErrorSummary(error: unknown): string | undefined {
    const record = this.getDropboxErrorRecord(error);
    if (!record) return undefined;
    return getString(record, 'error_summary');
  }

  private isRateLimitError(error: unknown): boolean {
    return this.getErrorStatus(error) === 429 || this.getDropboxTag(error) === 'rate_limit';
  }

  private isPathLookupError(error: unknown): boolean {
    return this.getErrorStatus(error) === 409 || this.getDropboxTag(error) === 'path_lookup';
  }

  private isNetworkError(error: unknown): boolean {
    const code = this.getErrorCode(error);
    const message = this.getErrorMessage(error).toLowerCase();
    return code === 'ETIMEDOUT'
      || code === 'ECONNRESET'
      || code === 'ENOTFOUND'
      || code === 'ECONNREFUSED'
      || message.includes('timeout')
      || message.includes('network')
      || message.includes('econn');
  }

  private getFileBinaryFromDownloadResponse(response: unknown): unknown {
    if (!isRecord(response)) return undefined;
    if ('fileBinary' in response) {
      return response.fileBinary;
    }
    if (isRecord(response.result) && 'fileBinary' in response.result) {
      return response.result.fileBinary;
    }
    return undefined;
  }

  private toBufferFromFileBinary(fileBinary: unknown): Buffer {
    if (Buffer.isBuffer(fileBinary)) {
      return fileBinary;
    }
    if (typeof fileBinary === 'string' || fileBinary instanceof Uint8Array) {
      return Buffer.from(fileBinary);
    }
    if (fileBinary instanceof ArrayBuffer) {
      return Buffer.from(fileBinary);
    }
    if (ArrayBuffer.isView(fileBinary)) {
      return Buffer.from(fileBinary.buffer, fileBinary.byteOffset, fileBinary.byteLength);
    }
    throw new Error('Unsupported file binary type in Dropbox response');
  }

  /**
   * Retry-Afterヘッダーからリトライ待機時間を抽出
   */
  private extractRetryAfter(error: unknown): number {
    let retryAfter: unknown;
    if (isRecord(error) && isRecord(error.headers)) {
      retryAfter = error.headers['retry-after'];
    }
    if (retryAfter === undefined) {
      const dropboxError = this.getDropboxErrorRecord(error);
      retryAfter = dropboxError?.retry_after;
    }
    if (retryAfter) {
      return parseInt(String(retryAfter), 10) * 1000; // 秒をミリ秒に変換
    }
    return 0;
  }

  /**
   * 指数バックオフの遅延時間を計算
   */
  private calculateBackoffDelay(retryCount: number, retryAfter: number): number {
    if (retryAfter > 0) {
      return retryAfter;
    }
    // 指数バックオフ: 2^retryCount秒（最大30秒）
    return Math.min(1000 * Math.pow(2, retryCount), 30000);
  }

  /**
   * 指定時間待機
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

