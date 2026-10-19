import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';

import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import { normalizeStorageKey } from '../file-storage/secure-atomic-file.js';
import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import {
  ASSEMBLY_PROCEDURE_ASSET_CONTENT_TYPES,
  ASSEMBLY_PROCEDURE_ASSET_MAX_BYTES,
  ASSEMBLY_PROCEDURE_ASSET_NAMESPACE,
  ASSEMBLY_PROCEDURE_ASSET_URL_PREFIX,
  type AssemblyProcedureAssetContentType,
  type AssemblyProcedureAssetLocation,
  type AssemblyProcedureAssetReference,
  type AssemblyProcedureAssetSaveInput,
  type AssemblyProcedureAssetStoragePort,
  type StoredAssemblyProcedureAsset,
  ASSEMBLY_PROCEDURE_OVERLAY_IMAGE_MAX_BYTES,
} from './assembly-procedure-asset-storage.port.js';

const MIME_TO_EXTENSION: Record<AssemblyProcedureAssetContentType, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/tiff': '.tiff',
  'image/webp': '.webp',
};

const MIME_ALIASES: Record<string, AssemblyProcedureAssetContentType> = {
  'application/pdf': 'application/pdf',
  'image/jpg': 'image/jpeg',
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/tif': 'image/tiff',
  'image/tiff': 'image/tiff',
  'image/x-tiff': 'image/tiff',
  'image/webp': 'image/webp',
};

const ASSET_ID_PATTERN = /^[a-zA-Z0-9_-]{1,120}$/;
const EXTENSION_PATTERN = /^\.[a-zA-Z0-9]{1,12}$/;

export type LocalAssemblyProcedureAssetStorageAdapterOptions = {
  store?: DurableFileStorePort;
  maxBytes?: number;
};

export function normalizeAssemblyProcedureAssetContentType(
  contentType: string,
): AssemblyProcedureAssetContentType {
  const normalized = MIME_ALIASES[contentType.trim().toLowerCase()];
  if (!normalized || !ASSEMBLY_PROCEDURE_ASSET_CONTENT_TYPES.includes(normalized)) {
    throw new Error(`Unsupported assembly procedure asset content type: ${contentType}`);
  }
  return normalized;
}

export function extensionForAssemblyProcedureAssetContentType(
  contentType: string,
): string {
  return MIME_TO_EXTENSION[normalizeAssemblyProcedureAssetContentType(contentType)];
}

function normalizeAssetId(assetId: string): string {
  if (!ASSET_ID_PATTERN.test(assetId)) {
    throw new Error('Invalid assembly procedure asset id');
  }
  return assetId;
}

function normalizeExtension(extension: string | undefined, contentType: AssemblyProcedureAssetContentType): string {
  if (extension === undefined || extension.trim() === '') {
    return MIME_TO_EXTENSION[contentType];
  }
  const normalized = extension.trim().toLowerCase();
  if (!EXTENSION_PATTERN.test(normalized)) {
    throw new Error('Invalid assembly procedure asset extension');
  }
  // Keep generated URLs canonical. In particular, TIFF aliases are always
  // persisted as `.tiff`, even when the multipart filename ends in `.tif`.
  const canonical = MIME_TO_EXTENSION[contentType];
  const aliases = contentType === 'image/jpeg' ? ['.jpg', '.jpeg'] :
    contentType === 'image/tiff' ? ['.tif', '.tiff'] : [canonical];
  if (!aliases.includes(normalized)) {
    throw new Error('Asset extension does not match content type');
  }
  return canonical;
}

function toStorageKey(assetId: string, extension: string): string {
  return `${ASSEMBLY_PROCEDURE_ASSET_NAMESPACE}/${assetId}${extension}`;
}

function toReference(input: {
  assetId: string;
  storageKey: string;
  contentType: AssemblyProcedureAssetContentType;
  size: number;
  sha256: string;
}): StoredAssemblyProcedureAsset {
  return {
    ...input,
    relativeUrl: `${ASSEMBLY_PROCEDURE_ASSET_URL_PREFIX}${input.assetId}${input.storageKey.slice(
      input.storageKey.lastIndexOf('.'),
    )}`,
  };
}

/**
 * Local adapter backed by the repository's atomic durable file store.
 * Every write uses `create`, so a successful asset can never be replaced by
 * a later request. `delete` is intentionally separate and is only for the
 * caller's compensation path before the asset has been referenced by DB.
 */
export class LocalAssemblyProcedureAssetStorageAdapter
  implements AssemblyProcedureAssetStoragePort
{
  private readonly store: DurableFileStorePort;
  private readonly maxBytes: number;

  constructor(options: LocalAssemblyProcedureAssetStorageAdapterOptions = {}) {
    this.store = options.store ?? getFileStorageRuntime().store;
    this.maxBytes = options.maxBytes ?? ASSEMBLY_PROCEDURE_ASSET_MAX_BYTES;
  }

  async initialize(): Promise<void> {
    await this.store.initialize([ASSEMBLY_PROCEDURE_ASSET_NAMESPACE]);
  }

  async save(input: AssemblyProcedureAssetSaveInput): Promise<StoredAssemblyProcedureAsset> {
    if (!Buffer.isBuffer(input.data) || input.data.length === 0) {
      throw new Error('Assembly procedure asset data is empty');
    }
    if (input.data.length > this.maxBytes) {
      throw new Error(`Assembly procedure asset is too large (max ${this.maxBytes} bytes)`);
    }

    const contentType = normalizeAssemblyProcedureAssetContentType(input.contentType);
    const assetId = normalizeAssetId(input.assetId ?? randomUUID());
    const extension = normalizeExtension(input.extension, contentType);
    const storageKey = toStorageKey(assetId, extension);
    const saved = await this.store.write({
      key: storageKey,
      data: input.data,
      mode: 'create',
      integrity: true,
    });
    return toReference({
      assetId,
      storageKey: saved.key,
      contentType,
      size: saved.size,
      sha256: saved.sha256,
    });
  }

  async read(reference: AssemblyProcedureAssetLocation): Promise<Buffer> {
    return this.store.read(this.assertReferenceKey(reference), { verifyIntegrity: true });
  }

  async stat(reference: AssemblyProcedureAssetLocation): Promise<Stats> {
    return this.store.stat(this.assertReferenceKey(reference));
  }

  async delete(reference: AssemblyProcedureAssetLocation): Promise<void> {
    await this.store.delete(this.assertReferenceKey(reference), { integrity: true });
  }

  private assertReferenceKey(reference: AssemblyProcedureAssetLocation): string {
    const key = normalizeStorageKey(reference.storageKey);
    if (!key.startsWith(`${ASSEMBLY_PROCEDURE_ASSET_NAMESPACE}/`)) {
      throw new Error('Invalid assembly procedure asset storage key');
    }
    return key;
  }
}

let runtimeAdapter: LocalAssemblyProcedureAssetStorageAdapter | null = null;

export function getAssemblyProcedureAssetStorage(): LocalAssemblyProcedureAssetStorageAdapter {
  if (!runtimeAdapter) {
    runtimeAdapter = new LocalAssemblyProcedureAssetStorageAdapter();
  }
  return runtimeAdapter;
}

export function resetAssemblyProcedureAssetStorageForTests(): void {
  runtimeAdapter = null;
}

/**
 * Convert a URL path returned by the adapter into a safe immutable reference.
 * This is shared by the storage route and tests; it does not consult the DB.
 */
export function resolveAssemblyProcedureAssetStoragePath(
  rawPath: string,
): Pick<AssemblyProcedureAssetReference, 'assetId' | 'storageKey' | 'relativeUrl' | 'contentType'> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath).split('?')[0] ?? '';
  } catch {
    throw new Error('Invalid assembly procedure asset path');
  }
  if (!decoded || decoded.includes('\0') || decoded.includes('\\')) {
    throw new Error('Invalid assembly procedure asset path');
  }
  const basename = decoded.split('/').at(-1) ?? '';
  const segments = decoded.split('/');
  if (segments.length !== 1 || !basename || basename.includes('..')) {
    throw new Error('Invalid assembly procedure asset path');
  }
  const extension = basename.slice(basename.lastIndexOf('.')).toLowerCase();
  const assetId = basename.slice(0, basename.lastIndexOf('.'));
  if (!ASSET_ID_PATTERN.test(assetId) || !EXTENSION_PATTERN.test(extension)) {
    throw new Error('Invalid assembly procedure asset path');
  }
  const contentType = Object.entries(MIME_TO_EXTENSION).find(([, value]) => value === extension)?.[0];
  if (!contentType) {
    throw new Error('Unsupported assembly procedure asset extension');
  }
  const storageKey = toStorageKey(assetId, extension);
  return {
    assetId,
    storageKey,
    relativeUrl: `${ASSEMBLY_PROCEDURE_ASSET_URL_PREFIX}${basename}`,
    contentType: contentType as AssemblyProcedureAssetContentType,
  };
}

export function getAssemblyProcedureAssetMaxBytes(): number {
  return ASSEMBLY_PROCEDURE_ASSET_MAX_BYTES;
}

export function getAssemblyProcedureOverlayImageMaxBytes(): number {
  return ASSEMBLY_PROCEDURE_OVERLAY_IMAGE_MAX_BYTES;
}
