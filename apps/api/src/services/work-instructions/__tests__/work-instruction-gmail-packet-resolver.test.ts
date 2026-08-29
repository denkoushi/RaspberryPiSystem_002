import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import type { GmailMessage } from '../../backup/gmail-api-client.js';
import {
  collectWorkInstructionAttachmentParts,
  resolveWorkInstructionGmailPacket,
} from '../work-instruction-gmail-packet-resolver.js';

function message(parts: NonNullable<GmailMessage['payload']>['parts']): GmailMessage {
  return {
    id: 'gmail-1',
    threadId: 'thread-1',
    labelIds: ['UNREAD'],
    snippet: '',
    internalDateMs: Date.now(),
    payload: { mimeType: 'multipart/mixed', parts },
  };
}

function attachmentPart(filename: string, attachmentId: string, mimeType = 'application/octet-stream') {
  return {
    filename,
    mimeType,
    body: { attachmentId },
    headers: [{ name: 'Content-Disposition', value: 'attachment' }],
  };
}

const manifest = {
  schema_version: 1,
  source: {
    system: 'SharePoint',
    list: 'WorkInstructions',
    item_id: 640,
    modified: '2026-08-29T01:02:03+09:00',
  },
  part_number: 'abc-1',
  shooting_target: '研削工程',
  steps: [{ step: 1, text: 'Inspect', image: 'photo.webp' }],
};

describe('work-instruction Gmail packet resolver', () => {
  it('resolves arbitrary manifest filenames and preserves image bytes', async () => {
    const image = await sharp({
      create: { width: 3, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).webp().toBuffer();
    const manifestBuffer = Buffer.from(JSON.stringify(manifest), 'utf8');
    const getAttachment = vi.fn(async (_messageId: string, attachmentId: string) =>
      attachmentId === 'manifest' ? manifestBuffer : image
    );
    const result = await resolveWorkInstructionGmailPacket({
      message: message([
        attachmentPart('640_manifest.json', 'manifest', 'application/json'),
        attachmentPart('photo.webp', 'image', 'application/octet-stream'),
        attachmentPart('unrelated.txt', 'unused', 'text/plain'),
      ]),
      client: { getAttachment },
    });

    expect(result.manifestFilename).toBe('640_manifest.json');
    expect(result.packet.partNumber).toBe('ABC-1');
    expect(result.packet.shootingTarget).toBe('研削');
    expect(result.assets).toHaveLength(1);
    expect(result.assetBytes.get(result.assets[0]!.assetId)).toEqual(image);
    expect(result.warnings).toEqual(['Unreferenced attachment ignored: unrelated.txt']);
    expect(getAttachment).toHaveBeenCalledTimes(2);
  });

  it('supports inline body.data and does not fetch unrelated extras', async () => {
    const image = await sharp({
      create: { width: 1, height: 1, channels: 3, background: 'red' },
    }).png().toBuffer();
    const inline = (buffer: Buffer, filename: string, mimeType: string) => ({
      filename,
      mimeType,
      body: { data: buffer.toString('base64url') },
      headers: [{ name: 'Content-Disposition', value: 'inline' }],
    });
    const getAttachment = vi.fn(async () => {
      throw new Error('must not fetch inline parts');
    });
    const result = await resolveWorkInstructionGmailPacket({
      message: message([
        inline(Buffer.from(JSON.stringify(manifest)), 'snapshot.json', 'application/json'),
        inline(image, 'photo.webp', 'image/png'),
        attachmentPart('unrelated.bin', 'unused'),
      ]),
      client: { getAttachment },
    });

    expect(result.assets).toHaveLength(1);
    expect(result.warnings).toEqual(['Unreferenced attachment ignored: unrelated.bin']);
    expect(getAttachment).not.toHaveBeenCalled();
  });

  it('rejects duplicate exact referenced filenames before downloading either image', async () => {
    const manifestBuffer = Buffer.from(JSON.stringify(manifest), 'utf8');
    const getAttachment = vi.fn(async (_messageId: string, attachmentId: string) => {
      if (attachmentId === 'manifest') return manifestBuffer;
      throw new Error('image should not be fetched');
    });
    await expect(resolveWorkInstructionGmailPacket({
      message: message([
        attachmentPart('snapshot.json', 'manifest', 'application/json'),
        attachmentPart('photo.webp', 'image-a', 'image/webp'),
        attachmentPart('photo.webp', 'image-b', 'image/webp'),
      ]),
      client: { getAttachment },
    })).rejects.toThrow('not unique');
    expect(getAttachment).toHaveBeenCalledTimes(1);
  });

  it('keeps work-instruction attachment tree duplicates visible to the validator', () => {
    const parts = collectWorkInstructionAttachmentParts(message([
      attachmentPart('photo.webp', 'same', 'image/webp'),
      attachmentPart('photo.webp', 'same', 'image/webp'),
    ]));
    expect(parts).toHaveLength(2);
  });
});
