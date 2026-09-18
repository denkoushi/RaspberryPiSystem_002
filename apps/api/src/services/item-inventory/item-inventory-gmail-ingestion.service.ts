import sharp from 'sharp';

import { InventoryImportOutcome, Prisma } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { prisma as defaultPrisma } from '../../lib/prisma.js';
import { PhotoStorage } from '../../lib/photo-storage.js';
import type { BackupConfig } from '../backup/backup-config.js';
import type { GmailMessage } from '../backup/gmail-api-client.js';
import { isItemInventoryGmailSubject } from '../gmail/gmail-subject-reservation.policy.js';
import { getGmailMessageFrom, ItemInventoryManifestError, resolveItemInventoryGmailPacket } from './item-inventory-gmail-packet-resolver.js';
import { buildItemInventoryGmailSearchQuery, extractEmail, ITEM_INVENTORY_BATCH_LIMIT, ITEM_INVENTORY_RETRY_DELAY_MS } from './item-inventory-ingestion.policy.js';
import type { ItemInventoryAttachmentClient } from './item-inventory-gmail-packet-resolver.js';

export type ItemInventoryGmailPort = ItemInventoryAttachmentClient & {
  searchMessagesAll: (query: string) => Promise<string[]>;
  getMessage: (messageId: string) => Promise<GmailMessage>;
  markAsRead?: (messageId: string) => Promise<void>;
  trashMessage: (messageId: string) => Promise<void>;
};

export type ItemInventoryCycleSummary = {
  scanned: number;
  processed: number;
  pending: number;
  duplicate: number;
  retryable: number;
  skipped: number;
  errors: string[];
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptySummary(): ItemInventoryCycleSummary {
  return { scanned: 0, processed: 0, pending: 0, duplicate: 0, retryable: 0, skipped: 0, errors: [] };
}

function isRetryable(record: { outcome: string; nextRetryAt: Date | null }, now: Date): boolean {
  return record.outcome === 'RETRYABLE' && (!record.nextRetryAt || record.nextRetryAt <= now);
}

function isProcessingStale(record: { outcome: string; updatedAt: Date }, now: Date): boolean {
  return record.outcome === 'PROCESSING' && record.updatedAt.getTime() <= now.getTime() - ITEM_INVENTORY_RETRY_DELAY_MS;
}

function isGmailMessageGone(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (typeof current !== 'object' || current === null) break;
    const candidate = current as { status?: unknown; code?: unknown; cause?: unknown; response?: { status?: unknown; statusCode?: unknown } };
    const status = candidate.status ?? candidate.code ?? candidate.response?.status ?? candidate.response?.statusCode;
    if (status === 404 || status === '404') return true;
    current = candidate.cause;
  }
  return false;
}

function shouldSkipRecord(
  record: { outcome: string; nextRetryAt: Date | null; updatedAt: Date; mailCleanupPending?: boolean; mailCleanupCompleted?: boolean } | null,
  now: Date,
  forceRetry = false,
): boolean {
  if (!record || forceRetry) return false;
  if (record.mailCleanupCompleted) return true;
  if (record.mailCleanupPending) return Boolean(record.nextRetryAt && record.nextRetryAt > now);
  if (['DUPLICATE', 'PENDING'].includes(record.outcome)) return false;
  if (['APPLIED', 'INVALID'].includes(record.outcome)) return true;
  if (record.outcome === 'PROCESSING') return !isProcessingStale(record, now);
  return !isRetryable(record, now);
}

export class ItemInventoryGmailIngestionService {
  private running = false;

  constructor(
    private readonly gmailFactory: (config: BackupConfig, options: { allowWait: boolean }) => Promise<ItemInventoryGmailPort>,
    private readonly db = defaultPrisma,
  ) {}

  async runOnce(options: { config: BackupConfig; allowWait: boolean; manual?: boolean; messageId?: string; forceRetry?: boolean }): Promise<ItemInventoryCycleSummary> {
    if (this.running) throw new Error('item inventory ingest is already running');
    if (!options.manual && !options.config.itemInventoryGmailIngest?.enabled) return emptySummary();
    this.running = true;
    const summary = emptySummary();
    try {
      const gmail = await this.gmailFactory(options.config, { allowWait: options.allowWait });
      const now = new Date();
      const searchedMessageIds = options.messageId
        ? [options.messageId]
        : await gmail.searchMessagesAll(buildItemInventoryGmailSearchQuery(options.config.itemInventoryGmailIngest ?? {
          enabled: false,
          subjectTokens: ['[ItemlistRaspi-photo]'],
        }));
      const cleanupRecords = options.messageId ? [] : await this.db.inventoryImportMessage.findMany({
        where: {
          OR: [
            { mailCleanupPending: true, OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }] },
            { outcome: { in: ['PENDING', 'DUPLICATE'] }, mailCleanupPending: false, mailCleanupCompleted: false },
          ],
        },
        orderBy: [{ nextRetryAt: 'asc' }, { updatedAt: 'asc' }],
        take: ITEM_INVENTORY_BATCH_LIMIT,
      });
      const messageIds = [...new Set([...searchedMessageIds, ...cleanupRecords.map((record) => record.gmailMessageId)])];
      summary.scanned = searchedMessageIds.length;
      const eligibleMessageIds: string[] = [];
      const cleanupOnlyMessageIds: string[] = [];
      for (const messageId of messageIds) {
        const record = await this.db.inventoryImportMessage.findUnique({ where: { gmailMessageId: messageId } });
        const forceRetry = options.forceRetry && options.messageId === messageId;
        if (record && !record.mailCleanupCompleted && (record.mailCleanupPending || ['PENDING', 'DUPLICATE'].includes(record.outcome))) {
          if (!shouldSkipRecord(record, now, forceRetry)) cleanupOnlyMessageIds.push(messageId);
        } else if (!shouldSkipRecord(record, now, forceRetry)) {
          eligibleMessageIds.push(messageId);
        }
      }
      const selectedMessageIds = eligibleMessageIds.slice(0, ITEM_INVENTORY_BATCH_LIMIT);
      if (selectedMessageIds.length < ITEM_INVENTORY_BATCH_LIMIT) {
        selectedMessageIds.push(...cleanupOnlyMessageIds.slice(0, ITEM_INVENTORY_BATCH_LIMIT - selectedMessageIds.length));
      }
      for (const messageId of selectedMessageIds) {
        // Gmail requests and photo writes are intentionally sequential to keep
        // source order deterministic and stay within the shared Gmail quota.
        // eslint-disable-next-line no-await-in-loop
        const result = await this.processMessage(gmail, messageId, options.config, options.forceRetry && options.messageId === messageId);
        if (result === 'pending') summary.pending++;
        else if (result === 'duplicate') summary.duplicate++;
        else if (result === 'retryable') summary.retryable++;
        else if (result === 'skipped') summary.skipped++;
        else summary.processed++;
      }
      return summary;
    } catch (error) {
      summary.errors.push(errorMessage(error));
      throw error;
    } finally {
      this.running = false;
    }
  }

  async retryRecord(recordId: string, options: { config: BackupConfig; allowWait: boolean }): Promise<ItemInventoryCycleSummary> {
    const record = await this.db.inventoryImportMessage.findUnique({ where: { id: recordId } });
    if (!record) throw new Error('item inventory import message not found');
    await this.db.inventoryImportMessage.update({ where: { id: recordId }, data: { nextRetryAt: null } });
    return this.runOnce({ ...options, manual: true, messageId: record.gmailMessageId, forceRetry: true });
  }

  private async processMessage(gmail: ItemInventoryGmailPort, messageId: string, config: BackupConfig, forceRetry = false): Promise<'pending' | 'duplicate' | 'retryable' | 'skipped' | 'processed'> {
    const now = new Date();
    const existing = await this.db.inventoryImportMessage.findUnique({ where: { gmailMessageId: messageId } });
    if (existing && ['PENDING', 'DUPLICATE'].includes(existing.outcome)) {
      if (existing.mailCleanupCompleted || shouldSkipRecord(existing, now, forceRetry)) return 'skipped';
      return this.acknowledgeSuccessfulMessage(gmail, messageId, existing.outcome, existing.payloadId, existing.errorMessage);
    }
    if (shouldSkipRecord(existing, now, forceRetry)) return 'skipped';
    await this.db.inventoryImportMessage.upsert({
      where: { gmailMessageId: messageId },
      create: { gmailMessageId: messageId, outcome: 'PROCESSING' },
      update: { outcome: 'PROCESSING', errorMessage: null, nextRetryAt: null, mailCleanupPending: false, mailCleanupCompleted: false },
    });
    let message: GmailMessage;
    try {
      message = await gmail.getMessage(messageId);
    } catch (error) {
      await this.recordRetry(messageId, errorMessage(error));
      return 'retryable';
    }
    const subject = message.payload?.headers?.find((header) => header.name.toLowerCase() === 'subject')?.value ?? '';
    if (!isItemInventoryGmailSubject(subject)) {
      await this.db.inventoryImportMessage.update({ where: { gmailMessageId: messageId }, data: { outcome: 'INVALID', errorMessage: '件名トークンが一致しません' } });
      return 'skipped';
    }
    const expectedFrom = extractEmail(config.itemInventoryGmailIngest?.fromEmail);
    if (expectedFrom && extractEmail(getGmailMessageFrom(message)) !== expectedFrom) {
      await this.db.inventoryImportMessage.update({ where: { gmailMessageId: messageId }, data: { outcome: 'INVALID', errorMessage: '送信元が設定と一致しません' } });
      return 'skipped';
    }
    let packet;
    try {
      packet = await resolveItemInventoryGmailPacket({ message, client: gmail });
    } catch (error) {
      const messageText = errorMessage(error);
      const invalid = error instanceof ItemInventoryManifestError;
      await this.recordRetry(messageId, messageText, invalid ? '添付を修正して再試行できます' : undefined);
      return 'retryable';
    }
    const duplicate = await this.db.inventoryImportPayload.findUnique({ where: { contentHash: packet.contentHash } });
    if (duplicate) {
      await this.db.inventoryImportMessage.update({
        where: { gmailMessageId: messageId },
        data: { outcome: 'DUPLICATE', payloadId: duplicate.id, errorMessage: null, nextRetryAt: null, mailCleanupPending: false, mailCleanupCompleted: false },
      });
      return this.acknowledgeSuccessfulMessage(gmail, messageId, 'DUPLICATE', duplicate.id);
    }
      const storedPhotos: Array<{ photoIndex: number; filename: string; photoUrl: string; sha256: string }> = [];
    try {
      for (const photo of packet.photos) {
        // eslint-disable-next-line no-await-in-loop
        const thumbnail = await sharp(photo.buffer).resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
        // eslint-disable-next-line no-await-in-loop
        const saved = await PhotoStorage.savePhoto('inventory-import', photo.buffer, thumbnail);
        storedPhotos.push({ photoIndex: photo.index, filename: photo.filename, photoUrl: saved.relativePath, sha256: photo.sha256 });
      }
      const payload = await this.db.inventoryImportPayload.create({
        data: {
          contentHash: packet.contentHash,
          sourceSystem: packet.manifest.source.system,
          sourceList: packet.manifest.source.list,
          sourceItemId: packet.manifest.source.item_id,
          sourceModified: new Date(packet.manifest.source.modified),
          area: packet.manifest.location,
          category: packet.manifest.category,
          note: packet.manifest.note,
          manifest: packet.manifest as unknown as Prisma.InputJsonValue,
          photos: { create: storedPhotos },
        },
      });
      return this.acknowledgeSuccessfulMessage(gmail, messageId, 'PENDING', payload.id);
    } catch (error) {
      // A unique race means another worker already accepted the same payload.
      const raced = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (raced) {
        const payload = await this.db.inventoryImportPayload.findUnique({ where: { contentHash: packet.contentHash } });
        if (payload) {
          return this.acknowledgeSuccessfulMessage(gmail, messageId, 'DUPLICATE', payload.id);
        }
      }
      await this.recordRetry(messageId, errorMessage(error));
      return 'retryable';
    }
  }

  private async recordRetry(messageId: string, messageText: string, prefix?: string): Promise<void> {
    await this.db.inventoryImportMessage.upsert({
      where: { gmailMessageId: messageId },
      create: {
        gmailMessageId: messageId,
        outcome: 'RETRYABLE',
        errorMessage: prefix ? `${prefix}: ${messageText}` : messageText,
        nextRetryAt: new Date(Date.now() + ITEM_INVENTORY_RETRY_DELAY_MS),
        mailCleanupPending: false,
        mailCleanupCompleted: false,
      },
      update: {
        outcome: 'RETRYABLE',
        errorMessage: prefix ? `${prefix}: ${messageText}` : messageText,
        nextRetryAt: new Date(Date.now() + ITEM_INVENTORY_RETRY_DELAY_MS),
        mailCleanupPending: false,
        mailCleanupCompleted: false,
      },
    });
    logger.warn({ messageId, error: messageText }, '[ItemInventoryGmailIngestion] message is retryable');
  }

  private async acknowledgeSuccessfulMessage(
    gmail: ItemInventoryGmailPort,
    messageId: string,
    outcome: InventoryImportOutcome,
    payloadId?: string | null,
    errorMessageText?: string | null,
  ): Promise<'pending' | 'duplicate'> {
    await this.db.inventoryImportMessage.update({
      where: { gmailMessageId: messageId },
      data: {
        outcome,
        ...(payloadId ? { payloadId } : {}),
        errorMessage: errorMessageText ?? null,
        nextRetryAt: new Date(Date.now() + ITEM_INVENTORY_RETRY_DELAY_MS),
        mailCleanupPending: true,
        mailCleanupCompleted: false,
      },
    });
    try {
      let messageGone = false;
      if (gmail.markAsRead) {
        try {
          await gmail.markAsRead(messageId);
        } catch (error) {
          if (!isGmailMessageGone(error)) throw error;
          messageGone = true;
        }
      }
      if (!messageGone) {
        try {
          await gmail.trashMessage(messageId);
        } catch (error) {
          if (!isGmailMessageGone(error)) throw error;
        }
      }
      await this.db.inventoryImportMessage.update({
        where: { gmailMessageId: messageId },
        data: { nextRetryAt: null, mailCleanupPending: false, mailCleanupCompleted: true },
      });
    } catch (error) {
      const reason = errorMessage(error);
      await this.db.inventoryImportMessage.update({
        where: { gmailMessageId: messageId },
        data: {
          errorMessage: errorMessageText ? `${errorMessageText}; mail cleanup: ${reason}` : `mail cleanup: ${reason}`,
          nextRetryAt: new Date(Date.now() + ITEM_INVENTORY_RETRY_DELAY_MS),
          mailCleanupPending: true,
          mailCleanupCompleted: false,
        },
      });
      logger.warn({ err: error, messageId }, '[ItemInventoryGmailIngestion] accepted message mail cleanup is pending');
    }
    return outcome === 'DUPLICATE' ? 'duplicate' : 'pending';
  }
}
