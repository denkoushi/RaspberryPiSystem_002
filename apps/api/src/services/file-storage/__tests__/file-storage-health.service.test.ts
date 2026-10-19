import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileStorageHealthService } from '../file-storage-health.service.js';
import { FileStorageIntegrityCatalog } from '../file-storage-integrity-catalog.js';
import { LocalDurableFileStore } from '../local-durable-file-store.js';

describe('FileStorageHealthService', () => {
  let root: string;
  let availableBytes: number;
  let totalBytes: number;
  let catalog: FileStorageIntegrityCatalog;
  let store: LocalDurableFileStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'file-storage-health-'));
    availableBytes = 1_000;
    totalBytes = 1_000;
    catalog = new FileStorageIntegrityCatalog(root);
    store = new LocalDurableFileStore(root, catalog, {
      minimumFreeBytes: 1,
      capacityReader: async () => ({ availableBytes, totalBytes }),
    });
    await store.initialize(['photos', 'pdfs', '.integrity']);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('probes every durable mount, removes probes, and reports pending backfill without leaking paths', async () => {
    const health = new FileStorageHealthService(root, store, catalog, ['photos', 'pdfs']);
    await expect(health.startupProbe()).resolves.toMatchObject({
      status: 'warning',
      reason: 'integrity-backfill',
    });
    for (const namespace of ['photos', 'pdfs', '.integrity/v1']) {
      expect(
        (await fs.readdir(path.join(root, namespace))).filter((name) =>
          name.includes('.health-')
        )
      ).toEqual([]);
    }
  });

  it('applies 70, 80 and 90 percent capacity levels', async () => {
    const health = new FileStorageHealthService(root, store, catalog, []);
    availableBytes = 300;
    await expect(health.check()).resolves.toMatchObject({
      status: 'warning',
      reason: 'capacity-warning',
    });
    availableBytes = 200;
    await expect(health.check()).resolves.toMatchObject({
      status: 'warning',
      reason: 'capacity-high',
    });
    availableBytes = 100;
    await expect(health.check()).resolves.toMatchObject({
      status: 'error',
      reason: 'capacity-critical',
    });
  });

  it('reports a failed integrity backfill as an error', async () => {
    await catalog.writeState({
      version: 1,
      status: 'failed',
      cursor: 'photos/a.jpg',
      scannedCount: 1,
      registeredCount: 0,
      processedBytes: 1,
      mismatchCount: 1,
      lastErrorCode: 'FILE_STORAGE_INTEGRITY_MISMATCH',
      updatedAt: new Date().toISOString(),
    });
    const health = new FileStorageHealthService(root, store, catalog, []);
    await expect(health.check()).resolves.toMatchObject({
      status: 'error',
      reason: 'integrity-failed',
    });
  });
});
