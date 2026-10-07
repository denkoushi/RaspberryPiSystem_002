import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../../lib/logger.js';
import { buildMinimalValidPdfBuffer } from '../../../lib/__tests__/fixtures/minimal-pdf.js';
import { defaultBackupConfig, BackupConfigSchema } from '../../backup/backup-config.js';
import type { GmailMessage, GmailMessagePart } from '../../backup/gmail-api-client.js';
import { FileStorageAlreadyExistsError } from '../../file-storage/file-storage-errors.js';
import type { PdfPagesPort } from '../../knowledge/pdf-pages.port.js';
import { buildProcedureMaterialGmailSearchQuery, ProcedureMaterialGmailIngestionService } from '../procedure-material-gmail-ingestion.service.js';
import { resolveAttachmentContentType, resolveProcedureMaterialGmailPacket, stripCidPlaceholders } from '../procedure-material-gmail-packet-resolver.js';

vi.mock('../../../lib/logger.js', () => ({ logger: { info: vi.fn() } }));

let image: Buffer;
let inlineImage: Buffer;
let pageImage: Buffer;
const pdf = buildMinimalValidPdfBuffer();
beforeAll(async () => {
  image = await sharp({ create: { width: 4, height: 3, channels: 3, background: 'blue' } }).png().toBuffer();
  pageImage = await sharp(image).jpeg().toBuffer();
  const pixels = Buffer.alloc(256 * 256 * 3);
  let seed = 1;
  for (let i = 0; i < pixels.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    pixels[i] = seed >>> 24;
  }
  inlineImage = await sharp(pixels, { raw: { width: 256, height: 256, channels: 3 } }).jpeg().toBuffer();
  expect(inlineImage.length).toBeGreaterThan(16 * 1024);
});
const textPart = (text: string, mimeType = 'text/plain'): GmailMessagePart => ({ mimeType, body: { data: Buffer.from(text).toString('base64url') } });
const photoPart = (name = 'photo.png', overrides: Partial<GmailMessagePart> = {}): GmailMessagePart => ({ filename: name, mimeType: 'image/png', body: { attachmentId: name }, ...overrides });
const pdfPart = (overrides: Partial<GmailMessagePart> = {}): GmailMessagePart => ({ filename: '組立.v1.pdf', partId: 'pdf-1', mimeType: 'application/pdf', body: { attachmentId: 'pdf' }, ...overrides });
function message(parts: GmailMessagePart[], subject = '[Procedure-material] DFD1 組立'): GmailMessage {
  return { id: 'mail-1', threadId: 'thread', labelIds: ['INBOX', 'UNREAD'], snippet: '', internalDateMs: Date.parse('2026-10-05T03:00:00Z'), payload: {
    mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: subject }, { name: 'From', value: '送信者 <sender@thkintechs.co.jp>' }], parts,
  } };
}
const client = () => ({ getAttachment: vi.fn().mockImplementation(async () => image) });

function outlookMessage(text: string): GmailMessage {
  const mail = message([textPart(text), photoPart('image001.jpg', {
    partId: '1', mimeType: 'image/jpeg', body: { attachmentId: 'outlook-photo', size: inlineImage.length },
    headers: [{ name: 'Content-ID', value: '<image001.jpg@01DB1234>' }, { name: 'Content-Disposition', value: 'inline; filename=image001.jpg' }],
  })]);
  mail.payload!.mimeType = 'multipart/related';
  return mail;
}

describe('stripCidPlaceholders', () => {
  it.each([
    ['手順\n[cid:first]\n\n[CID:second]\n\n\n次', '手順\n\n次'],
    ['\n \n[cid:image001.jpg@01DB1234]\n\t\n', ''],
    ['\r\n[CiD:first]\r\n\r\n 手順 \r\n\r\n[CID:second]\r\n', '手順'],
    ['手順 [cid:first]写真 [CID:second]', '手順 写真'],
    ['手順\n[cid:first]\n \n  次', '手順\n\n  次'],
    ['cid:reference\n[別の目印]', 'cid:reference\n[別の目印]'],
  ])('strips placeholders and excess blank lines from %j', (input, expected) => {
    expect(stripCidPlaceholders(input)).toBe(expected);
  });
});

describe('resolveAttachmentContentType', () => {
  it.each([
    [undefined, 'ハンドル2.png', 'image/png'],
    ['', 'photo.JPG', 'image/jpeg'],
    ['application/octet-stream', 'photo.jpeg', 'image/jpeg'],
    ['binary/octet-stream', 'photo.WEBP', 'image/webp'],
    ['application/x-download', '  ハンドル2.PNG  ', 'application/x-download'],
    ['text/plain', 'photo.png', 'text/plain'],
    [' TEXT/PLAIN ', 'photo.png', 'text/plain'],
    ['text/html', 'clip.mp4', 'text/html'],
    ['application/pdf', 'photo.png', 'application/pdf'],
    ['  ', 'photo.png', 'image/png'],
    [' APPLICATION/OCTET-STREAM ', 'photo.png', 'image/png'],
    ['application/octet-stream', 'clip.MP4', 'video/mp4'],
    ['application/octet-stream', 'manual.PDF', 'application/pdf'],
    ['binary/octet-stream', 'manual.pdf', 'application/pdf'],
    [undefined, 'manual.pdf', 'application/pdf'],
    ['text/plain', 'manual.pdf', 'text/plain'],
    ['application/octet-stream', 'clip.mov', 'video/quicktime'],
    ['binary/octet-stream', 'clip.3GP', 'video/3gpp'],
    ['', 'clip.m4v', 'video/x-m4v'],
    [' IMAGE/JPEG ', 'photo.png', 'image/jpeg'],
    ['video/quicktime', 'clip.mp4', 'video/quicktime'],
    ['image/gif', 'photo.png', 'image/gif'],
    ['video/x-msvideo', 'clip.mp4', 'video/x-msvideo'],
    ['application/octet-stream', 'photo', 'application/octet-stream'],
    ['application/octet-stream', 'photo.png.txt', 'application/octet-stream'],
  ])('resolves MIME %j and filename %j to %s', (mime, filename, expected) => {
    expect(resolveAttachmentContentType(mime, filename)).toBe(expected);
  });
});

describe('procedure-material Gmail packet', () => {
  it.each(['application/pdf', 'application/octet-stream', 'binary/octet-stream', undefined])('collects PDF bytes with MIME %j without rendering', async (mimeType) => {
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValue(pdf) };
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([pdfPart({ mimeType })]), client: attachmentClient });
    expect(packet).toMatchObject({ text: null, photos: [], videos: [], skippedAttachments: 0, warnings: [] });
    expect(packet.pdfs).toEqual([{
      filename: '組立.v1.pdf', buffer: pdf, sha256: createHash('sha256').update(pdf).digest('hex'),
      gmailDedupeKey: `mail-1:${createHash('sha256').update('組立.v1.pdf\npdf-1').digest('hex')}`,
    }]);
    expect(attachmentClient.getAttachment).toHaveBeenCalledExactlyOnceWith('mail-1', 'pdf');
  });
  it('collects inline PDF bytes and distinct keys for same-name parts', async () => {
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([
      pdfPart({ headers: [{ name: 'Content-Disposition', value: 'inline' }], body: { data: pdf.toString('base64url') } }),
      pdfPart({ partId: 'pdf-2', body: { data: pdf.toString('base64url') } }),
    ]), client: client() });
    expect(packet.pdfs).toHaveLength(2);
    expect(packet.pdfs[0]?.gmailDedupeKey).not.toBe(packet.pdfs[1]?.gmailDedupeKey);
    expect(packet.skippedAttachments).toBe(0);
  });
  it.each([true, false])('excludes PDFs over 10 MiB (reported size: %s)', async (reported) => {
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValue(Buffer.alloc(10 * 1024 * 1024 + 1)) };
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([pdfPart({
      body: { attachmentId: 'pdf', ...(reported ? { size: 10 * 1024 * 1024 + 1 } : {}) },
    })]), client: attachmentClient });
    expect(packet).toMatchObject({ pdfs: [], skippedAttachments: 1, warnings: ['組立.v1.pdf: 10 MB超過'] });
    expect(attachmentClient.getAttachment).toHaveBeenCalledTimes(reported ? 0 : 1);
  });
  it('accepts PDFs at exactly 10 MiB', async () => {
    const buffer = Buffer.alloc(10 * 1024 * 1024);
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([pdfPart({ body: { attachmentId: 'pdf', size: buffer.length } })]), client: { getAttachment: async () => buffer } });
    expect(packet.pdfs).toHaveLength(1);
    expect(packet.skippedAttachments).toBe(0);
  });
  it.each([
    ['  ハンドル2.png  ', 'png', 'image/png'],
    ['photo.JPG', 'jpeg', 'image/jpeg'],
  ] as const)('imports octet-stream photo %s with the inferred content type', async (filename, format, contentType) => {
    const buffer = await sharp(image).toFormat(format).toBuffer();
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValue(buffer) };
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart(filename, { mimeType: 'application/octet-stream' })]), client: attachmentClient });
    expect(packet).toMatchObject({ skippedAttachments: 0, warnings: [], videos: [] });
    expect(packet.photos).toHaveLength(1);
    expect(packet.photos[0]).toMatchObject({ filename: filename.trim(), buffer, contentType, width: 4, height: 3 });
  });
  it('imports generic MIME inline photos using the same inference', async () => {
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValue(inlineImage) };
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart('photo.JPG', {
      mimeType: 'binary/octet-stream', headers: [{ name: 'Content-Disposition', value: 'inline' }],
      body: { attachmentId: 'inline', size: inlineImage.length },
    })]), client: attachmentClient });
    expect(packet).toMatchObject({ skippedAttachments: 0, warnings: [] });
    expect(packet.photos).toHaveLength(1);
    expect(packet.photos[0]?.contentType).toBe('image/jpeg');
  });
  it.each(['  ハンドル2  ', '\tハンドル2.txt\u3000'])('rejects octet-stream with unsupported filename %j and trims warning filenames', async (filename) => {
    const attachmentClient = client();
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart(filename, { mimeType: 'application/octet-stream' })]), client: attachmentClient });
    expect(packet).toMatchObject({ photos: [], videos: [], skippedAttachments: 1, warnings: [`${filename.trim()}: 対応外の添付または10 MB超過`] });
    expect(attachmentClient.getAttachment).not.toHaveBeenCalled();
  });
  it('treats octet-stream MP4 attachments as videos', async () => {
    const buffer = Buffer.from('video bytes');
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValue(buffer) };
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart('clip.mp4', { mimeType: 'application/octet-stream' })]), client: attachmentClient });
    expect(packet).toMatchObject({ photos: [], skippedAttachments: 0, warnings: [] });
    expect(packet.videos).toHaveLength(1);
    expect(packet.videos[0]).toMatchObject({ filename: 'clip.mp4', buffer, contentType: 'video/mp4' });
  });
  it.each(['invalid', 'jpeg', 'truncated'] as const)('rejects inferred PNG attachments containing %s bytes', async (contents) => {
    const buffer = contents === 'invalid' ? Buffer.from('not an image')
      : contents === 'jpeg' ? inlineImage : image.subarray(0, image.length - 20);
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValue(buffer) };
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart('  ハンドル2.png  ', { mimeType: 'application/octet-stream' })]), client: attachmentClient });
    expect(packet).toMatchObject({ photos: [], videos: [], skippedAttachments: 1, warnings: ['ハンドル2.png: 画像を読み取れません'] });
  });
  it('resolves body only and prefers plain text to the alternative HTML', async () => {
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([{ ...textPart('  手順\n本文  '), headers: [{ name: 'Content-Disposition', value: 'inline' }] }, textPart('<p>別の本文</p>', 'text/html')]), client: client() });
    expect(packet.text).toBe('手順\n本文'); expect(packet.photos).toEqual([]);
  });
  it('converts HTML-only bodies to text, including entities and line breaks', async () => {
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([textPart('<style>x</style><p>手順 &amp; 写真</p><div>&#x7d44;&#31435;<br>次</div>', 'text/html')]), client: client() });
    expect(packet.text).toBe('手順 & 写真\n組立\n次');
  });
  it.each([
    ['<p>手順</p><p>[CID:image001]</p><img src="cid:image001"><p>次</p>', '手順\n\n次'],
    ['<p>[cid:image001]</p><img src="cid:image001">', null],
  ])('strips CID placeholders and image tags from HTML-only bodies', async (body, expected) => {
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([textPart(body, 'text/html')]), client: client() });
    expect(packet.text).toBe(expected);
  });
  it.each([
    ['手順\n\n[cid:image001.jpg@01DB1234]\n\n\n次', '手順\n\n次'],
    ['[cid:image001.jpg@01DB1234]', null],
  ])('imports Outlook related photos and removes body placeholders', async (body, expected) => {
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValue(inlineImage) };
    const mail = outlookMessage(body);
    const packet = await resolveProcedureMaterialGmailPacket({ message: mail, client: attachmentClient });
    const key = `mail-1:${createHash('sha256').update('image001.jpg\n1').digest('hex')}`;
    expect(packet).toMatchObject({ text: expected, skippedAttachments: 0, warnings: [] });
    expect(packet.photos).toHaveLength(1);
    expect(packet.photos[0]).toMatchObject({ gmailDedupeKey: key, filename: 'image001.jpg', buffer: inlineImage, contentType: 'image/jpeg', width: 256, height: 256 });
    const retry = await resolveProcedureMaterialGmailPacket({ message: mail, client: attachmentClient, savedKeys: new Set([key]) });
    expect(retry).toMatchObject({ duplicate: 1, photos: [] });
    expect(attachmentClient.getAttachment).toHaveBeenCalledExactlyOnceWith('mail-1', 'outlook-photo');
  });
  it('imports Outlook photos nested in alternative and related parts', async () => {
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValue(inlineImage) };
    const mail = message([
      textPart('手順\n[cid:image001.jpg@01DB1234]\n次'),
      { mimeType: 'multipart/related', parts: [
        textPart('<p>別の本文</p><img src="cid:image001.jpg@01DB1234">', 'text/html'),
        photoPart('image001.jpg', {
          mimeType: 'image/jpeg', body: { attachmentId: 'outlook-photo', size: inlineImage.length },
          headers: [{ name: 'Content-ID', value: '<image001.jpg@01DB1234>' }, { name: 'Content-Disposition', value: 'inline; filename=image001.jpg' }],
        }),
      ] },
    ]);
    mail.payload!.mimeType = 'multipart/alternative';
    const packet = await resolveProcedureMaterialGmailPacket({ message: mail, client: attachmentClient });
    expect(packet).toMatchObject({ text: '手順\n\n次', skippedAttachments: 0, warnings: [] });
    expect(packet.photos).toHaveLength(1);
    expect(packet.photos[0]).toMatchObject({ filename: 'image001.jpg', buffer: inlineImage, contentType: 'image/jpeg' });
    expect(attachmentClient.getAttachment).toHaveBeenCalledExactlyOnceWith('mail-1', 'outlook-photo');
  });
  it('imports Gmail Web attachments alongside an alternative plain text body', async () => {
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValue(inlineImage) };
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([
      { mimeType: 'multipart/alternative', parts: [textPart('手順\n本文'), textPart('<p>別の本文</p>', 'text/html')] },
      photoPart('photo.jpg', {
        mimeType: 'image/jpeg', headers: [{ name: 'Content-Disposition', value: 'attachment; filename=photo.jpg' }],
      }),
    ]), client: attachmentClient });
    expect(packet).toMatchObject({ text: '手順\n本文', skippedAttachments: 0, warnings: [] });
    expect(packet.photos).toHaveLength(1);
    expect(packet.photos[0]).toMatchObject({ filename: 'photo.jpg', buffer: inlineImage, contentType: 'image/jpeg' });
    expect(attachmentClient.getAttachment).toHaveBeenCalledExactlyOnceWith('mail-1', 'photo.jpg');
  });
  it('deduplicates inline photos without a reported size before fetching bytes', async () => {
    const attachmentClient = client();
    const key = `mail-1:${createHash('sha256').update('image001.jpg\n1').digest('hex')}`;
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart('image001.jpg', {
      partId: '1', mimeType: 'image/jpeg', body: { attachmentId: 'outlook-photo' },
      headers: [{ name: 'Content-ID', value: '<image001.jpg@01DB1234>' }, { name: 'Content-Disposition', value: 'inline; filename=image001.jpg' }],
    })]), client: attachmentClient, savedKeys: new Set([key]) });
    expect(packet).toMatchObject({ duplicate: 1, photos: [], skippedAttachments: 0, warnings: [] });
    expect(attachmentClient.getAttachment).not.toHaveBeenCalled();
  });
  it.each(['IMG_0001.jpg', ''])('imports Content-ID photos without disposition, with filename %j', async (filename) => {
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart(filename, {
      mimeType: 'image/jpeg', headers: [{ name: 'Content-ID', value: '<iphone-photo>' }], body: { data: inlineImage.toString('base64url') },
    })]), client: client() });
    expect(packet.photos).toHaveLength(1);
    expect(packet.photos[0]).toMatchObject({ filename: filename || 'photo', buffer: inlineImage });
    expect(packet.warnings).toEqual([]);
  });
  it.each([true, false])('silently skips small inline logos (size provided: %s)', async (withSize) => {
    const attachmentClient = client();
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart('logo.png', {
      headers: [{ name: 'Content-Disposition', value: 'inline' }], body: { attachmentId: 'logo', ...(withSize ? { size: image.length } : {}) },
    })]), client: attachmentClient });
    expect(packet).toMatchObject({ photos: [], skippedAttachments: 1, warnings: [] });
    expect(attachmentClient.getAttachment).toHaveBeenCalledTimes(withSize ? 0 : 1);
  });
  it('imports small explicit attachments even with Content-ID', async () => {
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart('small.png', {
      headers: [{ name: 'Content-Disposition', value: 'attachment; filename=small.png' }, { name: 'Content-ID', value: '<small>' }],
      body: { attachmentId: 'small', size: image.length },
    })]), client: client() });
    expect(packet).toMatchObject({ skippedAttachments: 0, warnings: [] });
    expect(packet.photos).toHaveLength(1);
  });
  it.each([true, false])('imports inline photos at exactly 16 KiB (size provided: %s)', async (withSize) => {
    const buffer = Buffer.concat([image, Buffer.alloc(16 * 1024 - image.length)]);
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart('', {
      headers: [{ name: 'Content-Disposition', value: 'inline' }], body: { data: buffer.toString('base64url'), ...(withSize ? { size: buffer.length } : {}) },
    })]), client: client() });
    expect(packet.photos).toHaveLength(1);
    expect(packet.warnings).toEqual([]);
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
  it('skips unsupported video, small inline and oversized images without fetching their bytes', async () => {
    const attachmentClient = client();
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([
      photoPart('video.avi', { mimeType: 'video/x-msvideo' }),
      photoPart('inline.png', { headers: [{ name: 'Content-Disposition', value: 'inline' }], body: { attachmentId: 'inline', size: image.length } }),
      photoPart('cid.png', { headers: [{ name: 'Content-ID', value: '<cid>' }], body: { attachmentId: 'cid', size: image.length } }),
      photoPart('large.png', { body: { attachmentId: 'large', size: 10 * 1024 * 1024 + 1 } }),
    ]), client: attachmentClient });
    expect(packet).toMatchObject({ text: null, photos: [], skippedAttachments: 4 });
    expect(attachmentClient.getAttachment).not.toHaveBeenCalled();
  });
  it('checks the actual size and skips corrupt images', async () => {
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValueOnce(Buffer.alloc(10 * 1024 * 1024 + 1)).mockResolvedValueOnce(Buffer.from('invalid')) };
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart('large.png'), photoPart('broken.png')]), client: attachmentClient });
    expect(packet.photos).toEqual([]); expect(packet.skippedAttachments).toBe(2);
  });
  it('checks reported and actual size limits and rejects corrupt inline photos', async () => {
    const attachmentClient = { getAttachment: vi.fn().mockResolvedValueOnce(Buffer.alloc(10 * 1024 * 1024 + 1)).mockResolvedValueOnce(Buffer.alloc(16 * 1024)) };
    const headers = [{ name: 'Content-Disposition', value: 'inline' }];
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([
      photoPart('reported-large.png', { headers, body: { attachmentId: 'reported-large', size: 10 * 1024 * 1024 + 1 } }),
      photoPart('actual-large.png', { headers }), photoPart('corrupt.png', { headers }),
    ]), client: attachmentClient });
    expect(packet).toMatchObject({ photos: [], skippedAttachments: 3, warnings: [
      'reported-large.png: 対応外の添付または10 MB超過', 'actual-large.png: 10 MB超過', 'corrupt.png: 画像を読み取れません',
    ] });
    expect(attachmentClient.getAttachment).toHaveBeenCalledTimes(2);
  });
  it.each(['jpeg', 'webp'] as const)('accepts %s and small base64 MIME attachments', async (format) => {
    const bytes = await sharp(image).toFormat(format).toBuffer();
    const packet = await resolveProcedureMaterialGmailPacket({ message: message([photoPart(`photo.${format}`, { mimeType: `image/${format}`, body: { data: bytes.toString('base64url') } })]), client: client() });
    expect(packet.photos).toHaveLength(1);
    expect(packet.photos[0]?.buffer).toEqual(bytes);
  });
});

function harness(parts: GmailMessagePart[] = [textPart('手順'), photoPart()], pdfPages?: PdfPagesPort) {
  const rows: Array<Record<string, unknown>> = [];
  const db = { procedureVideo: { findMany: vi.fn().mockResolvedValue([]) }, procedureMaterial: {
    findMany: vi.fn(async () => rows),
    findUnique: vi.fn(async ({ where }: { where: { gmailDedupeKey: string } }) => rows.find((r) => r.gmailDedupeKey === where.gmailDedupeKey)),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { rows.push(data); return data; }),
  } };
  const gmail = { ...client(), getMessage: vi.fn().mockResolvedValue(message(parts)), searchMessagesAll: vi.fn().mockResolvedValue(['mail-1']), trashMessage: vi.fn().mockResolvedValue(undefined) };
  const store = { write: vi.fn().mockResolvedValue(undefined), read: vi.fn().mockResolvedValue(image), stat: vi.fn().mockResolvedValue({ isFile: () => true }) };
  const factory = vi.fn().mockResolvedValue(gmail);
  const service = new ProcedureMaterialGmailIngestionService(factory, db as never, store as never, pdfPages);
  const config = { ...defaultBackupConfig, procedureMaterialGmailIngest: { ...defaultBackupConfig.procedureMaterialGmailIngest, enabled: true } };
  return { rows, db, gmail, store, factory, service, config };
}

describe('procedure-material Gmail ingestion', () => {
  beforeEach(() => { vi.mocked(logger.info).mockClear(); });
  it.each(['[Procedure-material] DFD1 組立', '[Procedure-material]'])('saves three PDF pages once with page metadata for subject %j', async (subject) => {
    const extract = vi.fn(async function* (buffer: Buffer) {
      expect(buffer).toEqual(pdf);
      for (let pageNumber = 1; pageNumber <= 3; pageNumber++) yield { pageNumber, text: 'unused PDF text', jpeg: pageImage };
    });
    const h = harness([pdfPart()], { extract });
    h.gmail.getAttachment.mockResolvedValue(pdf);
    h.gmail.getMessage.mockResolvedValue(message([pdfPart()], subject));
    const first = await h.service.runOnce({ config: h.config, allowWait: false });
    expect(first).toMatchObject({ saved: 3, duplicate: 0, retryable: 0, skippedAttachments: 0, messages: [{ status: 'saved', trashed: true, warnings: [] }] });
    const sha256 = createHash('sha256').update(pageImage).digest('hex');
    const baseKey = `mail-1:${createHash('sha256').update('組立.v1.pdf\npdf-1').digest('hex')}`;
    expect(h.rows).toEqual([1, 2, 3].map((pageNumber) => expect.objectContaining({
      kind: 'PHOTO', gmailDedupeKey: `${baseKey}:p${pageNumber}`, originalFileName: `組立.v1 p${pageNumber}.jpg`,
      subjectHint: subject === '[Procedure-material]' ? null : `DFD1 組立 (p${pageNumber}/3)`,
      storageKey: `procedure-materials/${sha256}/original`, sha256, byteSize: pageImage.length,
      contentType: 'image/jpeg', width: 4, height: 3,
    })));
    expect(h.store.write).toHaveBeenCalledTimes(3);
    expect(h.store.write).toHaveBeenCalledWith({ key: `procedure-materials/${sha256}/original`, data: pageImage, mode: 'create', integrity: true });
    expect(h.store.stat).toHaveBeenCalledTimes(3);
    expect(await h.service.runOnce({ config: h.config, allowWait: false })).toMatchObject({ saved: 0, duplicate: 3, messages: [{ status: 'duplicate', trashed: true }] });
    expect(h.rows).toHaveLength(3);
    expect(h.store.write).toHaveBeenCalledTimes(3);
    expect(h.gmail.trashMessage).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['renderer failed', 'PDF を描画できません: renderer failed'],
    ['Encrypted PDFs are not supported', '暗号化 PDF は対応外'],
    ['Command failed: pdfinfo\nCommand Line Error: Incorrect password', '暗号化 PDF は対応外'],
    ['Pilot PDF must contain 1–20 pages', 'PDF は 20 ページまで'],
  ])('skips PDF extraction failure %j with a warning and no partial save', async (reason, warning) => {
    const h = harness([pdfPart()], { extract: async function* () {
      yield { pageNumber: 1, text: '', jpeg: pageImage };
      throw new Error(reason);
    } });
    h.gmail.getAttachment.mockResolvedValue(pdf);
    expect(await h.service.runOnce({ config: h.config, allowWait: false })).toMatchObject({
      saved: 0, retryable: 0, skipped: 1, skippedAttachments: 1, errors: [],
      messages: [{ status: 'skipped', reason: '本文が空で、対応する写真・動画がありません', trashed: false, warnings: [`組立.v1.pdf: ${warning}`] }],
    });
    expect(h.rows).toEqual([]);
    expect(h.store.write).not.toHaveBeenCalled();
    expect(h.gmail.trashMessage).not.toHaveBeenCalled();
  });
  it('aggregates PDF and attachment warnings while saving the existing body and photo', async () => {
    const h = harness([textPart('手順'), photoPart(), pdfPart(), photoPart('clip.avi', { mimeType: 'video/x-msvideo' })], {
      extract: () => { throw new Error('renderer failed'); },
    });
    expect(await h.service.runOnce({ config: h.config, allowWait: false })).toMatchObject({
      saved: 2, skipped: 0, retryable: 0, skippedAttachments: 2,
      messages: [{ status: 'saved', trashed: true, warnings: ['clip.avi: 対応外の添付または10 MB超過', '組立.v1.pdf: PDF を描画できません: renderer failed'] }],
    });
  });
  it('keeps PDF storage failures retryable and resumes with only missing pages', async () => {
    const h = harness([pdfPart()], { extract: async function* () {
      for (let pageNumber = 1; pageNumber <= 3; pageNumber++) yield { pageNumber, text: '', jpeg: pageImage };
    } });
    h.gmail.getAttachment.mockResolvedValue(pdf);
    h.store.write.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('storage unavailable'));
    expect(await h.service.runOnce({ config: h.config, allowWait: false })).toMatchObject({ saved: 1, retryable: 1, skippedAttachments: 0 });
    expect(h.gmail.trashMessage).not.toHaveBeenCalled();
    expect(await h.service.runOnce({ config: h.config, allowWait: false, manual: true })).toMatchObject({ saved: 2, duplicate: 1, retryable: 0 });
    expect(h.rows).toHaveLength(3);
  });
  it.each(['skipped', 'retryable'])('manual ingestion retries all %s messages during backoff', async (status) => {
    const h = harness([]);
    h.gmail.searchMessagesAll.mockResolvedValue(['mail-1', 'mail-2']);
    if (status === 'retryable') h.gmail.getMessage.mockRejectedValue(new Error('temporary Gmail failure'));
    const first = await h.service.runOnce({ config: h.config, allowWait: false, manual: false });
    expect(first).toMatchObject({ scanned: 2, processed: 2, deferred: 0, [status]: 2 });
    const deferred = await h.service.runOnce({ config: h.config, allowWait: false, manual: false });
    expect(deferred).toEqual({ scanned: 2, processed: 0, saved: 0, duplicate: 0, skipped: 0, retryable: 0, deferred: 2, skippedAttachments: 0, errors: [], messages: [] });
    expect(logger.info).toHaveBeenLastCalledWith({ manual: false, scanned: 2, processed: 0, saved: 0, duplicate: 0, skipped: 0, retryable: 0, deferred: 2, skippedAttachments: 0, messages: [] }, '[ProcedureMaterialGmail] cycle completed');
    const manual = await h.service.runOnce({ config: h.config, allowWait: true, manual: true });
    expect(manual).toMatchObject({ scanned: 2, processed: 2, deferred: 0, [status]: 2 });
    expect(manual.messages.map(({ messageId, status: messageStatus, reason }) => ({ messageId, status: messageStatus, reason }))).toEqual(['mail-1', 'mail-2'].map((messageId) => ({ messageId, status, reason: first.messages[0]!.reason })));
    expect(h.gmail.getMessage).toHaveBeenCalledTimes(4);
  });
  it.each([false, true])('logs fixed skip reasons and retryable error names without error messages (manual: %s)', async (manual) => {
    const h = harness();
    h.gmail.searchMessagesAll.mockResolvedValue(['mail-1', 'mail-2', 'mail-3']);
    h.gmail.getMessage.mockResolvedValueOnce(message([textPart('手順'), photoPart()]))
      .mockResolvedValueOnce(message([], 'Re: [Procedure-material]'))
      .mockRejectedValueOnce(new Error('temporary Gmail failure'));
    const summary = await h.service.runOnce({ config: h.config, allowWait: false, manual });
    expect(summary.messages[2]).toMatchObject({ status: 'retryable', reason: 'temporary Gmail failure' });
    expect(summary.messages[2]).not.toHaveProperty('errorName');
    expect(summary.errors).toEqual(['mail-3: temporary Gmail failure']);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith({
      manual, scanned: 3, processed: 3, saved: 2, duplicate: 0, skipped: 1, retryable: 1, deferred: 0, skippedAttachments: 0,
      messages: [
        { messageId: 'mail-1', status: 'saved', reason: undefined },
        { messageId: 'mail-2', status: 'skipped', reason: '件名トークンが一致しません' },
        { messageId: 'mail-3', status: 'retryable', errorName: 'Error' },
      ],
    }, '[ProcedureMaterialGmail] cycle completed');
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('temporary Gmail failure');
  });
  it.each([
    [new TypeError('private failure details'), 'TypeError'],
    ['private failure details', 'Error'],
  ])('logs the error name for a retryable failure %j', async (error, errorName) => {
    const h = harness();
    h.gmail.getMessage.mockRejectedValue(error);
    const summary = await h.service.runOnce({ config: h.config, allowWait: false });
    expect(summary.messages[0]).toMatchObject({ status: 'retryable', reason: 'private failure details' });
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      messages: [{ messageId: 'mail-1', status: 'retryable', errorName }],
    }), '[ProcedureMaterialGmail] cycle completed');
    expect(JSON.stringify(vi.mocked(logger.info).mock.calls)).not.toContain('private failure details');
  });
  it('processes all 25 messages in a manual run without the scheduled batch limit', async () => {
    const h = harness([textPart('手順')]);
    const ids = Array.from({ length: 25 }, (_, i) => `mail-${i + 1}`);
    h.gmail.searchMessagesAll.mockResolvedValue(ids);
    h.gmail.getMessage.mockImplementation(async (id: string) => ({ ...message([textPart('手順')]), id }));
    const summary = await h.service.runOnce({ config: h.config, allowWait: true, manual: true });
    expect(summary).toMatchObject({ scanned: 25, processed: 25, saved: 25, deferred: 0, retryable: 0 });
    expect(summary.messages.map(({ messageId }) => messageId)).toEqual(ids);
    expect(h.gmail.getMessage).toHaveBeenCalledTimes(25);
    expect(h.gmail.trashMessage.mock.calls.map(([id]) => id)).toEqual(ids);
  });
  it('returns and logs zero counts when no messages are found', async () => {
    const h = harness();
    h.gmail.searchMessagesAll.mockResolvedValue([]);
    expect(await h.service.runOnce({ config: h.config, allowWait: false, manual: true })).toEqual({ scanned: 0, processed: 0, saved: 0, duplicate: 0, skipped: 0, retryable: 0, deferred: 0, skippedAttachments: 0, errors: [], messages: [] });
    expect(logger.info).toHaveBeenCalledExactlyOnceWith({ manual: true, scanned: 0, processed: 0, saved: 0, duplicate: 0, skipped: 0, retryable: 0, deferred: 0, skippedAttachments: 0, messages: [] }, '[ProcedureMaterialGmail] cycle completed');
    expect(h.gmail.getMessage).not.toHaveBeenCalled();
  });
  it.each([
    ['手順\n[cid:image001.jpg@01DB1234]', '手順'],
    ['[cid:image001.jpg@01DB1234]', null],
  ])('saves Outlook photos and creates TEXT only for remaining body text', async (body, expectedText) => {
    const h = harness();
    h.gmail.getMessage.mockResolvedValue(outlookMessage(body));
    h.gmail.getAttachment.mockResolvedValue(inlineImage);
    expect(await h.service.runOnce({ config: h.config, allowWait: false })).toMatchObject({ saved: expectedText ? 2 : 1, skippedAttachments: 0 });
    expect(h.rows.filter((row) => row.kind === 'PHOTO')).toHaveLength(1);
    expect(h.rows.filter((row) => row.kind === 'TEXT')).toEqual(expectedText ? [expect.objectContaining({ text: expectedText })] : []);
    expect(h.store.write).toHaveBeenCalledWith(expect.objectContaining({ data: inlineImage }));
  });
  it('saves originals and metadata once, trashes both first and duplicate runs without downloading again', async () => {
    const h = harness();
    const first = await h.service.runOnce({ config: h.config, allowWait: false });
    const second = await h.service.runOnce({ config: h.config, allowWait: false });
    expect(first).toMatchObject({ saved: 2, processed: 1 });
    expect(second).toMatchObject({ saved: 0, duplicate: 2, messages: [{ status: 'duplicate', trashed: true }] });
    expect(h.rows).toHaveLength(2); expect(h.gmail.trashMessage).toHaveBeenCalledTimes(2);
    expect(h.gmail.getAttachment).toHaveBeenCalledTimes(1); expect(h.store.write).toHaveBeenCalledTimes(1);
    expect(h.store.write).toHaveBeenCalledWith(expect.objectContaining({ key: `procedure-materials/${createHash('sha256').update(image).digest('hex')}/original`, mode: 'create', integrity: true }));
    expect(h.rows[0]).toMatchObject({ kind: 'TEXT', text: '手順', subjectHint: 'DFD1 組立', fromEmail: 'sender@thkintechs.co.jp', gmailDedupeKey: 'mail-1:body', receivedAt: new Date('2026-10-05T03:00:00Z') });
  });
  it.each([
    ['sender@THKINTECHS.CO.JP', ['thkintechs.co.jp'], undefined, true],
    ['sender@example.com', ['thkintechs.co.jp'], undefined, false],
    ['sender@mail.thkintechs.co.jp', ['thkintechs.co.jp'], undefined, false],
    [undefined, ['thkintechs.co.jp'], undefined, false],
    ['sender@thkintechs.co.jp', [], undefined, false],
    ['sender@example.com', ['thkintechs.co.jp', 'example.com'], undefined, true],
    ['sender@thkintechs.co.jp', ['thkintechs.co.jp'], 'sender@thkintechs.co.jp', true],
    ['sender@thkintechs.co.jp', ['thkintechs.co.jp'], 'other@thkintechs.co.jp', false],
    ['sender@example.com', ['thkintechs.co.jp'], 'sender@example.com', false],
  ] as const)('checks domain and optional exact sender: %s / %j / %s', async (sender, domains, fromEmail, allowed) => {
    const h = harness();
    const mail = message([textPart('手順'), photoPart()]);
    mail.payload.headers = [{ name: 'Subject', value: '[Procedure-material]' }, ...(sender ? [{ name: 'From', value: `送信者 <${sender}>` }] : [])];
    h.gmail.getMessage.mockResolvedValue(mail);
    const config = { ...h.config, procedureMaterialGmailIngest: { ...h.config.procedureMaterialGmailIngest, allowedSenderDomains: [...domains], fromEmail } };
    const result = await h.service.runOnce({ config, allowWait: false });
    expect(result).toMatchObject(allowed ? { saved: 2, skipped: 0 } : { saved: 0, skipped: 1, messages: [{ trashed: false, reason: fromEmail === 'other@thkintechs.co.jp' ? '送信元が設定と一致しません' : '送信元のドメインが許可されていません' }] });
    if (!allowed) {
      expect(h.gmail.trashMessage).not.toHaveBeenCalled();
      expect(h.gmail.getAttachment).not.toHaveBeenCalled();
      expect(h.db.procedureMaterial.findMany).not.toHaveBeenCalled();
      expect(mail.labelIds).toEqual(['INBOX', 'UNREAD']);
      expect(await h.service.runOnce({ config, allowWait: false })).toMatchObject({ processed: 0 });
    }
  });
  it('does not trash an empty body with only unsupported attachments', async () => {
    const h = harness([textPart('  \n '), photoPart('video.avi', { mimeType: 'video/x-msvideo' })]);
    expect(await h.service.runOnce({ config: h.config, allowWait: true })).toMatchObject({ saved: 0, skipped: 1, skippedAttachments: 1, messages: [{ reason: '本文が空で、対応する写真・動画がありません', trashed: false }] });
    expect(h.gmail.trashMessage).not.toHaveBeenCalled(); expect(h.rows).toEqual([]);
  });
  it('skips mismatching senders and non-leading subjects before attachments or DB writes', async () => {
    const h = harness();
    const config = { ...h.config, procedureMaterialGmailIngest: { ...h.config.procedureMaterialGmailIngest, fromEmail: 'other@thkintechs.co.jp' } };
    expect((await h.service.runOnce({ config, allowWait: true })).messages[0]?.reason).toContain('送信元');
    h.gmail.getMessage.mockResolvedValue(message([photoPart()], 'Re: [Procedure-material] DFD1'));
    expect((await h.service.runOnce({ config: h.config, allowWait: true, messageId: 'mail-1', forceRetry: true })).messages[0]?.reason).toContain('件名');
    expect(h.gmail.getAttachment).not.toHaveBeenCalled(); expect(h.db.procedureMaterial.create).not.toHaveBeenCalled(); expect(h.gmail.trashMessage).not.toHaveBeenCalled();
  });
  it.each(['sender', 'domain', 'empty', 'subject'])('defers 20 skipped %s messages so the valid 21st message can be ingested', async (skip) => {
    const h = harness();
    const ids = Array.from({ length: 21 }, (_, i) => `mail-${i + 1}`);
    h.gmail.searchMessagesAll.mockResolvedValue(ids);
    h.gmail.getMessage.mockImplementation(async (id: string) => ({
      ...message(id === 'mail-21' || skip !== 'empty' ? [textPart('手順')] : [],
        id !== 'mail-21' && skip === 'subject' ? 'Re: [Procedure-material]' : '[Procedure-material]'),
      id,
    }));
    const config = skip === 'sender'
      ? { ...h.config, procedureMaterialGmailIngest: { ...h.config.procedureMaterialGmailIngest, fromEmail: 'allowed@thkintechs.co.jp' } }
      : h.config;
    if (skip === 'sender' || skip === 'domain') {
      h.gmail.getMessage.mockImplementation(async (id: string) => ({
        ...message([textPart('手順')]), id,
        payload: { ...message([]).payload, parts: [textPart('手順')], headers: [
          { name: 'Subject', value: '[Procedure-material]' },
          { name: 'From', value: id === 'mail-21' ? 'allowed@thkintechs.co.jp' : skip === 'domain' ? 'other@example.com' : 'other@thkintechs.co.jp' },
        ] },
      }));
    }
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      expect(await h.service.runOnce({ config, allowWait: false })).toMatchObject({ scanned: 21, processed: 20, skipped: 20, saved: 0, deferred: 0 });
      expect(await h.service.runOnce({ config, allowWait: false })).toMatchObject({ scanned: 21, processed: 1, skipped: 0, saved: 1, deferred: 20 });
      expect(h.gmail.getMessage).toHaveBeenCalledTimes(21);
      expect(h.gmail.trashMessage).toHaveBeenCalledExactlyOnceWith('mail-21');
      h.gmail.searchMessagesAll.mockResolvedValue(ids.slice(0, 20));
      clock.mockReturnValue(1_000_000 + 5 * 60 * 1000 - 1);
      expect(await h.service.runOnce({ config, allowWait: false })).toMatchObject({ scanned: 20, processed: 0, deferred: 20 });
      clock.mockReturnValue(1_000_000 + 5 * 60 * 1000);
      expect(await h.service.runOnce({ config, allowWait: false })).toMatchObject({ scanned: 20, processed: 20, skipped: 20, deferred: 0 });
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
    expect(logger.info).not.toHaveBeenCalled();
    await h.service.runOnce({ config, allowWait: false, manual: true }); expect(h.factory).toHaveBeenCalledWith(config, { allowWait: false });
    expect(buildProcedureMaterialGmailSearchQuery({ ...defaultBackupConfig.procedureMaterialGmailIngest, enabled: true, subjectTokens: ['invalid'], fromEmail: 'someone@thkintechs.co.jp' })).toBe('(subject:"[Procedure-material]") in:inbox is:unread');
    expect(BackupConfigSchema.parse({ storage: { provider: 'local' }, targets: [] }).procedureMaterialGmailIngest).toEqual({ enabled: false, subjectTokens: ['[Procedure-material]'], allowedSenderDomains: ['thkintechs.co.jp'] });
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
