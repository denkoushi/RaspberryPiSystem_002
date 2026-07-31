import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStorageIntegrityCatalog } from '../file-storage-integrity-catalog.js';
import {
  FileStorageCapacityExhaustedError,
  FileStorageIntegrityMismatchError,
  FileStorageInvalidPathError,
} from '../file-storage-errors.js';
import { LocalDurableFileStore } from '../local-durable-file-store.js';

describe('LocalDurableFileStore', () => {
  let root: string;
  let catalog: FileStorageIntegrityCatalog;
  let store: LocalDurableFileStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-durable-file-store-'));
    catalog = new FileStorageIntegrityCatalog(root);
    store = new LocalDurableFileStore(root, catalog, {
      minimumFreeBytes: 1,
      capacityReader: async () => ({
        availableBytes: 10_000_000,
        totalBytes: 10_000_000,
      }),
    });
    await store.initialize(['photos']);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('atomically creates a durable file and verifies its integrity record on read', async () => {
    const data = Buffer.from('durable-data');
    await store.write({
      key: 'photos/2026/07/example.jpg',
      data,
      mode: 'create',
      integrity: true,
    });

    await expect(
      store.read('photos/2026/07/example.jpg', { verifyIntegrity: true })
    ).resolves.toEqual(data);
    await expect(catalog.get('photos/2026/07/example.jpg')).resolves.toMatchObject({
      version: 1,
      sha256: createHash('sha256').update(data).digest('hex'),
      size: data.length,
    });
  });

  it('rejects traversal, absolute paths, NUL and a symlink escape', async () => {
    for (const key of ['../escape', '/tmp/escape', 'photos/../escape', 'photos/a\0b']) {
      await expect(
        store.write({
          key,
          data: Buffer.from('x'),
          mode: 'create',
          integrity: true,
        })
      ).rejects.toBeInstanceOf(FileStorageInvalidPathError);
    }

    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'file-storage-outside-'));
    try {
      await fs.symlink(outside, path.join(root, 'photos', 'escape'));
      await expect(
        store.write({
          key: 'photos/escape/file.jpg',
          data: Buffer.from('x'),
          mode: 'create',
          integrity: true,
        })
      ).rejects.toBeInstanceOf(FileStorageInvalidPathError);
      await expect(fs.readdir(outside)).resolves.toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('preserves an existing file and removes run-owned temporary files when catalog commit fails', async () => {
    await store.write({
      key: 'photos/existing.jpg',
      data: Buffer.from('old'),
      mode: 'create',
      integrity: true,
    });
    const recordBefore = await catalog.get('photos/existing.jpg');
    vi.spyOn(catalog, 'put').mockRejectedValueOnce(new Error('catalog unavailable'));

    await expect(
      store.write({
        key: 'photos/existing.jpg',
        data: Buffer.from('new'),
        mode: 'replace',
        integrity: true,
      })
    ).rejects.toMatchObject({ code: 'FILE_STORAGE_UNAVAILABLE' });

    await expect(fs.readFile(path.join(root, 'photos', 'existing.jpg'), 'utf8')).resolves.toBe(
      'old'
    );
    await expect(catalog.get('photos/existing.jpg')).resolves.toEqual(recordBefore);
    expect(
      (await fs.readdir(path.join(root, 'photos'))).filter((name) => name.endsWith('.tmp'))
    ).toEqual([]);
  });

  it('rolls back earlier batch creates without deleting a pre-existing collision', async () => {
    await fs.writeFile(path.join(root, 'photos', 'collision.jpg'), 'keep');

    await expect(
      store.writeBatch([
        {
          key: 'photos/first.jpg',
          data: Buffer.from('first'),
          mode: 'create',
          integrity: true,
        },
        {
          key: 'photos/collision.jpg',
          data: Buffer.from('replace'),
          mode: 'create',
          integrity: true,
        },
      ])
    ).rejects.toMatchObject({ code: 'FILE_STORAGE_ALREADY_EXISTS' });

    await expect(fs.readFile(path.join(root, 'photos', 'collision.jpg'), 'utf8')).resolves.toBe(
      'keep'
    );
    await expect(fs.stat(path.join(root, 'photos', 'first.jpg'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('returns 507 before a write that would consume the reserved free space', async () => {
    const constrained = new LocalDurableFileStore(root, catalog, {
      minimumFreeBytes: 100,
      capacityReader: async () => ({ availableBytes: 105, totalBytes: 1_000 }),
    });
    await expect(
      constrained.write({
        key: 'photos/no-space.jpg',
        data: Buffer.alloc(10),
        mode: 'create',
        integrity: true,
      })
    ).rejects.toBeInstanceOf(FileStorageCapacityExhaustedError);
  });

  it('detects corruption without repairing either the file or catalog', async () => {
    await store.write({
      key: 'photos/corrupt.jpg',
      data: Buffer.from('known-good'),
      mode: 'create',
      integrity: true,
    });
    const recordBefore = await catalog.get('photos/corrupt.jpg');
    await fs.writeFile(path.join(root, 'photos', 'corrupt.jpg'), 'corrupted');

    await expect(
      store.read('photos/corrupt.jpg', { verifyIntegrity: true })
    ).rejects.toBeInstanceOf(FileStorageIntegrityMismatchError);
    await expect(fs.readFile(path.join(root, 'photos', 'corrupt.jpg'), 'utf8')).resolves.toBe(
      'corrupted'
    );
    await expect(catalog.get('photos/corrupt.jpg')).resolves.toEqual(recordBefore);
  });

  it('requires a catalog after backfill completes and never rewrites an uncataloged file', async () => {
    const legacyPath = path.join(root, 'photos', 'legacy.jpg');
    await fs.writeFile(legacyPath, 'legacy');
    await catalog.writeState({
      version: 1,
      status: 'complete',
      cursor: null,
      scannedCount: 1,
      registeredCount: 1,
      processedBytes: 6,
      mismatchCount: 0,
      lastErrorCode: null,
      updatedAt: new Date().toISOString(),
    });

    await expect(
      store.read('photos/legacy.jpg', { verifyIntegrity: true })
    ).rejects.toBeInstanceOf(FileStorageIntegrityMismatchError);
    await expect(fs.readFile(legacyPath, 'utf8')).resolves.toBe('legacy');
  });
});
