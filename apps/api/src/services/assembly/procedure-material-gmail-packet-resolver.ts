import { createHash } from 'node:crypto';
import sharp from 'sharp';

import type { GmailMessage, GmailMessagePart } from '../backup/gmail-api-client.js';

export const PROCEDURE_MATERIAL_MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const PROCEDURE_MATERIAL_STORED_PHOTO_MAX_BYTES = 1024 * 1024;
export const PHOTO_RESIZE_STEPS = [2000, 1600, 1200] as const;
export const PROCEDURE_MATERIAL_MAX_PDF_BYTES = 10 * 1024 * 1024;
export const PROCEDURE_VIDEO_MAX_BYTES = 25 * 1024 * 1024;
const VIDEO_FORMATS = new Set(['video/mp4', 'video/quicktime', 'video/3gpp', 'video/x-m4v']);
const PHOTO_FORMATS: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
const ATTACHMENT_EXTENSION_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', m4v: 'video/x-m4v',
  pdf: 'application/pdf',
};
const INLINE_PHOTO_MIN_BYTES = 16 * 1024;
const PHOTO_STORAGE_SIZE_ERROR = '縮小しても 1 MB に収まりません';
export type ProcedureMaterialAttachmentClient = { getAttachment: (messageId: string, attachmentId: string) => Promise<Buffer> };
export type ProcedureMaterialPhoto = {
  gmailDedupeKey: string; filename: string; buffer: Buffer; sha256: string; contentType: string; width: number; height: number;
};
export type ProcedureMaterialVideo = Pick<ProcedureMaterialPhoto, 'gmailDedupeKey' | 'filename' | 'buffer' | 'sha256' | 'contentType'>;
export type ProcedureMaterialPdf = Pick<ProcedureMaterialPhoto, 'gmailDedupeKey' | 'filename' | 'buffer' | 'sha256'>;
export type ProcedureMaterialPacket = { text: string | null; photos: ProcedureMaterialPhoto[]; videos: ProcedureMaterialVideo[]; pdfs: ProcedureMaterialPdf[]; duplicate: number; skippedAttachments: number; warnings: string[] };

/** Bounds decode memory on the Pi5: 40 MP ≈ 160 MiB RGBA. Larger inputs fail fast instead of risking OOM. */
export const PHOTO_MAX_INPUT_PIXELS = 40_000_000;
const PHOTO_PIXEL_LIMIT_ERROR = '画像の画素数が大きすぎます';
function openPhoto(buffer: Buffer) {
  return sharp(buffer, { limitInputPixels: PHOTO_MAX_INPUT_PIXELS });
}
function describePhotoError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return /pixel limit/i.test(message) ? PHOTO_PIXEL_LIMIT_ERROR : message;
}

export async function normalizePhotoForStorage(buffer: Buffer, contentType: string): Promise<{ buffer: Buffer; width: number; height: number }> {
  const metadata = await openPhoto(buffer).metadata();
  if (!metadata.width || !metadata.height) throw new Error('画像を読み取れません');
  if (Math.max(metadata.width, metadata.height) <= PHOTO_RESIZE_STEPS[0] && buffer.length <= PROCEDURE_MATERIAL_STORED_PHOTO_MAX_BYTES) {
    return { buffer, width: metadata.width, height: metadata.height };
  }
  for (const dimension of PHOTO_RESIZE_STEPS) {
    const image = openPhoto(buffer).rotate().resize({
      width: dimension, height: dimension, fit: 'inside', withoutEnlargement: true,
    });
    if (contentType === 'image/jpeg') image.jpeg({ quality: 85 });
    else if (contentType === 'image/png') image.png({ compressionLevel: 9 });
    else if (contentType === 'image/webp') image.webp({ quality: 85 });
    else throw new Error('画像形式が一致しません');
    // eslint-disable-next-line no-await-in-loop
    const { data, info } = await image.toBuffer({ resolveWithObject: true });
    if (data.length <= PROCEDURE_MATERIAL_STORED_PHOTO_MAX_BYTES) {
      return { buffer: data, width: info.width, height: info.height };
    }
    if (contentType === 'image/png' && dimension === PHOTO_RESIZE_STEPS[2]) {
      // eslint-disable-next-line no-await-in-loop
      const quantized = await image.png({ compressionLevel: 9, palette: true }).toBuffer({ resolveWithObject: true });
      if (quantized.data.length <= PROCEDURE_MATERIAL_STORED_PHOTO_MAX_BYTES) {
        return { buffer: quantized.data, width: quantized.info.width, height: quantized.info.height };
      }
    }
  }
  throw new Error(PHOTO_STORAGE_SIZE_ERROR);
}

export function materialMessageHeader(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** Keeps the raw MIME readable in warnings: bounded length, no control or bidi characters. */
function describeMimeType(mime: string | undefined): string {
  const cleaned = Array.from(mime ?? '').filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    const control = code < 0x20 || code === 0x7f;
    const bidi = code === 0x200e || code === 0x200f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
    return !control && !bidi;
  }).join('').trim();
  if (!cleaned) return '種類なし';
  return cleaned.length > 64 ? `${cleaned.slice(0, 64)}…` : cleaned;
}

export function resolveAttachmentContentType(mime: string | undefined, filename: string): string {
  // Some clients append parameters ("application/pdf; name=..."); only the media type matters here.
  const contentType = (mime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (PHOTO_FORMATS[contentType] || VIDEO_FORMATS.has(contentType) || contentType === 'application/pdf') return contentType;
  if (contentType && !/^(application|image|video|binary)\//.test(contentType)) return contentType;
  const extension = /\.(png|jpe?g|webp|mp4|mov|3gp|m4v|pdf)$/.exec(filename.trim().toLowerCase())?.[1] ?? '';
  return ATTACHMENT_EXTENSION_CONTENT_TYPES[extension] ?? contentType;
}

const BLOCK_END_TAGS = new Set(['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr']);
const HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return HTML_ENTITIES[entity.toLowerCase()] ?? match;
    const code = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Single forward scan: tags, comments and script/style bodies never reach the output. */
function htmlToText(html: string): string {
  const lower = html.toLowerCase();
  let out = '';
  let i = 0;
  while (i < html.length) {
    if (html[i] !== '<') { out += html[i]; i += 1; continue; }
    if (lower.startsWith('<!--', i)) {
      const commentEnd = lower.indexOf('-->', i + 4);
      i = commentEnd < 0 ? html.length : commentEnd + 3;
      continue;
    }
    const tagEnd = html.indexOf('>', i);
    const rawTag = (tagEnd < 0 ? html.slice(i + 1) : html.slice(i + 1, tagEnd)).trim().toLowerCase();
    const closing = rawTag.startsWith('/');
    const name = (closing ? rawTag.slice(1) : rawTag).split(/[\s/]/, 1)[0] ?? '';
    i = tagEnd < 0 ? html.length : tagEnd + 1;
    if (!closing && (name === 'script' || name === 'style')) {
      const bodyEnd = lower.indexOf(`</${name}`, i);
      if (bodyEnd < 0) { i = html.length; continue; }
      const closeEnd = lower.indexOf('>', bodyEnd);
      i = closeEnd < 0 ? html.length : closeEnd + 1;
      continue;
    }
    if (name === 'br' || (closing && BLOCK_END_TAGS.has(name))) out += '\n';
  }
  return decodeHtmlEntities(out).trim();
}

export function stripCidPlaceholders(text: string): string {
  return text.replace(/\[cid:[^\]\r\n]+\]/gi, '').replace(/\r\n?/g, '\n').replace(/\n(?:[ \t]*\n)+/g, '\n\n').trim();
}

/** Inline photos use the attachment path; small inline images are treated as signature logos. */
export async function resolveProcedureMaterialGmailPacket(params: {
  message: GmailMessage; client: ProcedureMaterialAttachmentClient; savedKeys?: ReadonlySet<string>;
}): Promise<ProcedureMaterialPacket> {
  const packet: ProcedureMaterialPacket = { text: null, photos: [], videos: [], pdfs: [], duplicate: 0, skippedAttachments: 0, warnings: [] };
  const plain: GmailMessagePart[] = [];
  const html: GmailMessagePart[] = [];
  const attachments: Array<{ part: GmailMessagePart; path: string; inline: boolean }> = [];
  function walk(part: GmailMessagePart, path: string) {
    const disposition = part.headers?.find((h) => h.name.toLowerCase() === 'content-disposition')?.value.trim().toLowerCase() ?? '';
    const contentId = part.headers?.some((h) => h.name.toLowerCase() === 'content-id');
    const attached = disposition.startsWith('attachment');
    const inline = disposition.startsWith('inline') || (!attached && !!contentId);
    const mime = resolveAttachmentContentType(part.mimeType, part.filename ?? '');
    if (inline && mime && (PHOTO_FORMATS[mime] || mime === 'application/pdf')) {
      attachments.push({ part, path, inline });
      return;
    }
    if (inline && (part.filename || (mime !== 'text/plain' && mime !== 'text/html'))) {
      packet.skippedAttachments++;
      return;
    }
    if (part.filename || attached || (part.body?.attachmentId && mime !== 'text/plain' && mime !== 'text/html')) {
      attachments.push({ part, path, inline });
      return;
    }
    if (mime === 'text/plain') plain.push(part);
    else if (mime === 'text/html') html.push(part);
    for (const [index, child] of (part.parts ?? []).entries()) walk(child, `${path}.${index}`);
  }
  if (params.message.payload) walk(params.message.payload, '0');
  const bytes = async (part: GmailMessagePart): Promise<Buffer> => part.body?.attachmentId
    ? params.client.getAttachment(params.message.id, part.body.attachmentId)
    : Buffer.from(part.body?.data ?? '', 'base64url');
  const bodyKey = `${params.message.id}:body`;
  if (params.savedKeys?.has(bodyKey)) packet.duplicate++;
  else {
    const bodies = await Promise.all((plain.length ? plain : html).map(async (part) => (await bytes(part)).toString('utf8')));
    packet.text = stripCidPlaceholders(plain.length ? bodies.join('\n') : bodies.map(htmlToText).join('\n')) || null;
  }
  for (const { part, path, inline } of attachments) {
    const filename = part.filename?.normalize('NFC').trim() || 'photo';
    const contentType = resolveAttachmentContentType(part.mimeType, filename);
    const key = `${params.message.id}:${createHash('sha256').update(`${filename}\n${part.partId ?? path}`).digest('hex')}`;
    if (contentType === 'application/pdf') {
      if ((part.body?.size ?? 0) > PROCEDURE_MATERIAL_MAX_PDF_BYTES) {
        packet.skippedAttachments++; packet.warnings.push(`${filename}: 10 MB超過`); continue;
      }
      // PDF deduplication uses page keys after rendering in ingestion.
      // eslint-disable-next-line no-await-in-loop
      const buffer = await bytes(part);
      if (buffer.length > PROCEDURE_MATERIAL_MAX_PDF_BYTES) {
        packet.skippedAttachments++; packet.warnings.push(`${filename}: 10 MB超過`); continue;
      }
      packet.pdfs.push({ gmailDedupeKey: key, filename, buffer, sha256: createHash('sha256').update(buffer).digest('hex') });
      continue;
    }
    if (VIDEO_FORMATS.has(contentType)) {
      if ((part.body?.size ?? 0) > PROCEDURE_VIDEO_MAX_BYTES) {
        packet.skippedAttachments++; packet.warnings.push(`${filename}: 25 MB超過`); continue;
      }
      if (params.savedKeys?.has(key)) { packet.duplicate++; continue; }
      // eslint-disable-next-line no-await-in-loop
      const buffer = await bytes(part);
      if (buffer.length > PROCEDURE_VIDEO_MAX_BYTES) {
        packet.skippedAttachments++; packet.warnings.push(`${filename}: 25 MB超過`); continue;
      }
      packet.videos.push({ gmailDedupeKey: key, filename, buffer, contentType, sha256: createHash('sha256').update(buffer).digest('hex') });
      continue;
    }
    if (inline && part.body?.size !== undefined && part.body.size < INLINE_PHOTO_MIN_BYTES) {
      packet.skippedAttachments++;
      continue;
    }
    if (!PHOTO_FORMATS[contentType]) {
      packet.skippedAttachments++;
      packet.warnings.push(`${filename} (${describeMimeType(part.mimeType)}): 対応外の添付`);
      continue;
    }
    if ((part.body?.size ?? 0) > PROCEDURE_MATERIAL_MAX_PHOTO_BYTES) {
      packet.skippedAttachments++; packet.warnings.push(`${filename}: 25 MB超過`); continue;
    }
    if (params.savedKeys?.has(key)) { packet.duplicate++; continue; }
    // eslint-disable-next-line no-await-in-loop
    const buffer = await bytes(part);
    if (inline && part.body?.size === undefined && buffer.length < INLINE_PHOTO_MIN_BYTES) {
      packet.skippedAttachments++;
      continue;
    }
    if (buffer.length > PROCEDURE_MATERIAL_MAX_PHOTO_BYTES) {
      packet.skippedAttachments++; packet.warnings.push(`${filename}: 25 MB超過`); continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const metadata = await openPhoto(buffer).metadata();
      if (metadata.format !== PHOTO_FORMATS[contentType] || !metadata.width || !metadata.height) throw new Error('画像形式が一致しません');
      // Validate the decoded pixels as well as the header before normalization.
      // eslint-disable-next-line no-await-in-loop
      await openPhoto(buffer).stats();
      // eslint-disable-next-line no-await-in-loop
      const normalized = await normalizePhotoForStorage(buffer, contentType);
      packet.photos.push({ gmailDedupeKey: key, filename, ...normalized, contentType, sha256: createHash('sha256').update(normalized.buffer).digest('hex') });
    } catch (error) {
      const message = describePhotoError(error);
      const warning = message === PHOTO_STORAGE_SIZE_ERROR || message === PHOTO_PIXEL_LIMIT_ERROR ? message : '画像を読み取れません';
      packet.skippedAttachments++; packet.warnings.push(`${filename}: ${warning}`);
    }
  }
  return packet;
}
