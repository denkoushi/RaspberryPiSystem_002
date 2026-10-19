import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import type { GmailMessage } from '../../backup/gmail-api-client.js';
import { resolveItemInventoryGmailPacket } from '../item-inventory-gmail-packet-resolver.js';
import { isItemInventoryGmailSubject } from '../../gmail/gmail-subject-reservation.policy.js';

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 40, b: 80 } } }).jpeg().toBuffer();
}

function message(manifest: unknown, imageName = '2_photo_1.jpeg', image: Buffer = Buffer.from('not-used')): GmailMessage {
  const inline = (filename: string, mimeType: string, data: Buffer) => ({ filename, mimeType, body: { data: data.toString('base64url') } });
  return {
    id: 'gmail-1', threadId: 'thread-1', labelIds: ['INBOX'], snippet: '', internalDateMs: Date.now(),
    payload: {
      mimeType: 'multipart/mixed',
      parts: [
        inline('2_manifest.json', 'application/json', Buffer.from(JSON.stringify(manifest), 'utf8')),
        inline(imageName, 'image/jpeg', image),
      ],
    },
  };
}

const validManifest = {
  schema_version: 1,
  source: { system: 'sharepoint', list: 'ItemlistRaspi', item_id: 2, modified: '2026-09-16T06:54:14Z' },
  id: 2,
  category: '治具',
  location: '30007_KSJP-55',
  note: 'ppp',
  photos: [{ index: 1, image: '2_photo_1.jpeg' }],
};

describe('resolveItemInventoryGmailPacket', () => {
  it('owns only the fixed subject token and its suffix boundary', () => {
    expect(isItemInventoryGmailSubject('[ItemlistRaspi-photo] 2')).toBe(true);
    expect(isItemInventoryGmailSubject('[ItemlistRaspi-photo]\t2026-09-16')).toBe(true);
    expect(isItemInventoryGmailSubject('prefix [ItemlistRaspi-photo]')).toBe(false);
    expect(isItemInventoryGmailSubject('[ItemlistRaspi-photo]x')).toBe(false);
  });

  it('accepts the ItemlistRaspi contract and pairs referenced JPEGs by filename', async () => {
    const image = await jpeg();
    const packet = await resolveItemInventoryGmailPacket({ message: message(validManifest, '2_photo_1.jpeg', image), client: { getAttachment: async () => image } });
    expect(packet.manifest.source.list).toBe('ItemlistRaspi');
    expect(packet.manifest.location).toBe('30007_KSJP-55');
    expect(packet.photos).toHaveLength(1);
    expect(packet.photos[0]?.filename).toBe('2_photo_1.jpeg');
    expect(packet.photos[0]?.buffer).toEqual(image);
  });

  it('rejects a missing referenced image and non-JPEG referenced data', async () => {
    const image = await jpeg();
    await expect(resolveItemInventoryGmailPacket({ message: message(validManifest, 'other.jpeg', image), client: { getAttachment: async () => image } })).rejects.toThrow('missing');
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 20, g: 40, b: 80 } } }).png().toBuffer();
    const pngMessage = message(validManifest, '2_photo_1.jpeg', png);
    await expect(resolveItemInventoryGmailPacket({ message: pngMessage, client: { getAttachment: async () => png } })).rejects.toThrow('must be a JPEG');
  });

  it('produces the same content hash when JSON object key order changes', async () => {
    const image = await jpeg();
    const reordered = {
      photos: [{ image: '2_photo_1.jpeg', index: 1 }], note: 'ppp', location: '30007_KSJP-55', id: 2,
      category: '治具', source: { modified: '2026-09-16T06:54:14Z', item_id: 2, list: 'ItemlistRaspi', system: 'sharepoint' }, schema_version: 1,
    };
    const first = await resolveItemInventoryGmailPacket({ message: message(validManifest, '2_photo_1.jpeg', image), client: { getAttachment: async () => image } });
    const second = await resolveItemInventoryGmailPacket({ message: message(reordered, '2_photo_1.jpeg', image), client: { getAttachment: async () => image } });
    expect(second.contentHash).toBe(first.contentHash);
  });
});
