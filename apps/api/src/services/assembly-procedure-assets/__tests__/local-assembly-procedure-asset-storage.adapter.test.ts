import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileStorageIntegrityCatalog } from '../../file-storage/file-storage-integrity-catalog.js';
import { LocalDurableFileStore } from '../../file-storage/local-durable-file-store.js';
import {
  LocalAssemblyProcedureAssetStorageAdapter,
  resolveAssemblyProcedureAssetStoragePath,
} from '../local-assembly-procedure-asset-storage.adapter.js';

describe('LocalAssemblyProcedureAssetStorageAdapter', () => {
  let root: string;
  let adapter: LocalAssemblyProcedureAssetStorageAdapter;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'assembly-procedure-assets-'));
    const catalog = new FileStorageIntegrityCatalog(root);
    const store = new LocalDurableFileStore(root, catalog, {
      minimumFreeBytes: 1,
      capacityReader: async () => ({ availableBytes: 10_000_000, totalBytes: 10_000_000 }),
    });
    adapter = new LocalAssemblyProcedureAssetStorageAdapter({ store });
    await adapter.initialize();
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stores an immutable asset with a catalog hash and relative URL', async () => {
    const data = Buffer.from('original-pdf');
    const asset = await adapter.save({
      assetId: 'asset-1',
      data,
      contentType: 'application/pdf',
    });

    expect(asset).toMatchObject({
      assetId: 'asset-1',
      storageKey: 'assembly-procedure-assets/asset-1.pdf',
      relativeUrl: '/api/storage/assembly-procedure-assets/asset-1.pdf',
      contentType: 'application/pdf',
      size: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    });
    await expect(adapter.read(asset)).resolves.toEqual(data);
    await expect(
      adapter.save({ assetId: 'asset-1', data: Buffer.from('replacement'), contentType: 'application/pdf' }),
    ).rejects.toMatchObject({ code: 'FILE_STORAGE_ALREADY_EXISTS' });
    await expect(adapter.read(asset)).resolves.toEqual(data);
  });

  it('canonicalizes TIFF aliases and rejects traversal URL paths', async () => {
    const asset = await adapter.save({
      assetId: 'scan-1',
      data: Buffer.from('tiff'),
      contentType: 'image/x-tiff',
      extension: '.tif',
    });
    expect(asset.storageKey).toBe('assembly-procedure-assets/scan-1.tiff');
    expect(resolveAssemblyProcedureAssetStoragePath('scan-1.tiff')).toMatchObject({
      assetId: 'scan-1',
      contentType: 'image/tiff',
    });
    expect(() => resolveAssemblyProcedureAssetStoragePath('../scan-1.tif')).toThrow(
      'Invalid assembly procedure asset path',
    );
  });
});
