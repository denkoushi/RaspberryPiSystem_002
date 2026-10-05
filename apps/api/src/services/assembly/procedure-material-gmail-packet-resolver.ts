import { createHash } from 'node:crypto';
import sharp from 'sharp';

import type { GmailMessage, GmailMessagePart } from '../backup/gmail-api-client.js';

export const PROCEDURE_MATERIAL_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PHOTO_FORMATS: Record<string, string> = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
export type ProcedureMaterialAttachmentClient = { getAttachment: (messageId: string, attachmentId: string) => Promise<Buffer> };
export type ProcedureMaterialPhoto = {
  gmailDedupeKey: string; filename: string; buffer: Buffer; sha256: string; contentType: string; width: number; height: number;
};
export type ProcedureMaterialPacket = { text: string | null; photos: ProcedureMaterialPhoto[]; duplicate: number; skippedAttachments: number; warnings: string[] };

export function materialMessageHeader(message: GmailMessage, name: string): string {
  return message.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
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

/** MIME bodies and actual attachments are separate; inline images never enter the shelf. */
export async function resolveProcedureMaterialGmailPacket(params: {
  message: GmailMessage; client: ProcedureMaterialAttachmentClient; savedKeys?: ReadonlySet<string>;
}): Promise<ProcedureMaterialPacket> {
  const packet: ProcedureMaterialPacket = { text: null, photos: [], duplicate: 0, skippedAttachments: 0, warnings: [] };
  const plain: GmailMessagePart[] = [];
  const html: GmailMessagePart[] = [];
  const attachments: Array<{ part: GmailMessagePart; path: string }> = [];
  function walk(part: GmailMessagePart, path: string) {
    const disposition = part.headers?.find((h) => h.name.toLowerCase() === 'content-disposition')?.value.trim().toLowerCase() ?? '';
    const contentId = part.headers?.some((h) => h.name.toLowerCase() === 'content-id');
    const attached = disposition.startsWith('attachment');
    const inline = disposition.startsWith('inline') || (!attached && contentId);
    const mime = part.mimeType?.toLowerCase();
    if (inline && (part.filename || (mime !== 'text/plain' && mime !== 'text/html'))) {
      packet.skippedAttachments++;
      return;
    }
    if (part.filename || attached || (part.body?.attachmentId && mime !== 'text/plain' && mime !== 'text/html')) {
      attachments.push({ part, path });
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
    packet.text = (plain.length ? bodies.join('\n') : bodies.map(htmlToText).join('\n')).trim() || null;
  }
  for (const { part, path } of attachments) {
    const filename = part.filename?.normalize('NFC').trim() || 'photo';
    const contentType = part.mimeType?.trim().toLowerCase() ?? '';
    const key = `${params.message.id}:${createHash('sha256').update(`${filename}\n${part.partId ?? path}`).digest('hex')}`;
    if (!PHOTO_FORMATS[contentType] || (part.body?.size ?? 0) > PROCEDURE_MATERIAL_MAX_PHOTO_BYTES) {
      packet.skippedAttachments++;
      packet.warnings.push(`${filename}: 対応外の添付または10 MB超過`);
      continue;
    }
    if (params.savedKeys?.has(key)) { packet.duplicate++; continue; }
    // eslint-disable-next-line no-await-in-loop
    const buffer = await bytes(part);
    if (buffer.length > PROCEDURE_MATERIAL_MAX_PHOTO_BYTES) {
      packet.skippedAttachments++; packet.warnings.push(`${filename}: 10 MB超過`); continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const metadata = await sharp(buffer).metadata();
      if (metadata.format !== PHOTO_FORMATS[contentType] || !metadata.width || !metadata.height) throw new Error('画像形式が一致しません');
      // Validate the decoded pixels as well as the header before accepting the original.
      // eslint-disable-next-line no-await-in-loop
      await sharp(buffer).stats();
      packet.photos.push({ gmailDedupeKey: key, filename, buffer, contentType, width: metadata.width, height: metadata.height, sha256: createHash('sha256').update(buffer).digest('hex') });
    } catch {
      packet.skippedAttachments++; packet.warnings.push(`${filename}: 画像を読み取れません`);
    }
  }
  return packet;
}
