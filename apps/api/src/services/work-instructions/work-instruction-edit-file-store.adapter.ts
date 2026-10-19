import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { normalizeStorageKey } from '../file-storage/secure-atomic-file.js';
import { WORK_INSTRUCTION_EDIT_IMAGE_MAX_BYTES } from './domain/editing.js';

const EDIT_ASSET_PREFIX = 'work-instruction-assets/editing';
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/tiff': '.tiff',
  'image/tif': '.tiff'
};

export function normalizeWorkInstructionEditMimeType(mimeType: string): string {
  const normalized = mimeType.trim().toLowerCase();
  if (!MIME_TO_EXTENSION[normalized]) throw new Error('overlay画像はJPEG/PNG/WebP/TIFFのみ対応しています');
  return normalized === 'image/jpg' ? 'image/jpeg' : normalized === 'image/tif' ? 'image/tiff' : normalized;
}

export function workInstructionEditStorageKey(assetId: string, mimeType: string): string {
  const normalized = normalizeWorkInstructionEditMimeType(mimeType);
  const extension = MIME_TO_EXTENSION[normalized];
  return `${EDIT_ASSET_PREFIX}/${assetId}${extension}`;
}

export type WorkInstructionEditStoredAsset = {
  assetId: string;
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
};

export interface WorkInstructionEditFileStorePort {
  write(input: { assetId: string; bytes: Buffer; mimeType: string }): Promise<WorkInstructionEditStoredAsset>;
  read(input: { storageKey: string }): Promise<Buffer>;
  delete(input: { storageKey: string }): Promise<void>;
}

function assertKey(storageKey: string): string {
  const normalized = normalizeStorageKey(storageKey);
  if (!normalized.startsWith(`${EDIT_ASSET_PREFIX}/`)) {
    throw new Error('invalid work-instruction edit asset storage key');
  }
  return normalized;
}

/** Durable adapter for editor-created images. Original import assets never use this prefix. */
export class WorkInstructionEditFileStoreAdapter implements WorkInstructionEditFileStorePort {
  constructor(private readonly store: DurableFileStorePort = getFileStorageRuntime().store) {}

  async write(input: { assetId: string; bytes: Buffer; mimeType: string }): Promise<WorkInstructionEditStoredAsset> {
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) throw new Error('overlay画像が空です');
    if (input.bytes.length > WORK_INSTRUCTION_EDIT_IMAGE_MAX_BYTES) throw new Error('overlay画像が大きすぎます');
    const mimeType = normalizeWorkInstructionEditMimeType(input.mimeType);
    const storageKey = workInstructionEditStorageKey(input.assetId, mimeType);
    const saved = await this.store.write({
      key: assertKey(storageKey),
      data: input.bytes,
      mode: 'create',
      integrity: true
    });
    return {
      assetId: input.assetId,
      storageKey: saved.key,
      mimeType,
      sizeBytes: saved.size,
      sha256: saved.sha256
    };
  }

  read(input: { storageKey: string }): Promise<Buffer> {
    return this.store.read(assertKey(input.storageKey), { verifyIntegrity: true });
  }

  delete(input: { storageKey: string }): Promise<void> {
    return this.store.delete(assertKey(input.storageKey), { integrity: true });
  }
}
