import { createHash } from 'node:crypto';
import sharp from 'sharp';

import type { GmailMessage, GmailMessagePart } from '../backup/gmail-api-client.js';
import { collectWorkInstructionAttachmentParts } from '../work-instructions/work-instruction-gmail-packet-resolver.js';

export class ItemInventoryManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ItemInventoryManifestError';
  }
}

export type ItemInventoryManifest = {
  schema_version: 1;
  source: {
    system: 'sharepoint';
    list: 'ItemlistRaspi';
    item_id: number;
    modified: string;
  };
  id: number;
  category: string | null;
  location: string;
  note: string | null;
  photos: Array<{ index: number; image: string }>;
};

export type ItemInventoryPhotoAsset = {
  index: number;
  filename: string;
  buffer: Buffer;
  sha256: string;
};

export type ItemInventoryGmailPacket = {
  manifest: ItemInventoryManifest;
  manifestFilename: string;
  contentHash: string;
  photos: ItemInventoryPhotoAsset[];
  warnings: string[];
};

export type ItemInventoryAttachmentClient = {
  getAttachment: (messageId: string, attachmentId: string) => Promise<Buffer>;
};

type AttachmentPart = {
  filename: string;
  mimeType: string;
  attachmentId?: string;
  data?: string;
};

function normalizeFilename(value: string): string {
  return value.normalize('NFC').trim();
}

function isJsonPart(part: Pick<AttachmentPart, 'filename' | 'mimeType'>): boolean {
  const filename = normalizeFilename(part.filename).toLocaleLowerCase('en-US');
  const mimeType = part.mimeType.trim().toLocaleLowerCase('en-US');
  return filename.endsWith('.json') || mimeType === 'application/json' || mimeType.endsWith('+json');
}

function decodeInlineData(data: string): Buffer {
  return Buffer.from(data, 'base64url');
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function parseManifest(value: unknown): ItemInventoryManifest {
  if (!value || typeof value !== 'object') throw new ItemInventoryManifestError('Manifest must be a JSON object');
  const input = value as Record<string, unknown>;
  if (input.schema_version !== 1) throw new ItemInventoryManifestError('schema_version must be 1');
  const source = input.source;
  if (!source || typeof source !== 'object') throw new ItemInventoryManifestError('source is required');
  const sourceRecord = source as Record<string, unknown>;
  if (sourceRecord.system !== 'sharepoint' || sourceRecord.list !== 'ItemlistRaspi') {
    throw new ItemInventoryManifestError('source must identify SharePoint ItemlistRaspi');
  }
  if (!Number.isSafeInteger(sourceRecord.item_id) || Number(sourceRecord.item_id) < 1) {
    throw new ItemInventoryManifestError('source.item_id must be a positive integer');
  }
  if (typeof sourceRecord.modified !== 'string' || !Number.isFinite(Date.parse(sourceRecord.modified))) {
    throw new ItemInventoryManifestError('source.modified must be an ISO date');
  }
  if (!Number.isSafeInteger(input.id) || Number(input.id) < 1) {
    throw new ItemInventoryManifestError('id must be a positive integer');
  }
  if (Number(input.id) !== Number(sourceRecord.item_id)) {
    throw new ItemInventoryManifestError('id must match source.item_id');
  }
  if (typeof input.location !== 'string' || !input.location.trim()) {
    throw new ItemInventoryManifestError('location is required');
  }
  const category = input.category == null ? null : input.category;
  const note = input.note == null ? null : input.note;
  if (typeof category !== 'string' && category !== null) throw new ItemInventoryManifestError('category must be a string');
  if (typeof note !== 'string' && note !== null) throw new ItemInventoryManifestError('note must be a string');
  if (!Array.isArray(input.photos) || input.photos.length === 0) {
    throw new ItemInventoryManifestError('photos must contain at least one image reference');
  }
  const photos: Array<{ index: number; image: string }> = [];
  const indexes = new Set<number>();
  const names = new Set<string>();
  for (const entry of input.photos) {
    if (!entry || typeof entry !== 'object') throw new ItemInventoryManifestError('photos entries must be objects');
    const photo = entry as Record<string, unknown>;
    if (!Number.isSafeInteger(photo.index) || Number(photo.index) < 1) {
      throw new ItemInventoryManifestError('photo index must be a positive integer');
    }
    const image = typeof photo.image === 'string' ? normalizeFilename(photo.image) : '';
    if (!image) throw new ItemInventoryManifestError('photo image filename is required');
    if (indexes.has(Number(photo.index))) throw new ItemInventoryManifestError(`duplicate photo index: ${photo.index}`);
    if (names.has(image)) throw new ItemInventoryManifestError(`duplicate photo filename: ${image}`);
    indexes.add(Number(photo.index));
    names.add(image);
    photos.push({ index: Number(photo.index), image });
  }
  photos.sort((left, right) => left.index - right.index);
  return {
    schema_version: 1,
    source: {
      system: 'sharepoint',
      list: 'ItemlistRaspi',
      item_id: Number(sourceRecord.item_id),
      modified: sourceRecord.modified as string,
    },
    id: Number(input.id),
    category: category as string | null,
    location: input.location.trim(),
    note: note as string | null,
    photos,
  };
}

function headerValue(part: GmailMessagePart, name: string): string | undefined {
  return part.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

export function getItemInventoryGmailSubject(message: GmailMessage): string {
  return headerValue(message.payload ?? {}, 'subject') ?? '';
}

export function getGmailMessageFrom(message: GmailMessage): string | undefined {
  return headerValue(message.payload ?? {}, 'from');
}

/** Resolve the fixed manifest contract and pair every referenced photo by filename. */
export async function resolveItemInventoryGmailPacket(params: {
  message: GmailMessage;
  client: ItemInventoryAttachmentClient;
}): Promise<ItemInventoryGmailPacket> {
  const parts: AttachmentPart[] = collectWorkInstructionAttachmentParts(params.message).map((part) => ({
    filename: part.filename,
    mimeType: part.mimeType,
    attachmentId: part.attachmentId,
    data: part.data,
  }));
  const materialize = async (part: AttachmentPart): Promise<Buffer> =>
    part.attachmentId
      ? params.client.getAttachment(params.message.id, part.attachmentId)
      : decodeInlineData(part.data ?? '');
  const jsonParts = parts.filter(isJsonPart);
  if (jsonParts.length !== 1) {
    throw new ItemInventoryManifestError(`Exactly one JSON manifest attachment is required; found ${jsonParts.length}`);
  }
  const manifestPart = jsonParts[0]!;
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse((await materialize(manifestPart)).toString('utf8').replace(/^\uFEFF/, '')) as unknown;
  } catch {
    throw new ItemInventoryManifestError(`Manifest attachment ${manifestPart.filename || '(unnamed)'} is not valid JSON`);
  }
  const manifest = parseManifest(manifestValue);
  const byName = new Map<string, AttachmentPart[]>();
  for (const part of parts) {
    if (part === manifestPart) continue;
    const name = normalizeFilename(part.filename);
    if (!name) continue;
    const matches = byName.get(name) ?? [];
    matches.push(part);
    byName.set(name, matches);
  }
  const photos: ItemInventoryPhotoAsset[] = [];
  const referenced = new Set<string>();
  for (const reference of manifest.photos) {
    referenced.add(reference.image);
    const matches = byName.get(reference.image) ?? [];
    if (matches.length === 0) throw new ItemInventoryManifestError(`Referenced image is missing: ${reference.image}`);
    if (matches.length > 1) throw new ItemInventoryManifestError(`Referenced image filename is not unique: ${reference.image}`);
    const buffer = await materialize(matches[0]!);
    let metadata: { format?: string };
    try {
      metadata = await sharp(buffer).metadata();
      await sharp(buffer).stats();
    } catch (error) {
      throw new ItemInventoryManifestError(`Referenced image ${reference.image} could not be decoded: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (metadata.format?.toLowerCase() !== 'jpeg' && metadata.format?.toLowerCase() !== 'jpg') {
      throw new ItemInventoryManifestError(`Referenced image ${reference.image} must be a JPEG image`);
    }
    photos.push({ index: reference.index, filename: reference.image, buffer, sha256: sha256(buffer) });
  }
  const warnings = parts
    .filter((part) => part !== manifestPart)
    .map((part) => normalizeFilename(part.filename))
    .filter((name) => name && !referenced.has(name))
    .map((name) => `Unreferenced attachment ignored: ${name}`);
  const contentHash = sha256(`${stableJson(manifest)}\n${photos
    .slice()
    .sort((left, right) => left.index - right.index)
    .map((photo) => `${photo.index}\t${photo.filename}\t${photo.sha256}`)
    .join('\n')}`);
  return {
    manifest,
    manifestFilename: manifestPart.filename || 'unnamed.json',
    contentHash,
    photos,
    warnings,
  };
}
