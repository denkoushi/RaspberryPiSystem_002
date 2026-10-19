import { logger } from '../../lib/logger.js';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { BackupConfig } from '../backup/backup-config.js';
import { collectGmailAttachments, type GmailMessage } from '../backup/gmail-api-client.js';
import { resolveGmailApiClientFromBackupConfig } from '../gmail/gmail-api-client.factory.js';
import { MACHINE_SIGNAL_GMAIL_SUBJECT } from '../gmail/gmail-subject-reservation.policy.js';
import {
  importSignalReportFiles,
  type SignalReportFile,
  type SignalReportImportSummary,
} from './signal-report-import.service.js';

/** 1回の実行で処理するメール数。1通あたり添付の数だけ Gmail を呼ぶので小さく保つ。 */
export const MACHINE_SIGNAL_GMAIL_BATCH_LIMIT = 3;
export const MACHINE_SIGNAL_GMAIL_QUERY = `subject:"${MACHINE_SIGNAL_GMAIL_SUBJECT}" in:inbox is:unread`;

export type MachineSignalGmailPort = {
  searchMessagesLimited: (query: string, maxResults: number) => Promise<string[]>;
  getMessage: (messageId: string) => Promise<GmailMessage>;
  getAttachment: (messageId: string, attachmentId: string) => Promise<Buffer>;
  markAsRead: (messageId: string) => Promise<void>;
  trashMessage: (messageId: string) => Promise<void>;
};

export type MachineSignalGmailCycleSummary = {
  scanned: number;
  processed: number;
  /** 以前に1件も読めなかったメール。繰り返し処理しないよう飛ばした数 */
  skipped: number;
  runs: SignalReportImportSummary[];
};

type ImportFiles = typeof importSignalReportFiles;

/** backup.json に Gmail の認証情報があるか。無い環境（開発機など）では取り込みを動かさない。 */
export function hasGmailCredentials(config: BackupConfig): boolean {
  const gmail = config.storage.options?.gmail;
  return Boolean(gmail?.refreshToken && gmail.clientId);
}

/**
 * 件名 AirGridFlexSignal のメールから、添付の日報CSVをすべて取り込む。
 * 保存できたメールだけ既読にしてゴミ箱へ移す。1件も読めなかったメールは受信箱に残し、次回からは飛ばす。
 */
export class MachineSignalGmailIngestionService {
  private running = false;

  constructor(
    private readonly gmailFactory: (
      config: BackupConfig,
      options: { allowWait: boolean }
    ) => Promise<MachineSignalGmailPort> = resolveGmailApiClientFromBackupConfig,
    private readonly importFiles: ImportFiles = importSignalReportFiles,
    private readonly db: Pick<typeof defaultPrisma, 'machineSignalImportRun'> = defaultPrisma
  ) {}

  async runOnce(options: { config: BackupConfig; allowWait: boolean }): Promise<MachineSignalGmailCycleSummary> {
    const summary: MachineSignalGmailCycleSummary = { scanned: 0, processed: 0, skipped: 0, runs: [] };
    if (this.running) return summary;
    this.running = true;
    try {
      const gmail = await this.gmailFactory(options.config, { allowWait: options.allowWait });
      const messageIds = await gmail.searchMessagesLimited(MACHINE_SIGNAL_GMAIL_QUERY, MACHINE_SIGNAL_GMAIL_BATCH_LIMIT);
      summary.scanned = messageIds.length;

      for (const messageId of messageIds) {
        const failedBefore = await this.db.machineSignalImportRun.findFirst({
          where: { gmailMessageId: messageId, status: 'FAILED' },
          select: { id: true },
        });
        if (failedBefore && !options.allowWait) {
          summary.skipped += 1;
          continue;
        }

        const message = await gmail.getMessage(messageId);
        const attachments = collectGmailAttachments(message).filter(
          (attachment) => !attachment.isInline && attachment.filename.toLowerCase().endsWith('.csv')
        );
        const files: SignalReportFile[] = [];
        for (const attachment of attachments) {
          // 共有の Gmail 利用枠を守るため、添付は1つずつ順に取る。
          files.push({
            fileName: attachment.filename,
            content: await gmail.getAttachment(messageId, attachment.attachmentId),
          });
        }

        const run = await this.importFiles(files, { source: 'GMAIL', gmailMessageId: messageId });
        summary.runs.push(run);
        summary.processed += 1;
        if (run.importedCount === 0) {
          logger?.warn({ messageId, fileCount: run.fileCount }, '[MachineSignalGmail] No report could be imported');
          continue;
        }
        await gmail.markAsRead(messageId);
        await gmail.trashMessage(messageId);
      }
      return summary;
    } finally {
      this.running = false;
    }
  }
}

let instance: MachineSignalGmailIngestionService | null = null;

export function getMachineSignalGmailIngestionService(): MachineSignalGmailIngestionService {
  instance ??= new MachineSignalGmailIngestionService();
  return instance;
}
