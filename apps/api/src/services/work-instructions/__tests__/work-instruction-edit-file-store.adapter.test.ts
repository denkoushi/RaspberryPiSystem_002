import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileStorageIntegrityCatalog } from '../../file-storage/file-storage-integrity-catalog.js';
import { LocalDurableFileStore } from '../../file-storage/local-durable-file-store.js';
import { WORK_INSTRUCTION_EDIT_IMAGE_MAX_BYTES } from '../domain/editing.js';
import {
  normalizeWorkInstructionEditMimeType,
  WorkInstructionEditFileStoreAdapter,
  workInstructionEditStorageKey,
} from '../work-instruction-edit-file-store.adapter.js';

describe('work-instruction edit file-store helpers', () => {
  it('normalizes supported MIME aliases and derives an editor-owned key', () => {
    expect(normalizeWorkInstructionEditMimeType(' image/JPG ')).toBe('image/jpeg');
    expect(normalizeWorkInstructionEditMimeType('IMAGE/TIF')).toBe('image/tiff');
    expect(normalizeWorkInstructionEditMimeType('image/webp')).toBe('image/webp');
    expect(workInstructionEditStorageKey('overlay-1', 'image/png')).toBe(
      'work-instruction-assets/editing/overlay-1.png',
    );
  });

  it('rejects unsupported overlay MIME types', () => {
    expect(() => normalizeWorkInstructionEditMimeType('application/pdf')).toThrow(
      'overlay画像はJPEG/PNG/WebP/TIFFのみ対応しています',
    );
  });
});

describe('WorkInstructionEditFileStoreAdapter', () => {
  let root: string;
  let adapter: WorkInstructionEditFileStoreAdapter;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'work-instruction-edit-file-store-'));
    const catalog = new FileStorageIntegrityCatalog(root);
    const store = new LocalDurableFileStore(root, catalog, {
      minimumFreeBytes: 1,
      capacityReader: async () => ({ availableBytes: 20_000_000, totalBytes: 20_000_000 }),
    });
    await store.initialize(['work-instruction-assets/editing']);
    adapter = new WorkInstructionEditFileStoreAdapter(store);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stores immutable editor assets with normalized metadata and reads/deletes them', async () => {
    const bytes = Buffer.from('overlay-image');
    const stored = await adapter.write({ assetId: 'overlay-1', bytes, mimeType: 'image/JPG' });

    expect(stored).toEqual({
      assetId: 'overlay-1',
      storageKey: 'work-instruction-assets/editing/overlay-1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    await expect(adapter.read({ storageKey: stored.storageKey })).resolves.toEqual(bytes);
    await expect(adapter.write({ assetId: 'overlay-1', bytes, mimeType: 'image/jpeg' })).rejects.toMatchObject({
      code: 'FILE_STORAGE_ALREADY_EXISTS',
    });

    await adapter.delete({ storageKey: stored.storageKey });
    await expect(fs.stat(path.join(root, ...stored.storageKey.split('/')))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects empty, non-buffer, oversized, and out-of-prefix assets', async () => {
    await expect(adapter.write({ assetId: 'empty', bytes: Buffer.alloc(0), mimeType: 'image/png' })).rejects.toThrow(
      'overlay画像が空です',
    );
    await expect(
      adapter.write({ assetId: 'not-a-buffer', bytes: 'bytes' as unknown as Buffer, mimeType: 'image/png' }),
    ).rejects.toThrow('overlay画像が空です');
    await expect(
      adapter.write({
        assetId: 'large',
        bytes: Buffer.alloc(WORK_INSTRUCTION_EDIT_IMAGE_MAX_BYTES + 1),
        mimeType: 'image/png',
      }),
    ).rejects.toThrow('overlay画像が大きすぎます');

    expect(() => adapter.read({ storageKey: 'work-instruction-assets/source/other.jpg' })).toThrow(
      'invalid work-instruction edit asset storage key',
    );
    expect(() => adapter.delete({ storageKey: 'work-instruction-assets/editing/../other.jpg' })).toThrow();
    await expect(
      adapter.write({ assetId: '../escape', bytes: Buffer.from('x'), mimeType: 'image/png' }),
    ).rejects.toThrow();
  });
});
