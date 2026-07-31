import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FileStorageIntegrityBackfillScheduler,
  FileStorageIntegrityBackfillService,
} from '../file-storage-integrity-backfill.service.js';
import { FileStorageIntegrityCatalog } from '../file-storage-integrity-catalog.js';
import { LocalDurableFileStore } from '../local-durable-file-store.js';

describe('FileStorageIntegrityBackfillService', () => {
  let root: string;
  let catalog: FileStorageIntegrityCatalog;
  let store: LocalDurableFileStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-storage-backfill-'));
    catalog = new FileStorageIntegrityCatalog(root);
    store = new LocalDurableFileStore(root, catalog, {
      minimumFreeBytes: 1,
      capacityReader: async () => ({
        availableBytes: 10_000_000,
        totalBytes: 10_000_000,
      }),
    });
    await store.initialize(['photos', 'thumbnails', 'pdfs']);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('registers legacy files incrementally, resumes, is idempotent, and preserves bytes and mtime', async () => {
    const firstPath = path.join(root, 'photos', 'a.jpg');
    const secondPath = path.join(root, 'photos', 'b.jpg');
    await fs.writeFile(firstPath, 'first');
    await fs.writeFile(secondPath, 'second');
    const before = await Promise.all([fs.stat(firstPath), fs.stat(secondPath)]);

    const backfill = new FileStorageIntegrityBackfillService(root, store, catalog, 6);
    const [sameRunA, sameRunB] = await Promise.all([backfill.runOnce(), backfill.runOnce()]);
    expect(sameRunA).toEqual(sameRunB);
    expect(sameRunA.status).toBe('pending');
    expect(sameRunA.registeredCount).toBe(1);

    const completed = await backfill.runOnce();
    expect(completed.status).toBe('complete');
    expect(completed.registeredCount).toBe(2);
    await expect(backfill.runOnce()).resolves.toEqual(completed);

    await expect(catalog.get('photos/a.jpg')).resolves.toBeTruthy();
    await expect(catalog.get('photos/b.jpg')).resolves.toBeTruthy();
    await expect(fs.readFile(firstPath, 'utf8')).resolves.toBe('first');
    await expect(fs.readFile(secondPath, 'utf8')).resolves.toBe('second');
    const after = await Promise.all([fs.stat(firstPath), fs.stat(secondPath)]);
    expect(after.map((stat) => stat.mtimeMs)).toEqual(before.map((stat) => stat.mtimeMs));
  });

  it('does not skip locale-sorted storage keys that are lower in code-point order', async () => {
    await fs.writeFile(path.join(root, 'pdfs', 'ä.pdf'), 'first');
    await fs.writeFile(path.join(root, 'pdfs', 'Z.pdf'), 'second');
    const backfill = new FileStorageIntegrityBackfillService(root, store, catalog);

    await expect(backfill.runOnce()).resolves.toMatchObject({
      status: 'complete',
      scannedCount: 2,
      registeredCount: 2,
    });
    await expect(catalog.get('pdfs/ä.pdf')).resolves.toBeTruthy();
    await expect(catalog.get('pdfs/Z.pdf')).resolves.toBeTruthy();
  });

  it('stops on a known mismatch and does not rewrite the source', async () => {
    await store.write({
      key: 'photos/corrupt.jpg',
      data: Buffer.from('good'),
      mode: 'create',
      integrity: true,
    });
    await fs.writeFile(path.join(root, 'photos', 'corrupt.jpg'), 'bad');
    const backfill = new FileStorageIntegrityBackfillService(root, store, catalog);

    await expect(backfill.runOnce()).rejects.toMatchObject({
      code: 'FILE_STORAGE_INTEGRITY_MISMATCH',
    });
    await expect(fs.readFile(path.join(root, 'photos', 'corrupt.jpg'), 'utf8')).resolves.toBe(
      'bad'
    );
    await expect(catalog.readState()).resolves.toMatchObject({
      status: 'failed',
      mismatchCount: 1,
    });
    await expect(backfill.runOnce()).resolves.toMatchObject({
      status: 'failed',
      mismatchCount: 1,
    });
  });

  it('waits for the active scan before scheduler leadership is released', async () => {
    let finish!: (value: Awaited<ReturnType<FileStorageIntegrityBackfillService['runOnce']>>) => void;
    const run = new Promise<Awaited<ReturnType<FileStorageIntegrityBackfillService['runOnce']>>>(
      (resolve) => {
        finish = resolve;
      }
    );
    const scheduler = new FileStorageIntegrityBackfillScheduler();
    scheduler.start({ runOnce: () => run });

    let stopped = false;
    const stopping = scheduler.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    expect(stopped).toBe(false);
    finish(await catalog.readState());
    await stopping;
    expect(stopped).toBe(true);
  });
});
