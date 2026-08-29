import { describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';

import type { GmailMessage, GmailMessagePart } from '../../backup/gmail-api-client.js';
import { WorkInstructionManifestError } from '../domain/manifest.js';
import { resolveWorkInstructionGmailPacket } from '../work-instruction-gmail-packet-resolver.js';

const manifest = {
  schema_version: 1,
  source: { system: 'sharepoint', list: '工程Ａ', item_id: 640, modified: '2026-08-29T00:00:00Z' },
  part_number: 'MD004144628',
  shooting_target: '研削工程',
  steps: [{ step: 1, text: '締結\n確認', image: '640_photo_1.jpeg' }],
};

function part(filename: string, data: Buffer, mimeType = 'application/octet-stream'): GmailMessagePart {
  return { filename, mimeType, body: { data: data.toString('base64url') } };
}

function packet(parts: GmailMessagePart[]): GmailMessage {
  return { id: 'boundary-mail', threadId: 'thread', labelIds: ['INBOX'], snippet: '', payload: { parts } };
}

function jsonPart(value: unknown = manifest, filename = '640_manifest.json'): GmailMessagePart {
  return part(filename, Buffer.from(JSON.stringify(value)), 'application/json');
}

const noDownload = () => ({ getAttachment: vi.fn(async () => { throw new Error('unexpected download'); }) });

describe('work instruction packet acceptance boundaries', () => {
  it('classifies a corrupt required image as invalid input, not a transient I/O failure', async () => {
    await expect(resolveWorkInstructionGmailPacket({
      message: packet([jsonPart(), part('640_photo_1.jpeg', Buffer.from('broken jpeg'))]),
      client: noDownload(),
    })).rejects.toBeInstanceOf(WorkInstructionManifestError);
  });

  it('rejects a missing required image without accepting an unrelated signature', async () => {
    const client = noDownload();
    await expect(resolveWorkInstructionGmailPacket({
      message: packet([jsonPart(), { filename: 'signature.jpeg', body: { attachmentId: 'unused' } }]),
      client,
    })).rejects.toBeInstanceOf(WorkInstructionManifestError);
    expect(client.getAttachment).not.toHaveBeenCalled();
  });

  it('requires exactly one manifest and never guesses identity from attachment names', async () => {
    for (const parts of [[], [jsonPart(), jsonPart(manifest, 'copy.json')], [jsonPart({ ...manifest, source: undefined })]]) {
      await expect(resolveWorkInstructionGmailPacket({ message: packet(parts), client: noDownload() }))
        .rejects.toBeInstanceOf(WorkInstructionManifestError);
    }
  });

  it('uses one byte-identical asset when several steps explicitly reference the same image', async () => {
    const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).jpeg().toBuffer();
    const result = await resolveWorkInstructionGmailPacket({
      message: packet([
        jsonPart({ ...manifest, steps: [...manifest.steps, { ...manifest.steps[0], step: 2, text: '再確認' }] }),
        { ...part('640_photo_1.jpeg', image), headers: [{ name: 'Content-Disposition', value: 'inline' }] },
      ]),
      client: noDownload(),
    });
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]?.mimeType).toBe('image/jpeg');
    expect(result.assetBytes.get(result.assets[0]!.assetId)).toEqual(image);
    expect(result.packet.steps[0]?.imageHash).toBe(result.packet.steps[1]?.imageHash);
    expect(result.packet.steps[0]?.text).toBe('締結\n確認');
    expect(result.packet.source.list).toBe('工程Ａ');
  });

  it('accepts complete empty and text-only snapshots with no image request', async () => {
    const client = noDownload();
    for (const steps of [[], [{ step: 1, text: '', image: null }]]) {
      const result = await resolveWorkInstructionGmailPacket({
        message: packet([jsonPart({ ...manifest, steps })]), client,
      });
      expect(result.packet.steps).toHaveLength(steps.length);
      expect(result.assets).toEqual([]);
    }
    expect(client.getAttachment).not.toHaveBeenCalled();
  });
});
