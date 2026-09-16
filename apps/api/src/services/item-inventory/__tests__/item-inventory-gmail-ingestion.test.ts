import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

const { resolvePacketMock, savePhotoMock } = vi.hoisted(() => ({
  resolvePacketMock: vi.fn(),
  savePhotoMock: vi.fn(),
}));

vi.mock('../item-inventory-gmail-packet-resolver.js', () => ({
  resolveItemInventoryGmailPacket: resolvePacketMock,
  ItemInventoryManifestError: class ItemInventoryManifestError extends Error {},
}));
vi.mock('../../../lib/photo-storage.js', () => ({ PhotoStorage: { savePhoto: savePhotoMock } }));

import { ItemInventoryGmailIngestionService } from '../item-inventory-gmail-ingestion.service.js';

const validPacket = {
  manifest: {
    schema_version: 1,
    source: { system: 'sharepoint', list: 'ItemlistRaspi', item_id: 2, modified: '2026-09-16T06:54:14Z' },
    id: 2,
    category: '治具',
    location: '30007_KSJP-55',
    note: 'ppp',
    photos: [{ index: 1, image: '2_photo_1.jpeg' }],
  },
  manifestFilename: '2_manifest.json',
  contentHash: 'a'.repeat(64),
  photos: [{ index: 1, filename: '2_photo_1.jpeg', buffer: Buffer.from('jpeg'), sha256: 'b'.repeat(64) }],
  warnings: [],
};

function createFakeDb(records: Map<string, { outcome: string; nextRetryAt: Date | null; updatedAt: Date; gmailMessageId?: string }>) {
  const messageStore = new Map(records);
  const payloadCreate = vi.fn().mockResolvedValue({ id: 'payload-1' });
  const db = {
    inventoryImportMessage: {
      findUnique: vi.fn(async ({ where }: { where: { gmailMessageId?: string; id?: string } }) => {
        const key = where.gmailMessageId ?? where.id;
        return key ? messageStore.get(key) ?? null : null;
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { gmailMessageId: string }; create: any; update: any }) => {
        const value = { ...(messageStore.get(where.gmailMessageId) ?? create), ...update };
        messageStore.set(where.gmailMessageId, value);
        return value;
      }),
      update: vi.fn(async ({ where, data }: { where: { gmailMessageId?: string; id?: string }; data: any }) => {
        const key = where.gmailMessageId ?? where.id!;
        const value = { ...(messageStore.get(key) ?? {}), ...data };
        messageStore.set(key, value);
        return value;
      }),
    },
    inventoryImportPayload: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: payloadCreate,
    },
  };
  return { db, payloadCreate };
}

function config() {
  return { itemInventoryGmailIngest: { enabled: true, subjectTokens: ['[ItemlistRaspi-photo]'] } } as any;
}

describe('ItemInventoryGmailIngestionService', () => {
  it('selects older new messages after settled entries instead of starving the batch', async () => {
    const ids = Array.from({ length: 20 }, (_, index) => `settled-${index}`).concat('valid-message');
    const records = new Map(ids.slice(0, 20).map((id) => [id, { outcome: 'DUPLICATE', nextRetryAt: null, updatedAt: new Date() }]));
    const { db, payloadCreate } = createFakeDb(records);
    const jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).jpeg().toBuffer();
    resolvePacketMock.mockResolvedValue({ ...validPacket, photos: [{ ...validPacket.photos[0], buffer: jpeg }] });
    savePhotoMock.mockResolvedValue({ relativePath: '/api/storage/photos/2026/09/photo.jpg' });
    const gmail = {
      searchMessagesAll: vi.fn().mockResolvedValue(ids),
      getMessage: vi.fn().mockResolvedValue({ payload: { headers: [{ name: 'Subject', value: '[ItemlistRaspi-photo] 2' }] } }),
      getAttachment: vi.fn(),
    };
    const service = new ItemInventoryGmailIngestionService(vi.fn().mockResolvedValue(gmail), db as never);

    await expect(service.runOnce({ config: config(), allowWait: true })).resolves.toMatchObject({ scanned: 21, pending: 1 });
    expect(gmail.getMessage).toHaveBeenCalledTimes(1);
    expect(gmail.getMessage).toHaveBeenCalledWith('valid-message');
    expect(payloadCreate).toHaveBeenCalledTimes(1);
  });

  it('allows an explicit retry to recover a PROCESSING record', async () => {
    const records = new Map([['processing-message', { gmailMessageId: 'processing-message', outcome: 'PROCESSING', nextRetryAt: null, updatedAt: new Date() }]]);
    const { db, payloadCreate } = createFakeDb(records);
    const jpeg = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'white' } }).jpeg().toBuffer();
    resolvePacketMock.mockResolvedValue({ ...validPacket, photos: [{ ...validPacket.photos[0], buffer: jpeg }] });
    savePhotoMock.mockResolvedValue({ relativePath: '/api/storage/photos/2026/09/photo.jpg' });
    const gmail = {
      searchMessagesAll: vi.fn(),
      getMessage: vi.fn().mockResolvedValue({ payload: { headers: [{ name: 'Subject', value: '[ItemlistRaspi-photo] 2' }] } }),
      getAttachment: vi.fn(),
    };
    const service = new ItemInventoryGmailIngestionService(vi.fn().mockResolvedValue(gmail), db as never);

    await expect(service.retryRecord('processing-message', { config: config(), allowWait: true })).resolves.toMatchObject({ pending: 1 });
    expect(payloadCreate).toHaveBeenCalledTimes(1);
  });
});
