import { google } from 'googleapis';
import { logger } from '../../lib/logger.js';
// TODO: googleapisパッケージの証明書ピニング実装（googleapisは内部的にgaxiosを使用）
// 証明書ピニングは環境変数やカスタムHTTPクライアントで実装可能だが、現時点では標準実装を使用

/**
 * Gmail APIクライアント
 * Gmail APIのラッパー（メール検索、添付ファイル取得、ラベル操作）
 */
export class GmailApiClient {
  private gmail: ReturnType<typeof google.gmail>;
  private accessToken: string;
  private refreshToken?: string;
  private onTokenUpdate?: (token: string) => Promise<void>;
  private refreshAccessTokenFn?: () => Promise<string>;

  constructor(options: {
    accessToken: string;
    refreshToken?: string;
    onTokenUpdate?: (token: string) => Promise<void>;
    refreshAccessTokenFn?: () => Promise<string>;
  }) {
    this.accessToken = options.accessToken;
    this.refreshToken = options.refreshToken;
    this.onTokenUpdate = options.onTokenUpdate;
    this.refreshAccessTokenFn = options.refreshAccessTokenFn;

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({
      access_token: this.accessToken,
      refresh_token: this.refreshToken
    });

    // トークンが期限切れになった場合の自動リフレッシュ
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        this.accessToken = tokens.access_token;
        if (this.onTokenUpdate) {
          await this.onTokenUpdate(tokens.access_token);
        }
      }
    });

    // googleapisは内部的にgaxiosを使用
    // 証明書検証はデフォルトで有効（rejectUnauthorized: true）
    // 証明書ピニングは将来的に実装予定（googleapisのカスタムHTTPクライアント設定が必要）
    this.gmail = google.gmail({ 
      version: 'v1', 
      auth: oauth2Client
    });
  }

  /**
   * アクセストークンを更新する
   */
  private async refreshAccessTokenIfNeeded(): Promise<void> {
    if (!this.refreshAccessTokenFn) {
      return;
    }

    try {
      const newToken = await this.refreshAccessTokenFn();
      this.accessToken = newToken;

      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({
        access_token: this.accessToken,
        refresh_token: this.refreshToken
      });

      oauth2Client.on('tokens', async (tokens) => {
        if (tokens.access_token) {
          this.accessToken = tokens.access_token;
          if (this.onTokenUpdate) {
            await this.onTokenUpdate(tokens.access_token);
          }
        }
      });

      // googleapisは内部的にgaxiosを使用
      // 証明書検証はデフォルトで有効（rejectUnauthorized: true）
      this.gmail = google.gmail({ 
        version: 'v1', 
        auth: oauth2Client
      });

      logger?.info('[GmailApiClient] Access token refreshed successfully');
    } catch (error) {
      logger?.error({ err: error }, '[GmailApiClient] Failed to refresh access token');
      throw error;
    }
  }

  /**
   * エラーが401（認証エラー）の場合、アクセストークンを自動リフレッシュして再試行
   */
  private async handleAuthError<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const err: any = error;
      // 401エラーの場合、リフレッシュを試みる
      if (err?.code === 401 || err?.response?.status === 401) {
        logger?.warn(
          { status: err?.response?.status, error: err?.message },
          '[GmailApiClient] Access token invalid or expired, attempting refresh'
        );
        await this.refreshAccessTokenIfNeeded();
        // リフレッシュ後に再試行
        return await operation();
      }
      throw error;
    }
  }

  /**
   * メールを検索する
   * @param query Gmail検索クエリ（例: "subject:[Pi5 Backup] is:unread"）
   * @returns メールIDのリスト
   */
  async searchMessages(query: string): Promise<string[]> {
    return await this.handleAuthError(async () => {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100
      });

      const messages = response.data.messages || [];
      return messages.map(msg => msg.id || '').filter(id => id !== '');
    });
  }

  /**
   * メールを取得する
   * @param messageId メールID
   * @returns メールデータ
   */
  async getMessage(messageId: string): Promise<{
    id: string;
    threadId: string;
    labelIds: string[];
    snippet: string;
    payload: {
      headers: Array<{ name: string; value: string }>;
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
    };
  }> {
    return await this.handleAuthError(async () => {
      const response = await this.gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      const message = response.data;
      if (!message.id || !message.threadId) {
        throw new Error('Invalid message data');
      }

      return {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds || [],
        snippet: message.snippet || '',
        payload: message.payload as {
          headers: Array<{ name: string; value: string }>;
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
        }
      };
    });
  }

  /**
   * 添付ファイルを取得する
   * @param messageId メールID
   * @param attachmentId 添付ファイルID
   * @returns 添付ファイルデータ（Base64デコード済み）
   */
  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    return await this.handleAuthError(async () => {
      const response = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId
      });

      const data = response.data.data;
      if (!data) {
        throw new Error('Attachment data is empty');
      }

      // Base64デコード
      return Buffer.from(data, 'base64');
    });
  }

  /**
   * ラベルを作成または取得する
   * @param labelName ラベル名
   * @returns ラベルID
   */
  async getOrCreateLabel(labelName: string): Promise<string> {
    return await this.handleAuthError(async () => {
      // 既存のラベルを検索
      const labelsResponse = await this.gmail.users.labels.list({
        userId: 'me'
      });

      const existingLabel = labelsResponse.data.labels?.find(
        label => label.name === labelName
      );

      if (existingLabel?.id) {
        return existingLabel.id;
      }

      // ラベルが存在しない場合は作成
      const createResponse = await this.gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        }
      });

      if (!createResponse.data.id) {
        throw new Error('Failed to create label');
      }

      return createResponse.data.id;
    });
  }

  /**
   * メールにラベルを追加する
   * @param messageId メールID
   * @param labelIds ラベルIDのリスト
   */
  async addLabels(messageId: string, labelIds: string[]): Promise<void> {
    await this.handleAuthError(async () => {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          addLabelIds: labelIds
        }
      });
    });
  }

  /**
   * メールを既読にする（UNREADラベルを削除）
   * @param messageId メールID
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.handleAuthError(async () => {
      await this.gmail.users.messages.modify({
        userId: 'me',
        id: messageId,
        requestBody: {
          removeLabelIds: ['UNREAD']
        }
      });
    });
  }

  /**
   * メールを削除する
   * @param messageId メールID
   */
  async deleteMessage(messageId: string): Promise<void> {
    await this.handleAuthError(async () => {
      await this.gmail.users.messages.delete({
        userId: 'me',
        id: messageId
      });
    });
  }
}
