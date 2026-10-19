import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileStorageIntegrityCatalog } from '../file-storage-integrity-catalog.js';
import {
  FileStorageAlreadyExistsError,
  FileStorageCapacityExhaustedError,
  FileStorageIntegrityMismatchError,
  FileStorageInvalidPathError,
} from '../file-storage-errors.js';
import { LocalDurableFileStore } from '../local-durable-file-store.js';
import { logger } from '../../../lib/logger.js';

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

  it('streams a new object with its hash, size and catalog record, leaving no temporary files', async () => {
    const data = Buffer.from('streamed-data');
    const key = 'photos/nested/stream.jpg';
    const result = await store.writeStream({ key, source: Readable.from([data.subarray(0, 4), data.subarray(4)]), integrity: true, sizeHint: data.length });
    expect(result).toEqual({ key, sha256: createHash('sha256').update(data).digest('hex'), size: data.length });
    await expect(catalog.get(key)).resolves.toMatchObject({ storageKey: key, sha256: result.sha256, size: result.size });
    await expect(store.read(key, { verifyIntegrity: true })).resolves.toEqual(data);
    await expect(store.list('photos/nested')).resolves.toEqual(['stream.jpg']);
  });

  it('preserves the existing object and catalog on a streamed create conflict', async () => {
    const key = 'photos/stream.jpg';
    await store.writeStream({ key, source: Readable.from(['original']), integrity: true });
    const record = await catalog.get(key);
    await expect(store.writeStream({ key, source: Readable.from(['different']), integrity: true })).rejects.toBeInstanceOf(FileStorageAlreadyExistsError);
    await expect(store.read(key, { verifyIntegrity: true })).resolves.toEqual(Buffer.from('original'));
    await expect(catalog.get(key)).resolves.toEqual(record);
    await expect(store.list('photos')).resolves.toEqual(['stream.jpg']);
  });

  it('removes staged bytes after a source stream error without publishing a file or catalog record', async () => {
    const source = Readable.from((async function* () {
      yield Buffer.from('partial');
      throw new Error('source failed');
    })());
    await expect(store.writeStream({ key: 'photos/stream.jpg', source, integrity: true })).rejects.toMatchObject({ code: 'FILE_STORAGE_UNAVAILABLE', cause: { message: 'source failed' } });
    await expect(store.list('photos')).resolves.toEqual([]);
    await expect(catalog.get('photos/stream.jpg')).resolves.toBeNull();
  });

  it('removes the linked object when its catalog write fails', async () => {
    vi.spyOn(catalog, 'put').mockRejectedValueOnce(new Error('catalog failed'));
    await expect(store.writeStream({ key: 'photos/stream.jpg', source: Readable.from(['data']), integrity: true })).rejects.toMatchObject({ code: 'FILE_STORAGE_UNAVAILABLE' });
    await expect(store.list('photos')).resolves.toEqual([]);
    await expect(catalog.get('photos/stream.jpg')).resolves.toBeNull();
  });

  it('maps ENOSPC while streaming and removes the temporary file', async () => {
    const open = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await open(...args);
      vi.spyOn(handle, 'createWriteStream').mockReturnValueOnce(new Writable({
        write(_chunk, _encoding, callback) {
          callback(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
        },
      }) as ReturnType<typeof handle.createWriteStream>);
      return handle;
    });
    await expect(store.writeStream({ key: 'photos/stream.jpg', source: Readable.from(['data']), integrity: true })).rejects.toBeInstanceOf(FileStorageCapacityExhaustedError);
    await expect(store.list('photos')).resolves.toEqual([]);
    await expect(catalog.get('photos/stream.jpg')).resolves.toBeNull();
  });

  it('checks the stream size hint against the reserve before staging', async () => {
    const constrained = new LocalDurableFileStore(root, catalog, {
      minimumFreeBytes: 100,
      capacityReader: async () => ({ availableBytes: 105, totalBytes: 1_000 }),
    });
    await expect(constrained.writeStream({ key: 'photos/stream.jpg', source: Readable.from(['data']), sizeHint: 10, integrity: true })).rejects.toBeInstanceOf(FileStorageCapacityExhaustedError);
    await expect(store.list('photos')).resolves.toEqual([]);
  });

  it('can stream without creating an integrity record', async () => {
    await store.writeStream({ key: 'photos/stream.jpg', source: Readable.from(['data']), integrity: false });
    await expect(store.read('photos/stream.jpg', { verifyIntegrity: false })).resolves.toEqual(Buffer.from('data'));
    await expect(catalog.get('photos/stream.jpg')).resolves.toBeNull();
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

  it.each([
    [undefined, '0123456789'],
    [{ start: 2, end: 5 }, '2345'],
    [{ start: 3 }, '3456789'],
    [{ end: 3 }, '0123'],
    [{ start: 0, end: 0 }, '0'],
  ])('streams full or inclusive ranged content with full size: %j', async (options, expected) => {
    await store.write({ key: 'photos/video', data: Buffer.from('0123456789'), mode: 'create', integrity: true });
    const read = vi.spyOn(store, 'read');
    const { stream, size } = await store.openReadStream('photos/video', options);
    expect(size).toBe(10);
    expect(await buffer(stream)).toEqual(Buffer.from(expected));
    expect(read).not.toHaveBeenCalled();
  });

  it.each([
    { start: -1 }, { end: -1 }, { start: 1.5 }, { end: 1.5 },
    { start: NaN }, { end: Infinity }, { start: Number.MAX_SAFE_INTEGER + 1 },
    { end: Number.MAX_SAFE_INTEGER + 1 }, { start: 5, end: 2 },
  ])('rejects invalid stream offsets %j', async (options) => {
    await expect(store.openReadStream('photos/video', options)).rejects.toBeInstanceOf(RangeError);
  });

  it('rejects traversal and symlink escapes for streaming, copying and listing', async () => {
    await fs.symlink(os.tmpdir(), path.join(root, 'photos', 'escape'));
    await fs.writeFile(path.join(root, 'photos', 'original'), 'original');
    await fs.symlink(path.join(root, 'photos', 'original'), path.join(root, 'photos', 'link'));
    for (const key of ['../escape', '/tmp/escape', 'photos/../escape', 'photos/a\0b', 'photos/escape/file', 'photos/link']) {
      await expect(store.writeStream({ key, source: Readable.from(['data']), integrity: true })).rejects.toBeInstanceOf(FileStorageInvalidPathError);
      await expect(store.openReadStream(key)).rejects.toBeInstanceOf(FileStorageInvalidPathError);
      await expect(store.copyToFile(key, path.join(root, 'copy'), { verifyIntegrity: true })).rejects.toBeInstanceOf(FileStorageInvalidPathError);
    }
    for (const namespace of ['../escape', '/tmp', 'photos/escape', 'photos/escape/nested', 'photos/link']) {
      await expect(store.list(namespace)).rejects.toBeInstanceOf(FileStorageInvalidPathError);
    }
  });

  it('rejects stream size mismatches but does not hash streamed contents', async () => {
    await store.write({ key: 'photos/video', data: Buffer.from('good'), mode: 'create', integrity: true });
    await fs.writeFile(path.join(root, 'photos', 'video'), 'evil');
    const { stream } = await store.openReadStream('photos/video');
    expect(await buffer(stream)).toEqual(Buffer.from('evil'));
    await fs.writeFile(path.join(root, 'photos', 'video'), 'short');
    await expect(store.openReadStream('photos/video', { start: 0, end: 0 })).rejects.toBeInstanceOf(FileStorageIntegrityMismatchError);
  });

  it('lists only direct child names including files and directories, and handles missing namespaces', async () => {
    await fs.mkdir(path.join(root, 'photos', 'nested'));
    await fs.writeFile(path.join(root, 'photos', 'nested', 'child'), 'child');
    await fs.writeFile(path.join(root, 'photos', 'file'), 'file');
    expect((await store.list('photos')).sort()).toEqual(['file', 'nested']);
    expect(await store.list('missing')).toEqual([]);
    expect(await store.list('missing/nested')).toEqual([]);
  });

  it('copies full contents without buffer reads and verifies SHA-256 and size', async () => {
    const key = 'photos/video';
    const destination = path.join(root, 'copy');
    await store.write({ key, data: Buffer.from('original'), mode: 'create', integrity: true });
    const read = vi.spyOn(store, 'read');
    await store.copyToFile(key, destination, { verifyIntegrity: true });
    expect(await fs.readFile(destination, 'utf8')).toBe('original');
    expect(read).not.toHaveBeenCalled();
    for (const corrupted of ['tampered', 'short']) {
      await fs.writeFile(path.join(root, key), corrupted);
      await expect(store.copyToFile(key, destination, { verifyIntegrity: true })).rejects.toBeInstanceOf(FileStorageIntegrityMismatchError);
    }
    await store.copyToFile(key, destination, { verifyIntegrity: false });
    expect(await fs.readFile(destination, 'utf8')).toBe('short');
  });

  it('uses the read missing-record policy for streams and verified copies', async () => {
    const key = 'photos/legacy';
    await fs.writeFile(path.join(root, key), 'legacy');
    const warn = vi.spyOn(logger, 'warn');
    const { stream } = await store.openReadStream(key);
    expect(await buffer(stream)).toEqual(Buffer.from('legacy'));
    await store.copyToFile(key, path.join(root, 'copy'), { verifyIntegrity: true });
    expect(warn).toHaveBeenCalledTimes(2);
    await catalog.writeState({ ...await catalog.readState(), status: 'complete', mismatchCount: 0 });
    await expect(store.openReadStream(key)).rejects.toBeInstanceOf(FileStorageIntegrityMismatchError);
    await expect(store.copyToFile(key, path.join(root, 'copy'), { verifyIntegrity: true })).rejects.toBeInstanceOf(FileStorageIntegrityMismatchError);
  });
});
