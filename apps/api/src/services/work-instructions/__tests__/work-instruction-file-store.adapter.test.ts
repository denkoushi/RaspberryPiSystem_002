import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileStorageIntegrityCatalog } from '../../file-storage/file-storage-integrity-catalog.js';
import { LocalDurableFileStore } from '../../file-storage/local-durable-file-store.js';
import type { WorkInstructionStagedAsset } from '../domain/types.js';
import { WorkInstructionFileStoreAdapter } from '../work-instruction-file-store.adapter.js';

describe('WorkInstructionFileStoreAdapter', () => {
  let root: string;
  let adapter: WorkInstructionFileStoreAdapter;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'work-instruction-file-store-'));
    const catalog = new FileStorageIntegrityCatalog(root);
    const store = new LocalDurableFileStore(root, catalog, {
      minimumFreeBytes: 1,
      capacityReader: async () => ({ availableBytes: 10_000_000, totalBytes: 10_000_000 }),
    });
    await store.initialize(['work-instruction-assets']);
    adapter = new WorkInstructionFileStoreAdapter(store);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('writes staged assets with verified metadata, reads them, and deletes them', async () => {
    const bytes = Buffer.from('source-image');
    const asset: WorkInstructionStagedAsset = {
      assetId: 'asset-1',
      imageName: 'step-1.jpg',
      storageKey: 'work-instruction-assets/source/asset-1.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      status: 'STAGED',
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
    };

    await expect(adapter.writeStagedAssets([asset], new Map([[asset.assetId, bytes]]))).resolves.toEqual([
      { key: asset.storageKey, sha256: asset.sha256, size: bytes.length },
    ]);
    await expect(adapter.read(asset)).resolves.toEqual(bytes);

    await adapter.delete(asset);
    await expect(fs.stat(path.join(root, ...asset.storageKey.split('/')))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns an empty result for an empty staging batch', async () => {
    await expect(adapter.writeStagedAssets([], new Map())).resolves.toEqual([]);
  });

  it('rejects missing bytes and integrity mismatches before publishing a staged asset', async () => {
    const bytes = Buffer.from('source-image');
    const asset: WorkInstructionStagedAsset = {
      assetId: 'asset-2',
      imageName: 'step-2.png',
      storageKey: 'work-instruction-assets/source/asset-2.png',
      mimeType: 'image/png',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      status: 'STAGED',
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
    };

    await expect(adapter.writeStagedAssets([asset], new Map())).rejects.toThrow(
      'Missing bytes for staged work-instruction asset asset-2',
    );
    await expect(
      adapter.writeStagedAssets([asset], new Map([[asset.assetId, Buffer.from('different')]])),
    ).rejects.toThrow('Staged work-instruction asset integrity mismatch: asset-2');
    await expect(fs.stat(path.join(root, ...asset.storageKey.split('/')))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
