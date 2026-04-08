import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { BackupConfigLoader } from '../backup/backup-config.loader.js';
import type { BackupConfig } from '../backup/backup-config.js';
import { GmailStorageProvider } from '../backup/storage/gmail-storage.provider.js';
import type { StorageProvider } from '../backup/storage/storage-provider.interface.js';
import { StorageProviderFactory } from '../backup/storage-provider-factory.js';
import { KioskDocumentService } from './kiosk-document.service.js';
import { PrismaKioskDocumentRepository } from './adapters/prisma-kiosk-document.repository.js';
import { PdfStorageFileStoreAdapter } from './adapters/pdf-storage-file-store.adapter.js';
import { PdfStorageRenderAdapter } from './adapters/pdf-storage-render.adapter.js';
import { PlaywrightHtmlToPdfAdapter } from './adapters/playwright-html-to-pdf.adapter.js';

/** @internal 単体テスト用に公開 */
export function buildKioskDocumentGmailSearchQuery(subjectPattern: string, fromEmail?: string): string {
  const queries: string[] = [];
  const escaped = subjectPattern.replace(/"/g, '\\"');
  queries.push(`subject:"${escaped}"`);
  if (fromEmail?.trim()) {
    queries.push(`from:${fromEmail.trim()}`);
  }
  queries.push('is:unread');
  return queries.join(' ');
}

export type KioskDocumentGmailIngestSummary = {
  scheduleId: string;
  messagesScanned: number;
  pdfsImported: number;
  pdfsSkippedDuplicate: number;
  /** HTML 添付を PDF 化して登録した件数 */
  htmlImported: number;
  htmlSkippedDuplicate: number;
  errors: string[];
};

async function persistGmailAccessToken(newToken: string): Promise<void> {
  const cfg = await BackupConfigLoader.load();
  const prevGmail = (cfg.storage.options?.gmail ?? {}) as Record<string, unknown>;
  cfg.storage.options = {
    ...(cfg.storage.options ?? {}),
    gmail: {
      ...prevGmail,
      accessToken: newToken,
    },
  };
  await BackupConfigLoader.save(cfg);
}

type GmailStorageFactoryResult = {
  provider: 'local' | 'dropbox' | 'gmail';
  storageProvider: StorageProvider;
};

async function resolveGmailClientFromConfig(config: BackupConfig): Promise<ReturnType<GmailStorageProvider['getGmailApiClient']>> {
  // returnProvider:true のとき実装は常に { provider, storageProvider } を返すが、オーバーロード型が追従しないため明示する
  const created = (await StorageProviderFactory.createFromConfig(
    config,
    'http',
    'localhost',
    persistGmailAccessToken,
    { returnProvider: true, allowFallbackToLocal: false, gmailAllowWait: true }
  )) as unknown as GmailStorageFactoryResult;
  if (!created || typeof created !== 'object' || !('storageProvider' in created)) {
    throw new ApiError(500, 'Gmailストレージの初期化に失敗しました', undefined, 'KIOSK_DOC_GMAIL_INIT');
  }
  if (created.provider !== 'gmail' || !(created.storageProvider instanceof GmailStorageProvider)) {
    throw new ApiError(
      400,
      '要領書のGmail取り込みには backup.json の storage.provider を gmail にし、有効なトークンを設定してください',
      undefined,
      'KIOSK_DOC_GMAIL_NOT_CONFIGURED'
    );
  }
  return created.storageProvider.getGmailApiClient();
}

const MAX_MESSAGES_PER_RUN = 25;

/**
 * Gmailから要領書PDFを取り込む（バックアップ設定の kioskDocumentGmailIngest エントリ単位）
 */
export class KioskDocumentGmailIngestionService {
  private readonly kioskDocumentService: KioskDocumentService;

  constructor(kioskDocumentService?: KioskDocumentService) {
    this.kioskDocumentService =
      kioskDocumentService ??
      new KioskDocumentService(
        new PrismaKioskDocumentRepository(),
        new PdfStorageFileStoreAdapter(),
        new PdfStorageRenderAdapter(),
        new PlaywrightHtmlToPdfAdapter()
      );
  }

  async ingestSchedule(params: {
    config: BackupConfig;
    schedule: NonNullable<BackupConfig['kioskDocumentGmailIngest']>[number];
  }): Promise<KioskDocumentGmailIngestSummary> {
    const { config, schedule } = params;
    const summary: KioskDocumentGmailIngestSummary = {
      scheduleId: schedule.id,
      messagesScanned: 0,
      pdfsImported: 0,
      pdfsSkippedDuplicate: 0,
      htmlImported: 0,
      htmlSkippedDuplicate: 0,
      errors: [],
    };

    if (!schedule.enabled) {
      return summary;
    }

    const gmailClient = await resolveGmailClientFromConfig(config);
    const query = buildKioskDocumentGmailSearchQuery(schedule.subjectPattern, schedule.fromEmail);

    let messageIds: string[];
    try {
      messageIds = await gmailClient.searchMessagesLimited(query, MAX_MESSAGES_PER_RUN);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.errors.push(`search failed: ${msg}`);
      logger?.error({ err: e, scheduleId: schedule.id, query }, '[KioskDocumentGmailIngestion] search failed');
      return summary;
    }

    summary.messagesScanned = messageIds.length;

    for (const messageId of messageIds) {
      try {
        const pdfs = await gmailClient.listPdfAttachments(messageId);
        for (const pdf of pdfs) {
          try {
            const buffer = await gmailClient.getAttachment(messageId, pdf.attachmentId);
            const created = await this.kioskDocumentService.createFromGmailAttachment({
              buffer,
              attachmentFilename: pdf.filename,
              gmailMessageId: messageId,
            });
            if (created) {
              summary.pdfsImported += 1;
            } else {
              summary.pdfsSkippedDuplicate += 1;
            }
          } catch (partErr) {
            const msg = partErr instanceof Error ? partErr.message : String(partErr);
            summary.errors.push(`message ${messageId.slice(-8)} file ${pdf.filename}: ${msg}`);
            logger?.error(
              { err: partErr, messageId, filename: pdf.filename },
              '[KioskDocumentGmailIngestion] attachment import failed'
            );
          }
        }

        const htmls = await gmailClient.listHtmlAttachments(messageId);
        for (const htmlPart of htmls) {
          try {
            const buffer = await gmailClient.getAttachment(messageId, htmlPart.attachmentId);
            const created = await this.kioskDocumentService.createFromGmailHtmlAttachment({
              htmlBuffer: buffer,
              attachmentFilename: htmlPart.filename,
              gmailMessageId: messageId,
            });
            if (created) {
              summary.htmlImported += 1;
            } else {
              summary.htmlSkippedDuplicate += 1;
            }
          } catch (partErr) {
            const msg = partErr instanceof Error ? partErr.message : String(partErr);
            summary.errors.push(`message ${messageId.slice(-8)} file ${htmlPart.filename}: ${msg}`);
            logger?.error(
              { err: partErr, messageId, filename: htmlPart.filename },
              '[KioskDocumentGmailIngestion] HTML attachment import failed'
            );
          }
        }

        try {
          await gmailClient.markAsRead(messageId);
          await gmailClient.archiveMessage(messageId);
        } catch (postErr) {
          const msg = postErr instanceof Error ? postErr.message : String(postErr);
          summary.errors.push(`message ${messageId.slice(-8)} post-process: ${msg}`);
          logger?.error({ err: postErr, messageId }, '[KioskDocumentGmailIngestion] mark read/archive failed');
        }
      } catch (msgErr) {
        const msg = msgErr instanceof Error ? msgErr.message : String(msgErr);
        summary.errors.push(`message ${messageId.slice(-8)}: ${msg}`);
        logger?.error({ err: msgErr, messageId }, '[KioskDocumentGmailIngestion] message processing failed');
      }
    }

    return summary;
  }

  async ingestAllEnabledSchedules(config: BackupConfig): Promise<KioskDocumentGmailIngestSummary[]> {
    const schedules = config.kioskDocumentGmailIngest ?? [];
    const results: KioskDocumentGmailIngestSummary[] = [];
    for (const schedule of schedules) {
      if (!schedule.enabled) {
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      results.push(await this.ingestSchedule({ config, schedule }));
    }
    return results;
  }

  async ingestByScheduleId(config: BackupConfig, scheduleId: string): Promise<KioskDocumentGmailIngestSummary> {
    const schedule = (config.kioskDocumentGmailIngest ?? []).find((s) => s.id === scheduleId);
    if (!schedule) {
      throw new ApiError(404, `要領書Gmailスケジュールが見つかりません: ${scheduleId}`, undefined, 'KIOSK_DOC_SCHEDULE_NOT_FOUND');
    }
    return this.ingestSchedule({ config, schedule });
  }
}
