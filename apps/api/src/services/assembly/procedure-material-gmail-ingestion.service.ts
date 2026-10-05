import { Prisma } from '@prisma/client';

import { prisma as defaultPrisma } from '../../lib/prisma.js';
import type { BackupConfig } from '../backup/backup-config.js';
import type { GmailMessage } from '../backup/gmail-api-client.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { FileStorageAlreadyExistsError } from '../file-storage/file-storage-errors.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { resolveGmailApiClientFromBackupConfig } from '../gmail/gmail-api-client.factory.js';
import { getProcedureMaterialSubjectHint, isProcedureMaterialGmailSubject, PROCEDURE_MATERIAL_GMAIL_SUBJECT_TOKENS } from '../gmail/gmail-subject-reservation.policy.js';
import { escapeGmailQuotedSearchValue, extractEmail } from '../item-inventory/item-inventory-ingestion.policy.js';
import { materialMessageHeader, resolveProcedureMaterialGmailPacket, type ProcedureMaterialAttachmentClient } from './procedure-material-gmail-packet-resolver.js';

export type ProcedureMaterialGmailPort = ProcedureMaterialAttachmentClient & {
  searchMessagesAll: (query: string) => Promise<string[]>;
  getMessage: (messageId: string) => Promise<GmailMessage>;
  trashMessage: (messageId: string) => Promise<void>;
};
export type ProcedureMaterialMessageResult = {
  messageId: string; status: 'saved' | 'duplicate' | 'skipped' | 'retryable'; reason?: string;
  saved: number; duplicate: number; skippedAttachments: number; trashed: boolean; warnings: string[];
};
export type ProcedureMaterialCycleSummary = {
  scanned: number; processed: number; saved: number; duplicate: number; skipped: number; retryable: number;
  skippedAttachments: number; errors: string[]; messages: ProcedureMaterialMessageResult[];
};
const RETRY_DELAY_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 20;

export function buildProcedureMaterialGmailSearchQuery(config?: BackupConfig['procedureMaterialGmailIngest']): string {
  const tokens = config?.subjectTokens.filter((token) => (PROCEDURE_MATERIAL_GMAIL_SUBJECT_TOKENS as readonly string[]).includes(token)) ?? [];
  const effective = tokens.length ? tokens : PROCEDURE_MATERIAL_GMAIL_SUBJECT_TOKENS;
  return `(${effective.map((token) => `subject:"${escapeGmailQuotedSearchValue(token)}"`).join(' OR ')}) in:inbox is:unread`;
}

export class ProcedureMaterialGmailIngestionService {
  private running = false;
  // Failed and skipped messages remain unread in the inbox, which is the durable retry queue.
  private readonly retryAt = new Map<string, number>();
  constructor(
    private readonly gmailFactory: (config: BackupConfig, options: { allowWait: boolean }) => Promise<ProcedureMaterialGmailPort>,
    private readonly db = defaultPrisma,
    private readonly store: DurableFileStorePort = getFileStorageRuntime().store,
  ) {}

  async runOnce(options: { config: BackupConfig; allowWait: boolean; manual?: boolean; messageId?: string; forceRetry?: boolean }): Promise<ProcedureMaterialCycleSummary> {
    if (this.running) throw new Error('procedure material ingest is already running');
    const summary: ProcedureMaterialCycleSummary = { scanned: 0, processed: 0, saved: 0, duplicate: 0, skipped: 0, retryable: 0, skippedAttachments: 0, errors: [], messages: [] };
    if (!options.manual && !options.config.procedureMaterialGmailIngest?.enabled) return summary;
    this.running = true;
    try {
      const gmail = await this.gmailFactory(options.config, { allowWait: options.allowWait });
      const ids = [...new Set(options.messageId ? [options.messageId] : await gmail.searchMessagesAll(buildProcedureMaterialGmailSearchQuery(options.config.procedureMaterialGmailIngest)))];
      summary.scanned = ids.length;
      const eligible = ids.filter((id) => (options.forceRetry && options.messageId === id) || (this.retryAt.get(id) ?? 0) <= Date.now()).slice(0, BATCH_LIMIT);
      for (const id of eligible) {
        // eslint-disable-next-line no-await-in-loop
        const result = await this.processMessage(gmail, id, options.config);
        summary.messages.push(result);
        summary.processed++;
        summary.saved += result.saved;
        summary.duplicate += result.duplicate;
        summary.skippedAttachments += result.skippedAttachments;
        if (result.status === 'skipped') {
          summary.skipped++;
          this.retryAt.set(id, Date.now() + RETRY_DELAY_MS);
        }
        if (result.status === 'retryable') { summary.retryable++; summary.errors.push(`${id}: ${result.reason}`); }
      }
      return summary;
    } finally { this.running = false; }
  }

  private async processMessage(gmail: ProcedureMaterialGmailPort, messageId: string, config: BackupConfig): Promise<ProcedureMaterialMessageResult> {
    const result: ProcedureMaterialMessageResult = { messageId, status: 'skipped', saved: 0, duplicate: 0, skippedAttachments: 0, trashed: false, warnings: [] };
    try {
      const message = await gmail.getMessage(messageId);
      const subject = materialMessageHeader(message, 'subject');
      if (!isProcedureMaterialGmailSubject(subject)) return { ...result, reason: '件名トークンが一致しません' };
      const fromEmail = extractEmail(materialMessageHeader(message, 'from')) ?? null;
      const expectedFrom = extractEmail(config.procedureMaterialGmailIngest?.fromEmail);
      if (expectedFrom && fromEmail !== expectedFrom) return { ...result, reason: '送信元が設定と一致しません' };
      const existing = await this.db.procedureMaterial.findMany({ where: { gmailMessageId: messageId }, select: { gmailDedupeKey: true } });
      const packet = await resolveProcedureMaterialGmailPacket({ message, client: gmail, savedKeys: new Set(existing.map((row) => row.gmailDedupeKey)) });
      result.duplicate = packet.duplicate;
      result.skippedAttachments = packet.skippedAttachments;
      result.warnings = packet.warnings;
      const common = { gmailMessageId: messageId, fromEmail, subjectHint: getProcedureMaterialSubjectHint(subject), receivedAt: new Date(message.internalDateMs) };
      const save = async (data: Prisma.ProcedureMaterialCreateInput) => {
        try { await this.db.procedureMaterial.create({ data }); result.saved++; }
        catch (error) {
          if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
          const raced = await this.db.procedureMaterial.findUnique({ where: { gmailDedupeKey: data.gmailDedupeKey } });
          if (!raced) throw error;
          result.duplicate++;
        }
      };
      if (packet.text) await save({ ...common, kind: 'TEXT', text: packet.text, gmailDedupeKey: `${messageId}:body` });
      for (const photo of packet.photos) {
        const storageKey = `procedure-materials/${photo.sha256}/original`;
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.store.write({ key: storageKey, data: photo.buffer, mode: 'create', integrity: true });
        } catch (error) {
          if (!(error instanceof FileStorageAlreadyExistsError)) throw error;
          // eslint-disable-next-line no-await-in-loop
          const bytes = await this.store.read(storageKey, { verifyIntegrity: true });
          if (!bytes.equals(photo.buffer)) throw new Error('Procedure material identity conflict');
        }
        // eslint-disable-next-line no-await-in-loop
        await save({ ...common, kind: 'PHOTO', gmailDedupeKey: photo.gmailDedupeKey, storageKey, sha256: photo.sha256, contentType: photo.contentType, byteSize: photo.buffer.length, originalFileName: photo.filename, width: photo.width, height: photo.height });
      }
      if (result.saved + result.duplicate === 0) return { ...result, reason: '本文が空で、対応する写真がありません' };
      // Never mark as read: cleanup failures must remain searchable after a restart.
      await gmail.trashMessage(messageId);
      result.trashed = true;
      result.status = result.saved ? 'saved' : 'duplicate';
      this.retryAt.delete(messageId);
      return result;
    } catch (error) {
      this.retryAt.set(messageId, Date.now() + RETRY_DELAY_MS);
      return { ...result, status: 'retryable', reason: error instanceof Error ? error.message : String(error) };
    }
  }
}

let ingestion: ProcedureMaterialGmailIngestionService | undefined;
export function getProcedureMaterialGmailIngestionService(): ProcedureMaterialGmailIngestionService {
  ingestion ??= new ProcedureMaterialGmailIngestionService(resolveGmailApiClientFromBackupConfig);
  return ingestion;
}
