import type { FileInfo, StorageProvider } from './storage-provider.interface';
import { logger } from '../../../lib/logger.js';
import { GmailApiClient } from '../gmail-api-client.js';
import { GmailOAuthService } from '../gmail-oauth.service.js';
import { OAuth2Client } from 'google-auth-library';

/**
 * Gmail APIを使用したストレージプロバイダー。
 * Gmailから添付ファイルを取得する機能を提供する。
 * Gmailは読み取り専用のため、uploadとdeleteは未実装。
 */
export class GmailStorageProvider implements StorageProvider {
  private readonly gmailClient: GmailApiClient;
  private readonly oauth2Client: OAuth2Client;
  private readonly subjectPattern?: string;
  private readonly fromEmail?: string;
  private readonly oauthService?: GmailOAuthService;
  private readonly onTokenUpdate?: (token: string) => Promise<void>;
  private accessToken: string;
  private refreshToken?: string;

  constructor(options: {
    oauth2Client: OAuth2Client;
    accessToken: string;
    refreshToken?: string;
    subjectPattern?: string;
    fromEmail?: string;
    oauthService?: GmailOAuthService;
    onTokenUpdate?: (token: string) => Promise<void>;
  }) {
    this.oauth2Client = options.oauth2Client;
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.subjectPattern = options.subjectPattern;
    this.fromEmail = options.fromEmail;
    this.oauthService = options.oauthService;
    this.onTokenUpdate = options.onTokenUpdate;

    // OAuth2Clientにトークンを設定
    this.oauth2Client.setCredentials({
      access_token: this.accessToken,
      refresh_token: this.refreshToken
    });

    this.gmailClient = new GmailApiClient(this.oauth2Client);
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
      
      // OAuth2Clientにトークンを更新
      this.oauth2Client.setCredentials({
        access_token: this.accessToken,
        refresh_token: this.refreshToken
      });

      // トークン更新コールバックを呼び出す
      if (this.onTokenUpdate) {
        await this.onTokenUpdate(this.accessToken);
      }

      logger?.info('[GmailStorageProvider] Access token refreshed successfully');
    } catch (error) {
      logger?.error({ err: error }, '[GmailStorageProvider] Failed to refresh access token');
      throw error;
    }
  }

  /**
   * エラーが401（認証エラー）の場合、リフレッシュトークンで自動更新を試みる
   */
  private async handleAuthError<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = error;
      // 401エラーまたは認証関連のエラーの場合、リフレッシュを試みる
      const isAuthError = err?.status === 401 || 
        err?.code === 401 ||
        err?.message?.toLowerCase().includes('unauthorized') ||
        err?.message?.toLowerCase().includes('invalid credentials');
      
      if (isAuthError && this.refreshToken && this.oauthService) {
        logger?.warn(
          { status: err?.status, code: err?.code, message: err?.message, isAuthError },
          '[GmailStorageProvider] Access token invalid or expired, attempting refresh'
        );
        
        await this.refreshAccessTokenIfNeeded();
        
        // リトライ
        try {
          return await operation();
        } catch (retryError) {
          logger?.error(
            { err: retryError },
            '[GmailStorageProvider] Operation failed after token refresh'
          );
          throw retryError;
        }
      }
      
      throw error;
    }
  }

  /**
   * Gmail検索クエリを構築
   * @param path 件名パターン（Gmail用）
   * @returns Gmail検索クエリ
   */
  private buildSearchQuery(path: string): string {
    const queries: string[] = [];

    // 件名パターン（pathパラメータまたは設定のsubjectPattern）
    const subjectPattern = path || this.subjectPattern;
    if (subjectPattern) {
      // 正規表現パターンの場合はそのまま使用、固定文字列の場合はsubject:で検索
      if (subjectPattern.startsWith('/') && subjectPattern.endsWith('/')) {
        // 正規表現パターン（例: /CSV Import/）
        const regexPattern = subjectPattern.slice(1, -1);
        queries.push(`subject:${regexPattern}`);
      } else {
        // 固定文字列パターン
        queries.push(`subject:"${subjectPattern}"`);
      }
    }

    // 送信者メールアドレス
    if (this.fromEmail) {
      queries.push(`from:${this.fromEmail}`);
    }

    // 未読メールのみ検索（処理済みメールを除外）
    queries.push('is:unread');

    return queries.join(' ');
  }

  /**
   * ファイル名にタイムスタンププレフィックスを追加
   * @param filename 元のファイル名
   * @returns タイムスタンプ付きファイル名
   */
  private addTimestampPrefix(filename: string): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    
    const timestamp = `${year}${month}${day}_${hour}${minute}${second}`;
    return `${timestamp}_${filename}`;
  }

  /**
   * Gmailからファイルを取得
   * @param path 件名パターン（Gmail用）
   * @returns ファイルのBuffer
   */
  async download(path: string): Promise<Buffer> {
    return this.handleAuthError(async () => {
      // 検索クエリを構築
      const query = this.buildSearchQuery(path);

      logger?.info(
        { path, query },
        '[GmailStorageProvider] Searching for messages'
      );

      // メールを検索
      const messageIds = await this.gmailClient.searchMessages(query);

      if (messageIds.length === 0) {
        throw new Error(`No messages found matching query: ${query}`);
      }

      // 最初のメールから添付ファイルを取得
      const firstMessageId = messageIds[0];
      logger?.info(
        { messageId: firstMessageId, query },
        '[GmailStorageProvider] Found message, getting attachment'
      );

      const attachment = await this.gmailClient.getFirstAttachment(firstMessageId);

      if (!attachment) {
        throw new Error(`No attachment found in message: ${firstMessageId}`);
      }

      logger?.info(
        { messageId: firstMessageId, filename: attachment.filename, size: attachment.buffer.length },
        '[GmailStorageProvider] Attachment downloaded successfully'
      );

      // メールをアーカイブ（処理済みとしてマーク）
      try {
        await this.gmailClient.archiveMessage(firstMessageId);
        logger?.info(
          { messageId: firstMessageId },
          '[GmailStorageProvider] Message archived'
        );
      } catch (archiveError) {
        // アーカイブ失敗はログに記録するが、ダウンロード成功は維持
        logger?.warn(
          { err: archiveError, messageId: firstMessageId },
          '[GmailStorageProvider] Failed to archive message'
        );
      }

      return attachment.buffer;
    });
  }

  /**
   * メール一覧を取得（将来の拡張用）
   * @param path 件名パターン（Gmail用）
   * @returns ファイル情報の配列
   */
  async list(path: string): Promise<FileInfo[]> {
    return this.handleAuthError(async () => {
      // 検索クエリを構築
      const query = this.buildSearchQuery(path);

      logger?.info(
        { path, query },
        '[GmailStorageProvider] Listing messages'
      );

      // メールを検索
      const messageIds = await this.gmailClient.searchMessages(query);

      // メール情報を取得
      const fileInfos: FileInfo[] = [];
      for (const messageId of messageIds.slice(0, 10)) { // 最大10件まで
        try {
          const message = await this.gmailClient.getMessage(messageId);
          
          // 件名を取得
          const subjectHeader = message.payload?.headers?.find(h => h.name.toLowerCase() === 'subject');
          const subject = subjectHeader?.value || 'No Subject';

          // 日付を取得
          const dateHeader = message.payload?.headers?.find(h => h.name.toLowerCase() === 'date');
          const modifiedAt = dateHeader?.value ? new Date(dateHeader.value) : undefined;

          fileInfos.push({
            path: subject,
            sizeBytes: undefined, // Gmail APIではメール全体のサイズは取得できない
            modifiedAt
          });
        } catch (error) {
          logger?.warn(
            { err: error, messageId },
            '[GmailStorageProvider] Failed to get message details'
          );
        }
      }

      return fileInfos;
    });
  }

  /**
   * ファイルをアップロード（未実装：Gmailは読み取り専用）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async upload(_file: Buffer, _path: string): Promise<void> {
    throw new Error('GmailStorageProvider does not support upload. Gmail is read-only.');
  }

  /**
   * ファイルを削除（未実装：Gmailは読み取り専用）
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async delete(_path: string): Promise<void> {
    throw new Error('GmailStorageProvider does not support delete. Gmail is read-only.');
  }

  /**
   * Gmailからファイルを取得（CSVダッシュボード用：メッセージIDと件名も返す）
   * @param path 件名パターン（Gmail用）
   * @returns ファイルのBuffer、メッセージID、件名
   */
  async downloadWithMetadata(path: string): Promise<{
    buffer: Buffer;
    messageId: string;
    messageSubject: string;
  }> {
    return this.handleAuthError(async () => {
      // 検索クエリを構築
      const query = this.buildSearchQuery(path);

      logger?.info(
        { path, query },
        '[GmailStorageProvider] Searching for messages (with metadata)'
      );

      // メールを検索
      const messageIds = await this.gmailClient.searchMessages(query);

      if (messageIds.length === 0) {
        throw new Error(`No messages found matching query: ${query}`);
      }

      // 最初のメールから添付ファイルとメタデータを取得
      const firstMessageId = messageIds[0];
      logger?.info(
        { messageId: firstMessageId, query },
        '[GmailStorageProvider] Found message, getting attachment and metadata'
      );

      // メッセージ情報を取得（件名を取得するため）
      const message = await this.gmailClient.getMessage(firstMessageId);
      const subjectHeader = message.payload?.headers?.find((h) => h.name.toLowerCase() === 'subject');
      const messageSubject = subjectHeader?.value || 'No Subject';

      const attachment = await this.gmailClient.getFirstAttachment(firstMessageId);

      if (!attachment) {
        throw new Error(`No attachment found in message: ${firstMessageId}`);
      }

      logger?.info(
        {
          messageId: firstMessageId,
          messageSubject,
          filename: attachment.filename,
          size: attachment.buffer.length,
        },
        '[GmailStorageProvider] Attachment downloaded successfully (with metadata)'
      );

      // メールをアーカイブ（処理済みとしてマーク）
      try {
        await this.gmailClient.archiveMessage(firstMessageId);
        logger?.info(
          { messageId: firstMessageId },
          '[GmailStorageProvider] Message archived'
        );
      } catch (archiveError) {
        // アーカイブ失敗はログに記録するが、ダウンロード成功は維持
        logger?.warn(
          { err: archiveError, messageId: firstMessageId },
          '[GmailStorageProvider] Failed to archive message'
        );
      }

      return {
        buffer: attachment.buffer,
        messageId: firstMessageId,
        messageSubject,
      };
    });
  }
}

