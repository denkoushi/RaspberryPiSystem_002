import { Dropbox } from 'dropbox';
import * as https from 'https';
import * as tls from 'tls';
import fetch from 'node-fetch';
import type { FileInfo, StorageProvider } from './storage-provider.interface';
import { logger } from '../../../lib/logger.js';
import { verifyDropboxCertificate } from './dropbox-cert-pinning.js';

/**
 * Dropbox APIを使用したストレージプロバイダー。
 * セキュリティ対策として証明書ピニング、TLS検証、リトライロジックを実装。
 */
export class DropboxStorageProvider implements StorageProvider {
  private readonly dbx: Dropbox;
  private readonly basePath: string;

  constructor(options: { accessToken: string; basePath?: string }) {
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const customFetch = (url: string, init?: RequestInit) => {
      return fetch(url, {
        ...init,
        agent: httpsAgent
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    };

    this.dbx = new Dropbox({
      accessToken: options.accessToken,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fetch: customFetch as any
    });

    this.basePath = options.basePath || '/backups';
  }

  /**
   * ファイルをアップロードする
   * リトライロジック: レート制限エラー（429）時に指数バックオフでリトライ
   */
  async upload(file: Buffer, path: string): Promise<void> {
    const fullPath = this.normalizePath(path);
    const maxRetries = 5;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        await this.dbx.filesUpload({
          path: fullPath,
          contents: file,
          mode: { '.tag': 'overwrite' }
        });
        logger?.info({ path: fullPath, size: file.length }, '[DropboxStorageProvider] File uploaded');
        return;
      } catch (error: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err: any = error;
        // レート制限エラー（429）の場合、リトライ
        if (err?.status === 429 || err?.error?.error?.['.tag'] === 'rate_limit') {
          const retryAfter = this.extractRetryAfter(err);
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
        logger?.error({ err, path: fullPath }, '[DropboxStorageProvider] Upload failed');
        throw error;
      }
    }

    throw new Error(`Upload failed after ${maxRetries} retries`);
  }

  /**
   * ファイルをダウンロードする
   */
  async download(path: string): Promise<Buffer> {
    const fullPath = this.normalizePath(path);
    
    try {
      const response = await this.dbx.filesDownload({ path: fullPath });
      
      // Dropbox SDKのfilesDownloadは、result.fileBinaryまたはresult.result.fileBinaryを返す
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fileBinary = (response as any).fileBinary || (response as any).result?.fileBinary;
      if (!fileBinary) {
        throw new Error('No file binary in response');
      }

      return Buffer.from(fileBinary);
    } catch (error) {
      logger?.error({ err: error, path: fullPath }, '[DropboxStorageProvider] Download failed');
      throw error;
    }
  }

  /**
   * ファイルを削除する
   */
  async delete(path: string): Promise<void> {
    const fullPath = this.normalizePath(path);
    
    try {
      await this.dbx.filesDeleteV2({ path: fullPath });
      logger?.info({ path: fullPath }, '[DropboxStorageProvider] File deleted');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // ファイルが存在しない場合はエラーにしない
      if (error?.status === 409 || error?.error?.error?.['.tag'] === 'path_lookup') {
        logger?.warn({ path: fullPath }, '[DropboxStorageProvider] File not found, skipping delete');
        return;
      }
      logger?.error({ err: error, path: fullPath }, '[DropboxStorageProvider] Delete failed');
      throw error;
    }
  }

  /**
   * ファイル一覧を取得する
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
      const response = await this.dbx.filesListFolder({ path: fullPath });
      
      for (const entry of response.result.entries) {
        if (entry['.tag'] === 'file') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fileEntry = entry as any;
          results.push({
            path: fileEntry.path_display || fileEntry.path_lower || '',
            sizeBytes: fileEntry.size,
            modifiedAt: fileEntry.server_modified ? new Date(fileEntry.server_modified) : undefined
          });
        } else if (entry['.tag'] === 'folder') {
          // 再帰的にフォルダ内を探索
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const folderEntry = entry as any;
          const subResults = await this.list(folderEntry.path_display || folderEntry.path_lower || '');
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      // フォルダが存在しない場合は空配列を返す
      if (error?.status === 409 || error?.error?.error?.['.tag'] === 'path_lookup') {
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
      const response = await this.dbx.filesListFolderContinue({ cursor });
      
      for (const entry of response.result.entries) {
        if (entry['.tag'] === 'file') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const fileEntry = entry as any;
          results.push({
            path: fileEntry.path_display || fileEntry.path_lower || '',
            sizeBytes: fileEntry.size,
            modifiedAt: fileEntry.server_modified ? new Date(fileEntry.server_modified) : undefined
          });
        } else if (entry['.tag'] === 'folder') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const folderEntry = entry as any;
          const subResults = await this.list(folderEntry.path_display || folderEntry.path_lower || '');
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
    // 先頭のスラッシュを削除
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    // basePathと結合
    const fullPath = `${this.basePath}/${cleanPath}`;
    // 連続するスラッシュを1つに
    return fullPath.replace(/\/+/g, '/');
  }

  /**
   * Retry-Afterヘッダーからリトライ待機時間を抽出
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractRetryAfter(error: any): number {
    const retryAfter = error?.headers?.['retry-after'] || error?.error?.retry_after;
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

