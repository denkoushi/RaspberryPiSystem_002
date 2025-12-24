import type { FileInfo, StorageProvider, UploadOptions } from './storage-provider.interface.js';
import { logger } from '../../../lib/logger.js';
import { GmailApiClient } from '../gmail-api.client.js';
import { GmailOAuthService } from '../gmail-oauth.service.js';

/**
 * Gmail APIを使用したストレージプロバイダー。
 * メールの添付ファイルを取得・管理する。
 * リフレッシュトークンによる自動アクセストークン更新機能をサポート。
 */
export class GmailStorageProvider implements StorageProvider {
  private gmailClient: GmailApiClient;
  private readonly subjectPattern: RegExp;
  private readonly labelName: string;
  private readonly basePath: string;
  private accessToken: string;
  private refreshToken?: string;
  private oauthService?: GmailOAuthService;
  private onTokenUpdate?: (token: string) => Promise<void>;

  constructor(options: {
    accessToken: string;
    refreshToken?: string;
    subjectPattern: string; // 正規表現文字列
    labelName?: string;
    basePath?: string;
    oauthService?: GmailOAuthService;
    onTokenUpdate?: (token: string) => Promise<void>;
  }) {
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.oauthService = options.oauthService;
    this.onTokenUpdate = options.onTokenUpdate;
    this.subjectPattern = new RegExp(options.subjectPattern);
    this.labelName = options.labelName || 'Pi5/Processed';
    this.basePath = options.basePath || '/tmp/gmail-attachments';

    this.gmailClient = new GmailApiClient({
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      onTokenUpdate: this.onTokenUpdate,
      refreshAccessTokenFn: this.refreshAccessTokenIfNeeded.bind(this)
    });
  }

  /**
   * アクセストークンを更新する
   */
  private async refreshAccessTokenIfNeeded(): Promise<string> {
    if (!this.refreshToken || !this.oauthService) {
      throw new Error('Refresh token or OAuth service is not available');
    }

    try {
      const tokenInfo = await this.oauthService.refreshAccessToken(this.refreshToken);
      this.accessToken = tokenInfo.accessToken;

      // GmailApiClientを再作成
      this.gmailClient = new GmailApiClient({
        accessToken: this.accessToken,
        refreshToken: this.refreshToken,
        onTokenUpdate: this.onTokenUpdate,
        refreshAccessTokenFn: this.refreshAccessTokenIfNeeded.bind(this)
      });

      // トークン更新コールバックを呼び出す
      if (this.onTokenUpdate) {
        await this.onTokenUpdate(this.accessToken);
      }

      logger?.info('[GmailStorageProvider] Access token refreshed successfully');
      return this.accessToken;
    } catch (error) {
      logger?.error({ err: error }, '[GmailStorageProvider] Failed to refresh access token');
      throw error;
    }
  }

  /**
   * エラーが401（認証エラー）または429（レート制限）の場合、適切に処理する
   */
  private async handleError<T>(operation: () => Promise<T>): Promise<T> {
    const maxRetries = 5;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        return await operation();
      } catch (error: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const err: any = error;
        // 401エラーの場合、リフレッシュを試みる
        if (err?.code === 401 || err?.response?.status === 401) {
          logger?.warn(
            { status: err?.response?.status, error: err?.message },
            '[GmailStorageProvider] Access token invalid or expired, attempting refresh'
          );
          await this.refreshAccessTokenIfNeeded();
          retryCount++;
          continue;
        }
        // 429エラー（レート制限）の場合、リトライ
        if (err?.code === 429 || err?.response?.status === 429) {
          const retryAfter = this.extractRetryAfter(err);
          const delay = this.calculateBackoffDelay(retryCount, retryAfter);

          logger?.warn(
            { retryCount, delay, retryAfter },
            '[GmailStorageProvider] Rate limit hit, retrying'
          );

          await this.sleep(delay);
          retryCount++;
          continue;
        }

        // その他のエラーは再スロー
        throw error;
      }
    }

    throw new Error(`Operation failed after ${maxRetries} retries`);
  }

  /**
   * ファイルをアップロードする（将来の拡張用、今回は未実装）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async upload(_file: Buffer, _path: string, _options?: UploadOptions): Promise<void> {
    // Gmail APIでメール送信機能は実装しない（今回は添付ファイル取得のみ）
    throw new Error('Upload is not supported for Gmail storage provider');
  }

  /**
   * ファイルをダウンロードする
   * pathの形式: `messageId:attachmentId` または `messageId`（メール全体を取得）
   */
  async download(path: string): Promise<Buffer> {
    return await this.handleError(async () => {
      const [messageId, attachmentId] = path.split(':');

      if (!messageId) {
        throw new Error('Invalid path format: messageId is required');
      }

      if (attachmentId) {
        // 添付ファイルを取得
        return await this.gmailClient.getAttachment(messageId, attachmentId);
      } else {
        // メール全体を取得（添付ファイルが1つの場合）
        const message = await this.gmailClient.getMessage(messageId);
        
        // 添付ファイルを探す
        const attachment = this.findAttachment(message.payload);
        if (!attachment) {
          throw new Error('No attachment found in message');
        }

        if (!attachment.attachmentId) {
          throw new Error('Attachment ID not found');
        }

        return await this.gmailClient.getAttachment(messageId, attachment.attachmentId);
      }
    });
  }

  /**
   * メールのペイロードから添付ファイルを探す
   */
  private findAttachment(payload: {
    parts?: Array<{
      partId: string;
      mimeType: string;
      filename?: string;
      body?: { attachmentId?: string; size?: number };
      parts?: Array<{
        partId: string;
        mimeType: string;
        filename?: string;
        body?: { attachmentId?: string; size?: number };
      }>;
    }>;
  }): { attachmentId: string; filename?: string; mimeType: string } | null {
    if (!payload.parts) {
      return null;
    }

    for (const part of payload.parts) {
      // 再帰的に探索
      if (part.parts) {
        const nested = this.findAttachment({ parts: part.parts });
        if (nested) {
          return nested;
        }
      }

      // 添付ファイルを探す（bodyにattachmentIdがある場合）
      if (part.body?.attachmentId) {
        return {
          attachmentId: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType
        };
      }
    }

    return null;
  }

  /**
   * メールを削除する
   */
  async delete(path: string): Promise<void> {
    return await this.handleError(async () => {
      const [messageId] = path.split(':');

      if (!messageId) {
        throw new Error('Invalid path format: messageId is required');
      }

      await this.gmailClient.deleteMessage(messageId);
      logger?.info({ messageId }, '[GmailStorageProvider] Message deleted');
    });
  }

  /**
   * ファイル一覧を取得する（件名パターンにマッチするメールのリスト）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async list(_path: string): Promise<FileInfo[]> {
    return await this.handleError(async () => {
      // pathは無視（件名パターンで検索）
      // 未読メールを検索
      const messageIds = await this.gmailClient.searchMessages('is:unread');

      const results: FileInfo[] = [];

      for (const messageId of messageIds) {
        try {
          const message = await this.gmailClient.getMessage(messageId);

          // 件名を取得
          const subjectHeader = message.payload.headers.find(h => h.name.toLowerCase() === 'subject');
          const subject = subjectHeader?.value || '';

          // 件名パターンにマッチするか確認
          if (!this.subjectPattern.test(subject)) {
            continue;
          }

          // 添付ファイルを探す
          const attachment = this.findAttachment(message.payload);
          if (attachment) {
            results.push({
              path: `${messageId}:${attachment.attachmentId}`,
              sizeBytes: undefined, // Gmail APIからは取得できない
              modifiedAt: undefined // Gmail APIからは取得できない
            });
          }
        } catch (error) {
          logger?.warn({ err: error, messageId }, '[GmailStorageProvider] Failed to get message');
          // エラーが発生したメールはスキップ
          continue;
        }
      }

      return results;
    });
  }

  /**
   * メールを処理済みとしてマークする（ラベル追加と既読化）
   */
  async markAsProcessed(messageId: string): Promise<void> {
    return await this.handleError(async () => {
      // ラベルを取得または作成
      const labelId = await this.gmailClient.getOrCreateLabel(this.labelName);

      // ラベルを追加
      await this.gmailClient.addLabels(messageId, [labelId]);

      // 既読化
      await this.gmailClient.markAsRead(messageId);

      logger?.info({ messageId, labelName: this.labelName }, '[GmailStorageProvider] Message marked as processed');
    });
  }

  /**
   * Retry-Afterヘッダーからリトライ待機時間を抽出
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractRetryAfter(error: any): number {
    const retryAfter = error?.response?.headers?.['retry-after'] || error?.headers?.['retry-after'];
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
