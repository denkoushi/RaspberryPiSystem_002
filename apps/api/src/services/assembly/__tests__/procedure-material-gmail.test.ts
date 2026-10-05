import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { defaultBackupConfig, BackupConfigSchema } from '../../backup/backup-config.js';
import type { GmailMessage, GmailMessagePart } from '../../backup/gmail-api-client.js';
import { FileStorageAlreadyExistsError } from '../../file-storage/file-storage-errors.js';
import { buildProcedureMaterialGmailSearchQuery, ProcedureMaterialGmailIngestionService } from '../procedure-material-gmail-ingestion.service.js';
import { resolveProcedureMaterialGmailPacket } from '../procedure-material-gmail-packet-resolver.js';

let image: Buffer;
beforeAll(async () => { image = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'blue' } }).png().toBuffer(); });
const textPart = (text: string, mimeType = 'text/plain'): GmailMessagePart => ({ mimeType, body: { data: Buffer.from(text).toString('base64url') } });
const photoPart = (name = 'photo.png', overrides: Partial<GmailMessagePart> = {}): GmailMessagePart => ({ filename: name, mimeType: 'image/png', body: { attachmentId: name }, ...overrides });
function message(parts: GmailMessagePart[], subject = '[Procedure-material] DFD1 組立'): GmailMessage {
  return { id: 'mail-1', threadId: 'thread', labelIds: ['INBOX', 'UNREAD'], snippet: '', internalDateMs: Date.parse('2026-10-05T03:00:00Z'), payload: {
    mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: subject }, { name: 'From', value: '送信者 <sender@example.com>' }], parts,
  } };
}
const client = () => ({ getAttachment: vi.fn().mockImplementation(async () => image) });

describe('procedure-material Gmail packet', () => {
  it('resolves body only and prefers plain text to the alternative HTML', async () => {
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([{ ...textPart('  手順\n本文  '), headers: [{ name: 'Content-Disposition', value: 'inline' }] }, textPart('<p>別の本文</p>', 'text/html')]), client: client() });
    expect(packet.text).toBe('手順\n本文'); expect(packet.photos).toEqual([]);
  });
  it('converts HTML-only bodies to text, including entities and line breaks', async () => {
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([textPart('<style>x</style><p>手順 &amp; 写真</p><div>&#x7d44;&#31435;<br>次</div>', 'text/html')]), client: client() });
    expect(packet.text).toBe('手順 & 写真\n組立\n次');
  });
  it('resolves photo only with original hash and dimensions', async () => {
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart()]), client: client() });
    expect(packet.text).toBeNull(); expect(packet.photos[0]).toMatchObject({ width: 4, height: 3, contentType: 'image/png', sha256: createHash('sha256').update(image).digest('hex') });
  });
  it('resolves both body and multiple photos, including same-name attachments', async () => {
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([textPart('手順'), photoPart(), photoPart()]), client: client() });
    expect(packet.text).toBe('手順'); expect(packet.photos).toHaveLength(2);
    expect(packet.photos[0]?.gmailDedupeKey).not.toBe(packet.photos[1]?.gmailDedupeKey);
  });
  it('skips PDF, video, inline and oversized images without fetching their bytes', async () => {
    const attachmentClient = client();
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([
      photoPart('video.mp4', { mimeType: 'video/mp4' }), photoPart('file.pdf', { mimeType: 'application/pdf' }),
      photoPart('inline.png', { headers: [{ name: 'Content-Disposition', value: 'inline' }] }),
      photoPart('cid.png', { headers: [{ name: 'Content-ID', value: '<cid>' }] }),
      photoPart('large.png', { body: { attachmentId: 'large', size: 10 * 1024 * 1024 + 1 } }),
    ]), client: attachmentClient });
    expect(packet).toMatchObject({ text: null, photos: [], skippedAttachments: 5 });
    expect(attachmentClient.getAttachment).not.toHaveBeenCalled();
  });
  it('checks the actual size and skips corrupt images', async () => {
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValueOnce(Buffer.alloc(10 * 1024 * 1024 + 1)).mockResolvedValueOnce(Buffer.from('invalid')) };
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart('large.png'), photoPart('broken.png')]), client: attachmentClient });
    expect(packet.photos).toEqual([]); expect(packet.skippedAttachments).toBe(2);
  });
  it.each(['jpeg', 'webp'] as const)('accepts %s and small base64 MIME attachments', async (format) => {
    const bytes = await sharp(image).toFormat(format).toBuffer();
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart(`photo.${format}`, { mimeType: `image/${format}`, body: { data: bytes.toString('base64url') } })]), client: client() });
    expect(packet.photos).toHaveLength(1);
    expect(packet.photos[0]?.buffer).toEqual(bytes);
  });
});

function harness(parts: GmailMessagePart[] = [textPart('手順'), photoPart()]) {
  const rows: Array<Record<string, unknown>> = [];
  const db = { procedureMaterial: {
    findMany: vi.fn(async () => rows),
    findUnique: vi.fn(async ({ where }: { where: { gmailDedupeKey: string } }) => rows.find((r) => r.gmailDedupeKey === where.gmailDedupeKey)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.push(data); return data; }),
  } };
  const gmail = { ...client(), getMessage: vi.fn().mockResolvedValue(message(parts)), searchMessagesAll: vi.fn().mockResolvedValue(['mail-1']), trashMessage: vi.fn().mockResolvedValue(undefined) };
  const store = { write: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue(image), stat: vi.fn().mockResolvedValue({ isFile: () => true }) };
  const factory = vi.fn().mockResolvedValue(gmail);
  const service = new ProcedureMaterialGmailIngestionService(factory, db as never, store as never);
  const config = { ...defaultBackupConfig, procedureMaterialGmailIngest: { enabled: true, subjectTokens: ['[Procedure-material]'] } };
  return { rows, db, gmail, store, factory, service, config };
}

describe('procedure-material Gmail ingestion', () => {
  it('saves originals and metadata once, trashes both first and duplicate runs without downloading again', async () => {
    const h = harness();
    const first = await h.service.runOnce({ config: h.config, allowWait: false });
    const second = await h.service.runOnce({ config: h.config, allowWait: false });
    expect(first).toMatchObject({ saved: 2, processed: 1 });
    expect(second).toMatchObject({ saved: 0, duplicate: 2, messages: [{ status: 'duplicate', trashed: true }] });
    expect(h.rows).toHaveLength(2); expect(h.gmail.trashMessage).toHaveBeenCalledTimes(2);
    expect(h.gmail.getAttachment).toHaveBeenCalledTimes(1); expect(h.store.write).toHaveBeenCalledTimes(1);
    expect(h.store.write).toHaveBeenCalledWith(expect.objectContaining({ key: `procedure-materials/${createHash('sha256').update(image).digest('hex')}/original`, mode: 'create', integrity: true }));
    expect(h.rows[0]).toMatchObject({ kind: 'TEXT', text: '手順', subjectHint: 'DFD1 組立', fromEmail: 'sender@example.com', gmailDedupeKey: 'mail-1:body', receivedAt: new Date('2026-10-05T03:00:00Z') });
  });
  it('does not trash an empty body with only unsupported attachments', async () => {
    const h = harness([textPart('  \n '), photoPart('video.mp4', { mimeType: 'video/mp4' })]);
    expect(await h.service.runOnce({ config: h.config, allowWait: true })).toMatchObject({ saved: 0, skipped: 1, skippedAttachments: 1, messages: [{ reason: '本文が空で、対応する写真がありません', trashed: false }] });
    expect(h.gmail.trashMessage).not.toHaveBeenCalled(); expect(h.rows).toEqual([]);
  });
  it('skips mismatching senders and non-leading subjects before attachments or DB writes', async () => {
    const h = harness();
    const config = { ...h.config, procedureMaterialGmailIngest: { ...h.config.procedureMaterialGmailIngest, fromEmail: 'other@example.com' } };
    expect((await h.service.runOnce({ config, allowWait: true })).messages[0]?.reason).toContain('送信元');
    h.gmail.getMessage.mockResolvedValue(message([photoPart()], 'Re: [Procedure-material] DFD1'));
    expect((await h.service.runOnce({ config: h.config, allowWait: true, messageId: 'mail-1', forceRetry: true })).messages[0]?.reason).toContain('件名');
    expect(h.gmail.getAttachment).not.toHaveBeenCalled(); expect(h.db.procedureMaterial.create).not.toHaveBeenCalled(); expect(h.gmail.trashMessage).not.toHaveBeenCalled();
  });
  it.each(['sender', 'empty', 'subject'])('defers 20 skipped %s messages so the valid 21st message can be ingested', async (skip) => {
    const h = harness();
    const ids = Array.from({ length: 21 }, (_, i) => `mail-${i + 1}`);
    h.gmail.searchMessagesAll.mockResolvedValue(ids);
    h.gmail.getMessage.mockImplementation(async (id: string) => ({
      ...message(id === 'mail-21' || skip !== 'empty' ? [textPart('手順')] : [],
        id !== 'mail-21' && skip === 'subject' ? 'Re: [Procedure-material]' : '[Procedure-material]'),
      id,
    }));
    const config = skip === 'sender'
      ? { ...h.config, procedureMaterialGmailIngest: { ...h.config.procedureMaterialGmailIngest, fromEmail: 'allowed@example.com' } }
      : h.config;
    if (skip === 'sender') {
      h.gmail.getMessage.mockImplementation(async (id: string) => ({
        ...message([textPart('手順')]), id,
        payload: { ...message([]).payload, parts: [textPart('手順')], headers: [
          { name: 'Subject', value: '[Procedure-material]' },
          { name: 'From', value: id === 'mail-21' ? 'allowed@example.com' : 'other@example.com' },
        ] },
      }));
    }
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      expect(await h.service.runOnce({ config, allowWait: false })).toMatchObject({ scanned: 21, processed: 20, skipped: 20, saved: 0 });
      expect(await h.service.runOnce({ config, allowWait: false })).toMatchObject({ scanned: 21, processed: 1, skipped: 0, saved: 1 });
      expect(h.gmail.getMessage).toHaveBeenCalledTimes(21);
      expect(h.gmail.trashMessage).toHaveBeenCalledExactlyOnceWith('mail-21');
      h.gmail.searchMessagesAll.mockResolvedValue(ids.slice(0, 20));
      clock.mockReturnValue(1_000_000 + 5 * 60 * 1000 - 1);
      expect(await h.service.runOnce({ config, allowWait: false })).toMatchObject({ scanned: 20, processed: 0 });
      clock.mockReturnValue(1_000_000 + 5 * 60 * 1000);
      expect(await h.service.runOnce({ config, allowWait: false })).toMatchObject({ scanned: 20, processed: 20, skipped: 20 });
    } finally { clock.mockRestore(); }
  });
  it('retries cleanup without increasing material count and allows targeted forceRetry during backoff', async () => {
    const h = harness(); h.gmail.trashMessage.mockRejectedValueOnce(new Error('temporary Gmail failure'));
    expect(await h.service.runOnce({ config: h.config, allowWait: true })).toMatchObject({ saved: 2, retryable: 1, messages: [{ trashed: false }] });
    expect(await h.service.runOnce({ config: h.config, allowWait: true })).toMatchObject({ processed: 0 });
    const result = await h.service.runOnce({ config: h.config, allowWait: true, manual: true, messageId: 'mail-1', forceRetry: true });
    expect(result).toMatchObject({ saved: 0, duplicate: 2, messages: [{ trashed: true }] }); expect(h.rows).toHaveLength(2);
  });
  it('retries a partial save without trashing prematurely or duplicating the body', async () => {
    const h = harness(); h.store.write.mockRejectedValueOnce(new Error('storage unavailable'));
    const first = await h.service.runOnce({ config: h.config, allowWait: true });
    expect(first).toMatchObject({ saved: 1, retryable: 1 }); expect(h.gmail.trashMessage).not.toHaveBeenCalled();
    expect(await h.service.runOnce({ config: h.config, allowWait: true, messageId: 'mail-1', forceRetry: true })).toMatchObject({ saved: 1, duplicate: 1 });
    expect(h.rows).toHaveLength(2); expect(h.gmail.trashMessage).toHaveBeenCalledOnce();
  });
  it('checks integrity when content-addressed photo bytes already exist', async () => {
    const h = harness([photoPart()]); h.store.write.mockRejectedValue(new FileStorageAlreadyExistsError());
    expect(await h.service.runOnce({ config: h.config, allowWait: true })).toMatchObject({ saved: 1 });
    expect(h.store.read).toHaveBeenCalledWith(expect.stringContaining('procedure-materials/'), { verifyIntegrity: true });
  });
  it('keeps the default disabled, permits manual runs, and limits search to canonical inbox unread mail', async () => {
    const h = harness();
    const config = { ...h.config, procedureMaterialGmailIngest: { ...h.config.procedureMaterialGmailIngest, enabled: false } };
    expect(await h.service.runOnce({ config, allowWait: false })).toMatchObject({ processed: 0 }); expect(h.factory).not.toHaveBeenCalled();
    await h.service.runOnce({ config, allowWait: false, manual: true }); expect(h.factory).toHaveBeenCalledWith(config, { allowWait: false });
    expect(buildProcedureMaterialGmailSearchQuery({ enabled: true, subjectTokens: ['invalid'], fromEmail: 'someone@example.com' })).toBe('(subject:"[Procedure-material]") in:inbox is:unread');
    expect(BackupConfigSchema.parse({ storage: { provider: 'local' }, targets: [] }).procedureMaterialGmailIngest).toEqual({ enabled: false, subjectTokens: ['[Procedure-material]'] });
  });
  it.each([true, false])('restores an original removed by GC before row registration (reused: %s)', async (reused) => {
    const h = harness([photoPart()]);
    const key = `procedure-materials/${createHash('sha256').update(image).digest('hex')}/original`;
    let exists = reused;
    const order: string[] = [];
    h.store.write.mockImplementation(async () => {
      if (exists) throw new FileStorageAlreadyExistsError();
      exists = true;
      order.push(h.rows.length ? 'restored' : 'written');
    });
    h.store.read.mockImplementation(async () => {
      expect(exists).toBe(true);
      order.push('reused');
      return image;
    });
    const gcDelete = vi.fn(async () => { exists = false; order.push('gc-deleted'); });
    h.db.procedureMaterial.create.mockImplementation(async ({ data }) => {
      // GC already selected the unreferenced original; delete before INSERT completes.
      await gcDelete();
      h.rows.push(data);
      order.push('registered');
      return data;
    });
    h.store.stat.mockImplementation(async () => {
      order.push('stat');
      expect(h.rows).toHaveLength(1);
      if (!exists) throw Object.assign(new Error('missing original'), { code: 'ENOENT' });
      return { isFile: () => true };
    });
    expect(await h.service.runOnce({ config: h.config, allowWait: false })).toMatchObject({ saved: 1, retryable: 0, messages: [{ trashed: true }] });
    expect(order).toEqual([reused ? 'reused' : 'written', 'gc-deleted', 'registered', 'stat', 'restored']);
    expect(h.store.stat).toHaveBeenCalledExactlyOnceWith(key);
    expect(h.store.write).toHaveBeenLastCalledWith({ key, data: image, mode: 'create', integrity: true });
    expect(exists).toBe(true);
  });
});
