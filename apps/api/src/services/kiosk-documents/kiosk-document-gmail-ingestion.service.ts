import { logger } from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import type { BackupConfig } from '../backup/backup-config.js';
import type { GmailMessage } from '../backup/gmail-api-client.js';
import { KioskDocumentService } from './kiosk-document.service.js';
import { PrismaKioskDocumentRepository } from './adapters/prisma-kiosk-document.repository.js';
import { PdfStorageFileStoreAdapter } from './adapters/pdf-storage-file-store.adapter.js';
import { PdfStorageRenderAdapter } from './adapters/pdf-storage-render.adapter.js';
import { PlaywrightHtmlToPdfAdapter } from './adapters/playwright-html-to-pdf.adapter.js';
import { resolveGmailApiClientFromBackupConfig } from '../gmail/gmail-api-client.factory.js';
import { isWorkInstructionGmailSubject } from '../gmail/gmail-subject-reservation.policy.js';

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
  /** 既存論理キーへ PDF を上書きした件数 */
  pdfsUpdated: number;
  pdfsSkippedDuplicate: number;
  /** 保存済みより古い（同じ）メールのためスキップした PDF 件数 */
  pdfsSkippedOlderMail: number;
  /** HTML 添付を PDF 化して新規登録した件数 */
  htmlImported: number;
  /** 既存論理キーへ HTML→PDF 変換結果で上書きした件数 */
  htmlUpdated: number;
  htmlSkippedDuplicate: number;
  htmlSkippedOlderMail: number;
  errors: string[];
};

const MAX_MESSAGES_PER_RUN = 25;

/**
 * Keep the existing limited search fast path while preventing dedicated
 * work-instruction messages from consuming the kiosk batch. A full search is
 * performed only when an owned message was found before the batch was filled.
 */
/** @internal Exposed for the mailbox-isolation regression test. */
export async function findEligibleKioskMessages(
  gmailClient: Pick<
    import('../backup/gmail-api-client.js').GmailApiClient,
    'getMessage' | 'searchMessagesAll'
  >,
  query: string,
  initialIds: ReadonlyArray<string>
): Promise<{ ids: string[]; messages: Map<string, GmailMessage>; scanned: number }> {
  const ids: string[] = [];
  const messages = new Map<string, GmailMessage>();
  const seen = new Set<string>();
  let ownedSeen = false;
  let scanned = 0;

  const scan = async (candidateIds: ReadonlyArray<string>): Promise<void> => {
    for (const messageId of candidateIds) {
      if (seen.has(messageId) || ids.length >= MAX_MESSAGES_PER_RUN) continue;
      seen.add(messageId);
      const message = await gmailClient.getMessage(messageId);
      scanned += 1;
      const subject = message.payload?.headers?.find((h) => h.name.toLowerCase() === 'subject')?.value ?? '';
      if (isWorkInstructionGmailSubject(subject)) {
        ownedSeen = true;
        logger?.info(
          { messageId, messageSubject: subject },
          '[KioskDocumentGmailIngestion] Work-instruction message is owned by dedicated importer, skipping'
        );
        continue;
      }
      messages.set(messageId, message);
      ids.push(messageId);
    }
  };

  await scan(initialIds);
  if (ids.length < MAX_MESSAGES_PER_RUN && ownedSeen) {
    await scan(await gmailClient.searchMessagesAll(query));
  }
  return { ids, messages, scanned };
}

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
      pdfsUpdated: 0,
      pdfsSkippedDuplicate: 0,
      pdfsSkippedOlderMail: 0,
      htmlImported: 0,
      htmlUpdated: 0,
      htmlSkippedDuplicate: 0,
      htmlSkippedOlderMail: 0,
      errors: [],
    };

    if (!schedule.enabled) {
      return summary;
    }

    const gmailClient = await resolveGmailApiClientFromBackupConfig(config);
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

    let eligibleMessages: Map<string, GmailMessage>;
    try {
      const selected = await findEligibleKioskMessages(gmailClient, query, messageIds);
      messageIds = selected.ids;
      eligibleMessages = selected.messages;
      summary.messagesScanned = selected.scanned;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      summary.errors.push(`message selection failed: ${msg}`);
      logger?.error({ err: e, scheduleId: schedule.id, query }, '[KioskDocumentGmailIngestion] message selection failed');
      return summary;
    }

    for (const messageId of messageIds) {
      try {
        // A broad kiosk subject pattern must not consume the dedicated
        // work-instruction mailbox owner. Skip before attachment parsing and
        // before mark/read/archive operations.
        const message = eligibleMessages.get(messageId);
        if (!message) continue;

        let gmailInternalDateMs = Date.now();
        try {
          gmailInternalDateMs = await gmailClient.getMessageInternalDateMs(messageId);
        } catch {
          gmailInternalDateMs = Date.now();
        }

        const pdfs = await gmailClient.listPdfAttachments(messageId);
        for (const pdf of pdfs) {
          try {
            const buffer = await gmailClient.getAttachment(messageId, pdf.attachmentId);
            const outcome = await this.kioskDocumentService.createFromGmailAttachment({
              buffer,
              attachmentFilename: pdf.filename,
              gmailMessageId: messageId,
              gmailInternalDateMs,
            });
            if (outcome.status === 'imported') {
              if (outcome.mode === 'created') {
                summary.pdfsImported += 1;
              } else {
                summary.pdfsUpdated += 1;
              }
            } else if (outcome.reason === 'duplicate_same_mail') {
              summary.pdfsSkippedDuplicate += 1;
            } else {
              summary.pdfsSkippedOlderMail += 1;
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
            const outcome = await this.kioskDocumentService.createFromGmailHtmlAttachment({
              htmlBuffer: buffer,
              attachmentFilename: htmlPart.filename,
              gmailMessageId: messageId,
              gmailInternalDateMs,
            });
            if (outcome.status === 'imported') {
              if (outcome.mode === 'created') {
                summary.htmlImported += 1;
              } else {
                summary.htmlUpdated += 1;
              }
            } else if (outcome.reason === 'duplicate_same_mail') {
              summary.htmlSkippedDuplicate += 1;
            } else {
              summary.htmlSkippedOlderMail += 1;
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
