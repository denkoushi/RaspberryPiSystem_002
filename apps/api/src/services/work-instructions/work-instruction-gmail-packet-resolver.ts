import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';

import {
  parseWorkInstructionManifest,
  WorkInstructionManifestError,
} from './domain/manifest.js';
import { normalizeWorkInstructionImageName } from './domain/normalization.js';
import type {
  WorkInstructionAssetInput,
  WorkInstructionImageMimeType,
  WorkInstructionPacket,
} from './domain/types.js';
import { computeWorkInstructionContentHash } from './domain/update-policy.js';
import type { GmailMessage, GmailMessagePart } from '../backup/gmail-api-client.js';

export type WorkInstructionGmailAttachment = {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  isInline: boolean;
};

export type WorkInstructionGmailPacket = {
  packet: WorkInstructionPacket;
  assets: ReadonlyArray<WorkInstructionAssetInput>;
  assetBytes: ReadonlyMap<string, Buffer>;
  warnings: ReadonlyArray<string>;
  manifestFilename: string;
};

export type WorkInstructionAttachmentClient = {
  getAttachment: (messageId: string, attachmentId: string) => Promise<Buffer>;
};

export type WorkInstructionAttachmentPart = {
  filename: string;
  mimeType: string;
  isInline: boolean;
  attachmentId?: string;
  data?: string;
};

const MIME_BY_SHARP_FORMAT: Record<string, WorkInstructionImageMimeType | undefined> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

function headerValue(part: GmailMessagePart, name: string): string | undefined {
  return part.headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value;
}

function isPotentialAttachment(part: GmailMessagePart): boolean {
  const filename = part.filename?.trim() ?? '';
  const mimeType = part.mimeType?.trim().toLowerCase() ?? '';
  return Boolean(
    filename ||
      part.body?.attachmentId ||
      (part.body?.data && (mimeType === 'application/json' || mimeType.startsWith('image/')))
  );
}

/**
 * Enumerate named Gmail MIME parts without changing the existing collector's
 * attachmentId-only contract. Small parts can contain body.data directly.
 */
export function collectWorkInstructionAttachmentParts(
  message: GmailMessage
): WorkInstructionAttachmentPart[] {
  const result: WorkInstructionAttachmentPart[] = [];

  const walk = (part: GmailMessagePart | undefined): void => {
    if (!part) return;
    // Preserve the original filename for exact attachment matching and
    // diagnostics. Trimming is used only to decide whether it is blank.
    const filename = part.filename ?? '';
    const mimeType = part.mimeType?.trim() ?? '';
    const disposition = headerValue(part, 'Content-Disposition')?.trim().toLowerCase() ?? '';
    const contentId = headerValue(part, 'Content-ID')?.trim() ?? '';
    const explicitlyAttached = disposition.startsWith('attachment');
    const isInline = disposition.startsWith('inline') || (!explicitlyAttached && contentId.length > 0);
    const attachmentId = part.body?.attachmentId;
    const data = part.body?.data;
    if (isPotentialAttachment(part) && (attachmentId || data)) {
      result.push({ filename, mimeType, isInline, attachmentId, data });
    }
    for (const child of part.parts ?? []) walk(child);
  };

  walk(message.payload);
  return result;
}

function decodeInlineData(data: string): Buffer {
  return Buffer.from(data, 'base64url');
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function decodeAndValidateImage(
  attachment: WorkInstructionGmailAttachment,
  imageName: string
): Promise<{ mimeType: WorkInstructionImageMimeType; sha256: string }> {
  // metadata alone may accept truncated input. stats() forces libvips to
  // decode the complete payload while leaving the original bytes untouched.
  let metadata: { format?: string };
  try {
    metadata = await sharp(attachment.buffer).metadata();
    await sharp(attachment.buffer).stats();
  } catch (error) {
    throw new WorkInstructionManifestError(
      `Referenced image ${imageName} could not be decoded: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const mimeType = MIME_BY_SHARP_FORMAT[metadata.format?.toLowerCase() ?? ''];
  if (!mimeType) {
    throw new WorkInstructionManifestError(
      `Referenced image ${imageName} is not a supported JPEG, PNG, or WebP image`
    );
  }
  return { mimeType, sha256: sha256(attachment.buffer) };
}

function isJsonCandidate(attachment: Pick<WorkInstructionGmailAttachment, 'filename' | 'mimeType'>): boolean {
  const filename = attachment.filename.trim().toLowerCase();
  const mimeType = attachment.mimeType.trim().toLowerCase();
  return filename.endsWith('.json') || mimeType === 'application/json' || mimeType.endsWith('+json');
}

function parseJsonCandidate(attachment: WorkInstructionGmailAttachment): unknown | undefined {
  try {
    const text = attachment.buffer.toString('utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function looksLikeWorkInstructionManifest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.schema_version !== undefined &&
    record.source !== undefined &&
    record.steps !== undefined;
}

/**
 * Resolve exactly one schema-versioned manifest and its referenced images.
 * Unreferenced attachments are retained only as warnings; no bytes are
 * transformed before the repository stages them.
 */
export async function resolveWorkInstructionGmailPacket(params: {
  message: GmailMessage;
  client: WorkInstructionAttachmentClient;
}): Promise<WorkInstructionGmailPacket> {
  const parts = collectWorkInstructionAttachmentParts(params.message);
  const materialize = async (part: WorkInstructionAttachmentPart): Promise<WorkInstructionGmailAttachment> => ({
    filename: part.filename,
    mimeType: part.mimeType,
    buffer: part.attachmentId
      ? await params.client.getAttachment(params.message.id, part.attachmentId)
      : decodeInlineData(part.data ?? ''),
    isInline: part.isInline,
  });

  // Read only JSON-looking parts first. Unrelated attachments are warnings;
  // fetching them can otherwise turn an otherwise valid packet into a retry.
  const manifestCandidates: Array<{
    part: WorkInstructionAttachmentPart;
    attachment: WorkInstructionGmailAttachment;
    value: unknown;
  }> = [];
  for (const part of parts.filter(isJsonCandidate)) {
    const attachment = await materialize(part);
    const value = parseJsonCandidate(attachment);
    if (value !== undefined && looksLikeWorkInstructionManifest(value)) {
      manifestCandidates.push({ part, attachment, value });
    }
  }

  if (manifestCandidates.length === 0) {
    throw new WorkInstructionManifestError('Exactly one schema-versioned work-instruction manifest is required');
  }
  if (manifestCandidates.length > 1) {
    throw new WorkInstructionManifestError('Multiple schema-versioned work-instruction manifests were attached');
  }

  const manifestCandidate = manifestCandidates[0]!;
  const parsed = parseWorkInstructionManifest(manifestCandidate.value);
  const imageParts = parts.filter((part) => part !== manifestCandidate.part);
  const imageByExactName = new Map<string, WorkInstructionAttachmentPart[]>();
  for (const part of imageParts) {
    const name = normalizeWorkInstructionImageName(part.filename);
    if (!name) continue;
    const bucket = imageByExactName.get(name) ?? [];
    bucket.push(part);
    imageByExactName.set(name, bucket);
  }

  const assets: WorkInstructionAssetInput[] = [];
  const assetBytes = new Map<string, Buffer>();
  const assetByImageName = new Map<string, WorkInstructionAssetInput>();
  const imageHashes: Array<{ imageName: string; sha256: string }> = [];
  const referencedNames = new Set<string>();
  const steps = parsed.steps.map((step) => ({ ...step }));
  for (const step of steps) {
    if (!step.imageName) continue;
    const imageName = normalizeWorkInstructionImageName(step.imageName);
    referencedNames.add(imageName);
    const matches = imageByExactName.get(imageName) ?? [];
    if (matches.length === 0) {
      throw new WorkInstructionManifestError(`Referenced image is missing: ${imageName}`);
    }
    if (matches.length > 1) {
      throw new WorkInstructionManifestError(`Referenced image filename is not unique: ${imageName}`);
    }
    const image = await materialize(matches[0]!);
    let asset = assetByImageName.get(imageName);
    if (!asset) {
      const validated = await decodeAndValidateImage(image, imageName);
      const assetId = randomUUID();
      asset = {
        assetId,
        imageName,
        // Asset paths are immutable. Staging is a database status, not a
        // rename, so the later pointer switch never moves bytes.
        storageKey: `work-instruction-assets/${assetId}`,
        mimeType: validated.mimeType,
        sizeBytes: image.buffer.length,
        sha256: validated.sha256,
      };
      assets.push(asset);
      assetByImageName.set(imageName, asset);
      assetBytes.set(assetId, image.buffer);
      imageHashes.push({ imageName, sha256: validated.sha256 });
    }
    step.imageHash = asset.sha256;
  }

  const warnings: string[] = [];
  for (const part of imageParts) {
    const name = normalizeWorkInstructionImageName(part.filename);
    if (!name || !referencedNames.has(name)) {
      warnings.push(`Unreferenced attachment ignored: ${part.filename || '(unnamed)'}`);
    }
  }

  const packet: WorkInstructionPacket = {
    ...parsed,
    contentHash: computeWorkInstructionContentHash(parsed.rawManifest, imageHashes),
    steps,
  };
  return {
    packet,
    assets,
    assetBytes,
    warnings,
    manifestFilename: manifestCandidate.attachment.filename || 'unnamed.json',
  };
}

/** Read the subject header without requiring consumers to duplicate MIME traversal. */
export function getGmailMessageSubject(message: GmailMessage): string {
  return message.payload?.headers?.find((header) => header.name.toLowerCase() === 'subject')?.value ?? '';
}

/** Read the sender header for optional config-level filtering. */
export function getGmailMessageFrom(message: GmailMessage): string | undefined {
  return message.payload?.headers?.find((header) => header.name.toLowerCase() === 'from')?.value;
}
