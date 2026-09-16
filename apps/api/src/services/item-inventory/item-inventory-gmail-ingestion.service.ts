import sharp from 'sharp';

import { Prisma } from '@prisma/client';
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

function shouldSkipRecord(
  record: { outcome: string; nextRetryAt: Date | null; updatedAt: Date } | null,
  now: Date,
  forceRetry = false,
): boolean {
  if (!record || forceRetry) return false;
  if (['APPLIED', 'DUPLICATE', 'INVALID', 'PENDING'].includes(record.outcome)) return true;
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
      const messageIds = options.messageId
        ? [options.messageId]
        : await gmail.searchMessagesAll(buildItemInventoryGmailSearchQuery(options.config.itemInventoryGmailIngest ?? {
          enabled: false,
          subjectTokens: ['[ItemlistRaspi-photo]'],
        }));
      summary.scanned = messageIds.length;
      const now = new Date();
      const eligibleMessageIds: string[] = [];
      for (const messageId of messageIds) {
        const record = await this.db.inventoryImportMessage.findUnique({ where: { gmailMessageId: messageId } });
        if (!shouldSkipRecord(record, now, options.forceRetry && options.messageId === messageId)) {
          eligibleMessageIds.push(messageId);
        }
        if (eligibleMessageIds.length >= ITEM_INVENTORY_BATCH_LIMIT) break;
      }
      for (const messageId of eligibleMessageIds) {
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
    if (shouldSkipRecord(existing, now, forceRetry)) return 'skipped';
    await this.db.inventoryImportMessage.upsert({
      where: { gmailMessageId: messageId },
      create: { gmailMessageId: messageId, outcome: 'PROCESSING' },
      update: { outcome: 'PROCESSING', errorMessage: null, nextRetryAt: null },
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
        data: { outcome: 'DUPLICATE', payloadId: duplicate.id, errorMessage: null, nextRetryAt: null },
      });
      return 'duplicate';
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
      await this.db.inventoryImportMessage.update({ where: { gmailMessageId: messageId }, data: { outcome: 'PENDING', payloadId: payload.id, errorMessage: null, nextRetryAt: null } });
      if (gmail.markAsRead) {
        try {
          await gmail.markAsRead(messageId);
        } catch (error) {
          logger.warn({ err: error, messageId }, '[ItemInventoryGmailIngestion] accepted message could not be marked read');
        }
      }
      return 'pending';
    } catch (error) {
      // A unique race means another worker already accepted the same payload.
      const raced = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
      if (raced) {
        const payload = await this.db.inventoryImportPayload.findUnique({ where: { contentHash: packet.contentHash } });
        if (payload) {
          await this.db.inventoryImportMessage.update({ where: { gmailMessageId: messageId }, data: { outcome: 'DUPLICATE', payloadId: payload.id, errorMessage: null, nextRetryAt: null } });
          return 'duplicate';
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
      },
      update: {
        outcome: 'RETRYABLE',
        errorMessage: prefix ? `${prefix}: ${messageText}` : messageText,
        nextRetryAt: new Date(Date.now() + ITEM_INVENTORY_RETRY_DELAY_MS),
      },
    });
    logger.warn({ messageId, error: messageText }, '[ItemInventoryGmailIngestion] message is retryable');
  }
}
