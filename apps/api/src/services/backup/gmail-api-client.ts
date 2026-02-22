import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { logger } from '../../lib/logger.js';
import { GmailRequestGateService, GmailRateLimitedDeferredError } from './gmail-request-gate.service.js';

/**
 * Gmailメッセージ情報
 */
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  payload?: {
    headers?: Array<{ name: string; value: string }>;
    parts?: Array<{
      partId: string;
      mimeType: string;
      filename?: string;
      body?: {
        attachmentId?: string;
        size?: number;
      };
      parts?: Array<{
        partId: string;
        mimeType: string;
        filename?: string;
        body?: {
          attachmentId?: string;
          size?: number;
        };
      }>;
    }>;
    body?: {
      attachmentId?: string;
      size?: number;
    };
  };
}

export interface GmailTrashCleanupResult {
  query: string;
  totalMatched: number;
  deletedCount: number;
  errors: Array<{ messageId: string; error: string }>;
}

/**
 * Gmail APIクライアント
 * Gmail APIを使用してメール検索、添付ファイル取得、メールアーカイブを行う
 */
export class GmailApiClient {
  private gmail: ReturnType<typeof google.gmail>;
  private readonly gate: GmailRequestGateService;
  private readonly allowWait: boolean;

  constructor(
    oauth2Client: OAuth2Client,
    opts?: {
      gate?: GmailRequestGateService;
      /**
       * trueの場合、クールダウンが解除されるまで待ってから実行する。
       * falseの場合、クールダウン中は即座にdeferする（scheduled用途向け）。
       */
      allowWait?: boolean;
    }
  ) {
    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    this.gate = opts?.gate ?? new GmailRequestGateService();
    this.allowWait = opts?.allowWait ?? false;
  }

  private async gateExecute<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    return await this.gate.execute(operation, fn, { allowWait: this.allowWait });
  }

  private async findLabelIdByName(labelName: string): Promise<string | undefined> {
    const response = await this.gateExecute('gmail.users.labels.list', async () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.gmail.users.labels.list as any)({ userId: 'me' }, { retry: false })
    );
    const labels = response.data.labels || [];
    const found = labels.find((label: { id?: string; name?: string }) => label.name === labelName);
    return found?.id || undefined;
  }

  private async ensureLabel(labelName: string): Promise<string> {
    const existingId = await this.findLabelIdByName(labelName);
    if (existingId) {
      return existingId;
    }

    const created = await this.gateExecute('gmail.users.labels.create', async () =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (this.gmail.users.labels.create as any)(
        {
          userId: 'me',
          requestBody: {
            name: labelName,
            labelListVisibility: 'labelShow',
            messageListVisibility: 'show',
          },
        },
        { retry: false }
      )
    );

    if (!created.data.id) {
      throw new Error(`Failed to create Gmail label: ${labelName}`);
    }
    return created.data.id;
  }

  /**
   * メールを検索
   * @param query Gmail検索クエリ（例: "subject:CSV Import"）
   * @returns メッセージIDの配列
   */
  async searchMessages(query: string): Promise<string[]> {
    return this.searchMessagesLimited(query, 10);
  }

  /**
   * メールを指定件数だけ検索
   * @param query Gmail検索クエリ（例: "subject:CSV Import"）
   * @param maxResults 取得上限（1以上）
   * @returns メッセージIDの配列
   */
  async searchMessagesLimited(query: string, maxResults: number): Promise<string[]> {
    try {
      const safeMaxResults = Number.isFinite(maxResults) && maxResults > 0 ? Math.floor(maxResults) : 10;
      const response = await this.gateExecute('gmail.users.messages.list', async () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.gmail.users.messages.list as any)(
          {
            userId: 'me',
            q: query,
            maxResults: safeMaxResults,
          },
          { retry: false }
        )
      );

      const messages = response.data.messages || [];
      return messages
        .map((msg: { id?: string }) => msg.id || '')
        .filter((id: string) => id !== '');
    } catch (error) {
      if (error instanceof GmailRateLimitedDeferredError) {
        throw error;
      }
      const err = error as { message?: string; status?: number; code?: number };
      const statusInfo = [err?.status, err?.code].filter(Boolean).join('/');
      const statusSuffix = statusInfo ? ` (status: ${statusInfo})` : '';
      logger?.error(
        { err: error, query },
        '[GmailApiClient] Failed to search messages'
      );
      const wrapped = new Error(
        `Failed to search messages: ${error instanceof Error ? error.message : String(error)}${statusSuffix}`
      );
      (wrapped as { cause?: unknown }).cause = error;
      throw wrapped;
    }
  }

  /**
   * メールを全件検索（ページネーション対応）
   * @param query Gmail検索クエリ
   * @returns メッセージIDの配列
   */
  async searchMessagesAll(query: string): Promise<string[]> {
    try {
      const messageIds: string[] = [];
      let pageToken: string | undefined;

      do {
        const response = await this.gateExecute('gmail.users.messages.list', async () =>
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this.gmail.users.messages.list as any)(
            {
              userId: 'me',
              q: query,
              maxResults: 100,
              pageToken,
            },
            { retry: false }
          )
        );

        const messages = response.data.messages || [];
        messageIds.push(
          ...messages
            .map((msg: { id?: string }) => msg.id || '')
            .filter((id: string) => id !== '')
        );
        pageToken = response.data.nextPageToken || undefined;
      } while (pageToken);

      return messageIds;
    } catch (error) {
      if (error instanceof GmailRateLimitedDeferredError) {
        throw error;
      }
      const err = error as { message?: string; status?: number; code?: number };
      const statusInfo = [err?.status, err?.code].filter(Boolean).join('/');
      const statusSuffix = statusInfo ? ` (status: ${statusInfo})` : '';
      logger?.error(
        { err: error, query },
        '[GmailApiClient] Failed to search messages (all pages)'
      );
      const wrapped = new Error(
        `Failed to search messages: ${error instanceof Error ? error.message : String(error)}${statusSuffix}`
      );
      (wrapped as { cause?: unknown }).cause = error;
      throw wrapped;
    }
  }

  /**
   * メール詳細を取得
   * @param messageId メッセージID
   * @returns メッセージ情報
   */
  async getMessage(messageId: string): Promise<GmailMessage> {
    try {
      const response = await this.gateExecute('gmail.users.messages.get', async () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.gmail.users.messages.get as any)(
          {
            userId: 'me',
            id: messageId,
            format: 'full',
          },
          { retry: false }
        )
      );

      const message = response.data;
      return {
        id: message.id || '',
        threadId: message.threadId || '',
        labelIds: message.labelIds || [],
        snippet: message.snippet || '',
        payload: message.payload as GmailMessage['payload']
      };
    } catch (error) {
      if (error instanceof GmailRateLimitedDeferredError) {
        throw error;
      }
      logger?.error(
        { err: error, messageId },
        '[GmailApiClient] Failed to get message'
      );
      throw new Error(`Failed to get message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 添付ファイルを取得
   * @param messageId メッセージID
   * @param attachmentId 添付ファイルID
   * @returns 添付ファイルのBuffer
   */
  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    try {
      const response = await this.gateExecute('gmail.users.messages.attachments.get', async () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.gmail.users.messages.attachments.get as any)(
          {
            userId: 'me',
            messageId,
            id: attachmentId,
          },
          { retry: false }
        )
      );

      const attachment = response.data;
      if (!attachment.data) {
        throw new Error('Attachment data is empty');
      }

      // Base64デコード
      return Buffer.from(attachment.data, 'base64');
    } catch (error) {
      if (error instanceof GmailRateLimitedDeferredError) {
        throw error;
      }
      logger?.error(
        { err: error, messageId, attachmentId },
        '[GmailApiClient] Failed to get attachment'
      );
      throw new Error(`Failed to get attachment: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * メールをアーカイブ（INBOXラベルを削除）
   * @param messageId メッセージID
   */
  async archiveMessage(messageId: string): Promise<void> {
    try {
      await this.gateExecute('gmail.users.messages.modify(archive)', async () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.gmail.users.messages.modify as any)(
          {
            userId: 'me',
            id: messageId,
            requestBody: {
              removeLabelIds: ['INBOX'],
            },
          },
          { retry: false }
        )
      );

      logger?.info({ messageId }, '[GmailApiClient] Message archived');
    } catch (error) {
      if (error instanceof GmailRateLimitedDeferredError) {
        throw error;
      }
      logger?.error(
        { err: error, messageId },
        '[GmailApiClient] Failed to archive message'
      );
      throw new Error(`Failed to archive message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * メールを既読にする（UNREADラベルを削除）
   * @param messageId メッセージID
   */
  async markAsRead(messageId: string): Promise<void> {
    try {
      const safeMessageId = messageId ? messageId.slice(-6) : null;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'verify-step1',hypothesisId:'B',location:'gmail-api-client.ts:markAsRead',message:'markAsRead called',data:{messageIdSuffix:safeMessageId},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      await this.gateExecute('gmail.users.messages.modify(markAsRead)', async () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.gmail.users.messages.modify as any)(
          {
            userId: 'me',
            id: messageId,
            requestBody: {
              removeLabelIds: ['UNREAD'],
            },
          },
          { retry: false }
        )
      );

      logger?.info({ messageId }, '[GmailApiClient] Message marked as read');
    } catch (error) {
      if (error instanceof GmailRateLimitedDeferredError) {
        throw error;
      }
      logger?.error(
        { err: error, messageId },
        '[GmailApiClient] Failed to mark message as read'
      );
      throw new Error(`Failed to mark message as read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * メールをゴミ箱へ移動
   * @param messageId メッセージID
   */
  async trashMessage(messageId: string): Promise<void> {
    try {
      const safeMessageId = messageId ? messageId.slice(-6) : null;
      const processedLabelName = (process.env.GMAIL_TRASH_CLEANUP_LABEL || 'rps_processed').trim();
      const processedLabelId = await this.ensureLabel(processedLabelName);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/efef6d23-e2ed-411f-be56-ab093f2725f8',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'verify-step1',hypothesisId:'B',location:'gmail-api-client.ts:trashMessage',message:'trashMessage called',data:{messageIdSuffix:safeMessageId},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      await this.gateExecute('gmail.users.messages.modify(addProcessedLabel)', async () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.gmail.users.messages.modify as any)(
          {
            userId: 'me',
            id: messageId,
            requestBody: {
              addLabelIds: [processedLabelId],
            },
          },
          { retry: false }
        )
      );

      await this.gateExecute('gmail.users.messages.trash', async () =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this.gmail.users.messages.trash as any)({ userId: 'me', id: messageId }, { retry: false })
      );

      logger?.info({ messageId }, '[GmailApiClient] Message trashed');
    } catch (error) {
      if (error instanceof GmailRateLimitedDeferredError) {
        throw error;
      }
      logger?.error(
        { err: error, messageId },
        '[GmailApiClient] Failed to trash message'
      );
      throw new Error(`Failed to trash message: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async cleanupProcessedTrash(params?: {
    processedLabelName?: string;
  }): Promise<GmailTrashCleanupResult> {
    const processedLabelName = (params?.processedLabelName || process.env.GMAIL_TRASH_CLEANUP_LABEL || 'rps_processed').trim();
    const query = `in:trash label:${processedLabelName}`;

    try {
      const messageIds = await this.searchMessagesAll(query);
      const errors: Array<{ messageId: string; error: string }> = [];
      let deletedCount = 0;

      for (const messageId of messageIds) {
        try {
          await this.gateExecute('gmail.users.messages.delete', async () =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this.gmail.users.messages.delete as any)({ userId: 'me', id: messageId }, { retry: false })
          );
          deletedCount += 1;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({ messageId, error: errorMessage });
        }
      }

      return {
        query,
        totalMatched: messageIds.length,
        deletedCount,
        errors,
      };
    } catch (error) {
      if (error instanceof GmailRateLimitedDeferredError) {
        throw error;
      }
      logger?.error(
        { err: error, query },
        '[GmailApiClient] Failed to cleanup processed trash messages'
      );
      throw new Error(
        `Failed to cleanup processed trash messages: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * メールから最初の添付ファイルを取得
   * @param messageId メッセージID
   * @returns 添付ファイルのBufferとファイル名
   */
  async getFirstAttachment(messageId: string): Promise<{ buffer: Buffer; filename: string } | null> {
    const message = await this.getMessage(messageId);
    
    if (!message.payload) {
      return null;
    }

    // 添付ファイルを探す
    type PartsType = NonNullable<GmailMessage['payload']>['parts'];
    const findAttachment = (parts: PartsType | undefined): { attachmentId: string; filename: string } | null => {
      if (!parts || !Array.isArray(parts)) {
        return null;
      }

      for (const part of parts) {
        if (part.body?.attachmentId) {
          return {
            attachmentId: part.body.attachmentId,
            filename: part.filename || 'attachment'
          };
        }
        if (part.parts) {
          const nested = findAttachment(part.parts);
          if (nested) {
            return nested;
          }
        }
      }
      return null;
    };

    // メール本文に直接添付ファイルがある場合
    if (message.payload.body?.attachmentId) {
      const buffer = await this.getAttachment(messageId, message.payload.body.attachmentId);
      const filename = 'attachment';
      return { buffer, filename };
    }

    // パーツから添付ファイルを探す
    if (message.payload.parts) {
      const attachment = findAttachment(message.payload.parts);
      if (attachment) {
        const buffer = await this.getAttachment(messageId, attachment.attachmentId);
        return { buffer, filename: attachment.filename };
      }
    }

    return null;
  }
}

