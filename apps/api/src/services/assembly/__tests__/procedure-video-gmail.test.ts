import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import type { GmailMessage } from '../../backup/gmail-api-client.js';
import { defaultBackupConfig } from '../../backup/backup-config.js';
import { FileStorageAlreadyExistsError } from '../../file-storage/file-storage-errors.js';
import { ProcedureMaterialGmailIngestionService } from '../procedure-material-gmail-ingestion.service.js';
import { PROCEDURE_VIDEO_MAX_BYTES, resolveProcedureMaterialGmailPacket } from '../procedure-material-gmail-packet-resolver.js';
import { ProcedureVideoService } from '../procedure-video.service.js';

const kick = vi.hoisted(() => vi.fn());
vi.mock('../procedure-video.scheduler.js', () => ({ getProcedureVideoScheduler: () => ({ kick }) }));
const bytes = Buffer.from('video bytes');
function message(mimeType = 'video/mp4', size = bytes.length, inline = false, filename = '手順.mp4'): GmailMessage {
  return { id: 'gmail-1', threadId: 't', labelIds: [], snippet: '', internalDateMs: 0,
    payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: '[Procedure-material] 手順' }, { name: 'From', value: 'sender@thkintechs.co.jp' }], parts: [{ partId: '2', filename, mimeType, headers: [{ name: 'Content-Disposition', value: inline ? 'inline' : 'attachment' }], body: { attachmentId: 'a', size } }] } };
}

describe('procedure-video Gmail', () => {
  it.each(['video/mp4', 'video/quicktime', 'video/3gpp', 'video/x-m4v'])('accepts %s with the existing attachment dedupe rule', async (mimeType) => {
    const client = { getAttachment: vi.fn().mockResolvedValue(bytes) };
    const packet = await resolveProcedureMaterialGmailPacket({ message: message(mimeType), client });
    const key = `gmail-1:${createHash('sha256').update('手順.mp4\n2').digest('hex')}`;
    expect(packet.videos).toEqual([{ filename: '手順.mp4', buffer: bytes, contentType: mimeType, gmailDedupeKey: key, sha256: createHash('sha256').update(bytes).digest('hex') }]);
    const duplicate = await resolveProcedureMaterialGmailPacket({ message: message(mimeType), client, savedKeys: new Set([key]) });
    expect(duplicate).toMatchObject({ duplicate: 1, videos: [] }); expect(client.getAttachment).toHaveBeenCalledOnce();
  });
  it.each([['video/mp4', PROCEDURE_VIDEO_MAX_BYTES + 1, false, '手順.mp4'], ['video/x-msvideo', 10, false, '手順.avi'], ['video/mp4', 10, true, '手順.mp4']] as const)('skips unsupported/oversized/inline %s before download', async (mimeType, size, inline, filename) => {
    const client = { getAttachment: vi.fn() };
    expect(await resolveProcedureMaterialGmailPacket({ message: message(mimeType, size, inline, filename), client })).toMatchObject({ skippedAttachments: 1, videos: [] });
    expect(client.getAttachment).not.toHaveBeenCalled();
  });
  it('checks the real downloaded size and accepts the 25 MB boundary', async () => {
    const client = { getAttachment: vi.fn().mockResolvedValueOnce(Buffer.alloc(PROCEDURE_VIDEO_MAX_BYTES)).mockResolvedValueOnce(Buffer.alloc(PROCEDURE_VIDEO_MAX_BYTES + 1)) };
    expect((await resolveProcedureMaterialGmailPacket({ message: message(), client })).videos).toHaveLength(1);
    expect(await resolveProcedureMaterialGmailPacket({ message: message(), client })).toMatchObject({ skippedAttachments: 1, videos: [] });
  });
  it('saves video-only mail, kicks processing, trashes it, and does not download duplicates again', async () => {
    const rows: any[] = [];
    const db = { procedureMaterial: { findMany: vi.fn().mockResolvedValue([]) }, procedureVideo: {
      findMany: vi.fn(async () => rows), findUnique: vi.fn(async ({ where }) => rows.find((row) => row.gmailDedupeKey === where.gmailDedupeKey)), create: vi.fn(async ({ data }) => { rows.push(data); return data; }),
    }, $transaction: vi.fn(), $queryRaw: vi.fn() };
    db.$transaction.mockImplementation((work) => work(db));
    const gmail = { getAttachment: vi.fn().mockResolvedValue(bytes), searchMessagesAll: vi.fn().mockResolvedValue(['gmail-1']), getMessage: vi.fn().mockResolvedValue(message()), trashMessage: vi.fn() };
    const store = { write: vi.fn() };
    const service = new ProcedureMaterialGmailIngestionService(async () => gmail, db as never, store as never);
    const options = { config: defaultBackupConfig, allowWait: false, manual: true };
    expect(await service.runOnce(options)).toMatchObject({ saved: 1, messages: [{ trashed: true }] });
    expect(await service.runOnce(options)).toMatchObject({ duplicate: 1, saved: 0, messages: [{ trashed: true }] });
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ status: 'PENDING', title: '手順', sourceContentType: 'video/mp4', sourceByteSize: bytes.length });
    expect(store.write).toHaveBeenCalledWith({ key: `procedure-videos/incoming/${createHash('sha256').update(bytes).digest('hex')}/original`, data: bytes, mode: 'create', integrity: true });
    expect(gmail.getAttachment).toHaveBeenCalledOnce(); expect(kick).toHaveBeenCalled();
    gmail.getMessage.mockResolvedValue({ ...message(), payload: { ...message().payload, headers: [{ name: 'Subject', value: '[Procedure-material]' }, { name: 'From', value: 'sender@example.com' }] } });
    expect(await service.runOnce(options)).toMatchObject({ skipped: 1, saved: 0 });
  });
  it('reuses identical shared original bytes and rejects identity conflicts', async () => {
    const db = { $queryRaw: vi.fn(), $transaction: vi.fn(), procedureVideo: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() } };
    db.$transaction.mockImplementation((work) => work(db));
    const store = { write: vi.fn().mockRejectedValue(new FileStorageAlreadyExistsError()), read: vi.fn().mockResolvedValue(bytes) };
    const video = (await resolveProcedureMaterialGmailPacket({ message: message(), client: { getAttachment: async () => bytes } })).videos[0]!;
    const service = new ProcedureVideoService(db as never, store as never);
    expect(await service.ingest(video, { gmailMessageId: 'gmail-1', fromEmail: null, subjectHint: null, receivedAt: new Date() })).toBe(true);
    store.read.mockResolvedValue(Buffer.from('wrong'));
    await expect(service.ingest(video, { gmailMessageId: 'gmail-1', fromEmail: null, subjectHint: null, receivedAt: new Date() })).rejects.toThrow('identity conflict');
  });
});
