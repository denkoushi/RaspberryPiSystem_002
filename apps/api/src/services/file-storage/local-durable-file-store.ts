import { createHash } from 'node:crypto';
import { createReadStream, promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import { logger } from '../../lib/logger.js';
import type {
  DurableFileStorePort,
  FileWriteRequest,
  StoredFileResult,
} from './durable-file-store.port.js';
import { FileStorageIntegrityCatalog } from './file-storage-integrity-catalog.js';
import {
  FileStorageCapacityExhaustedError,
  FileStorageIntegrityMismatchError,
  FileStorageUnavailableError,
} from './file-storage-errors.js';
import {
  ensureSecureRoot,
  normalizeStorageKey,
  prepareAtomicWrite,
  resolveSecureFile,
  syncDirectory,
} from './secure-atomic-file.js';

export type FileSystemCapacity = {
  availableBytes: number;
  totalBytes: number;
};

export type LocalDurableFileStoreOptions = {
  minimumFreeBytes: number;
  capacityReader?: (root: string) => Promise<FileSystemCapacity>;
};

async function defaultCapacityReader(root: string): Promise<FileSystemCapacity> {
  // Production Compose bind-mounts durable namespaces separately. The
  // integrity directory is always on the same host SSD and therefore provides
  // the durable filesystem's capacity rather than the container overlay's.
  // Isolated callers may save before the catalog directory has been created,
  // so use the configured root only for that initial ENOENT case.
  const stats = await fs
    .statfs(path.join(root, '.integrity'))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return fs.statfs(root);
      throw error;
    });
  return {
    availableBytes: Number(stats.bavail) * Number(stats.bsize),
    totalBytes: Number(stats.blocks) * Number(stats.bsize),
  };
}

export class LocalDurableFileStore implements DurableFileStorePort {
  private readonly capacityReader: (root: string) => Promise<FileSystemCapacity>;

  constructor(
    private readonly root: string,
    private readonly catalog: FileStorageIntegrityCatalog,
    private readonly options: LocalDurableFileStoreOptions
  ) {
    this.capacityReader = options.capacityReader ?? defaultCapacityReader;
  }

  async initialize(namespaces: readonly string[]): Promise<void> {
    await ensureSecureRoot(this.root);
    for (const namespace of namespaces) {
      const key = `${normalizeStorageKey(namespace)}/.storage-init`;
      const marker = await resolveSecureFile(this.root, key, { allowMissing: true });
      await fs.mkdir(path.dirname(marker), { recursive: true });
    }
  }

  absolutePath(key: string): string {
    const normalized = normalizeStorageKey(key);
    return path.join(this.root, ...normalized.split('/'));
  }

  async capacity(): Promise<FileSystemCapacity & { reserveBytes: number }> {
    const capacity = await this.capacityReader(this.root);
    const reserveBytes = Math.max(
      this.options.minimumFreeBytes,
      Math.ceil(capacity.totalBytes * 0.05)
    );
    return { ...capacity, reserveBytes };
  }

  private async assertCapacity(bytesToWrite: number): Promise<void> {
    // Storage helpers are also used directly by isolated jobs and tests, where
    // the API startup hook has not initialized the configured root yet.
    await ensureSecureRoot(this.root);
    const capacity = await this.capacity();
    if (capacity.availableBytes - bytesToWrite < capacity.reserveBytes) {
      throw new FileStorageCapacityExhaustedError();
    }
  }

  async write(request: FileWriteRequest): Promise<StoredFileResult> {
    const [result] = await this.writeBatch([request]);
    return result!;
  }

  async writeBatch(requests: readonly FileWriteRequest[]): Promise<StoredFileResult[]> {
    if (requests.length === 0) return [];
    const normalized = requests.map((request) => ({
      ...request,
      key: normalizeStorageKey(request.key),
    }));
    if (new Set(normalized.map((request) => request.key)).size !== normalized.length) {
      throw new Error('Duplicate storage keys in one batch');
    }
    await this.assertCapacity(normalized.reduce((sum, request) => sum + request.data.length, 0));

    const previous = new Map<string, Buffer | null>();
    const previousRecords = new Map<
      string,
      Awaited<ReturnType<FileStorageIntegrityCatalog['get']>>
    >();
    const prepared = [];
    try {
      for (const request of normalized) {
        if (request.integrity) {
          previousRecords.set(request.key, await this.catalog.get(request.key));
        }
        if (request.mode === 'replace') {
          const existingPath = await resolveSecureFile(this.root, request.key, {
            allowMissing: true,
          });
          previous.set(
            request.key,
            await fs.readFile(existingPath).catch((error: NodeJS.ErrnoException) => {
              if (error.code === 'ENOENT') return null;
              throw error;
            })
          );
        } else {
          previous.set(request.key, null);
        }
        prepared.push(
          await prepareAtomicWrite(this.root, request.key, request.data, request.mode)
        );
      }

      for (const item of prepared) {
        await item.commit();
      }
      for (let index = 0; index < normalized.length; index += 1) {
        const request = normalized[index]!;
        const item = prepared[index]!;
        if (request.integrity) {
          await this.catalog.put({
            storageKey: request.key,
            sha256: item.sha256,
            size: item.size,
          });
        }
      }
      return prepared.map((item) => ({
        key: item.key,
        sha256: item.sha256,
        size: item.size,
      }));
    } catch (error) {
      for (const item of [...prepared].reverse()) {
        if (!item.isCommitted()) continue;
        const oldData = previous.get(item.key);
        if (oldData !== null && oldData !== undefined) {
          const restore = await prepareAtomicWrite(this.root, item.key, oldData, 'replace');
          await restore.commit().catch(() => undefined);
          await restore.discard();
        } else {
          await fs.unlink(item.destination).catch(() => undefined);
          await syncDirectory(path.dirname(item.destination)).catch(() => undefined);
        }
        const oldRecord = previousRecords.get(item.key);
        if (oldRecord) {
          await this.catalog
            .put({
              storageKey: item.key,
              sha256: oldRecord.sha256,
              size: oldRecord.size,
              createdAt: oldRecord.createdAt,
              updatedAt: oldRecord.updatedAt,
            })
            .catch(() => undefined);
        } else if (previousRecords.has(item.key)) {
          await this.catalog.delete(item.key).catch(() => undefined);
        }
      }
      if (
        error instanceof FileStorageCapacityExhaustedError ||
        error instanceof FileStorageIntegrityMismatchError ||
        (typeof error === 'object' && error !== null && 'statusCode' in error)
      ) {
        throw error;
      }
      throw new FileStorageUnavailableError(error);
    } finally {
      await Promise.all(prepared.map((item) => item.discard()));
    }
  }

  async read(key: string, options: { verifyIntegrity: boolean }): Promise<Buffer> {
    const normalized = normalizeStorageKey(key);
    const file = await resolveSecureFile(this.root, normalized, { allowMissing: false });
    const data = await fs.readFile(file);
    if (options.verifyIntegrity) {
      const result = await this.catalog.verify(normalized, data);
      if (result === 'missing') {
        if (await this.catalog.requiresCatalog()) {
          throw new FileStorageIntegrityMismatchError();
        }
        logger.warn(
          { storageKeyHash: await this.storageKeyHash(normalized) },
          'Durable file has no integrity catalog record yet'
        );
      }
    }
    return data;
  }

  async stat(key: string): Promise<Stats> {
    const file = await resolveSecureFile(this.root, key, { allowMissing: false });
    return fs.stat(file);
  }

  async hash(key: string): Promise<StoredFileResult> {
    const normalized = normalizeStorageKey(key);
    const file = await resolveSecureFile(this.root, normalized, { allowMissing: false });
    const digest = createHash('sha256');
    let size = 0;
    for await (const chunk of createReadStream(file)) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      digest.update(bytes);
      size += bytes.length;
    }
    return {
      key: normalized,
      sha256: digest.digest('hex'),
      size,
    };
  }

  async delete(key: string, options: { integrity: boolean }): Promise<void> {
    const normalized = normalizeStorageKey(key);
    const file = await resolveSecureFile(this.root, normalized, { allowMissing: true });
    await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    await syncDirectory(path.dirname(file));
    if (options.integrity) {
      await this.catalog.delete(normalized);
    }
  }

  private async storageKeyHash(key: string): Promise<string> {
    return createHash('sha256').update(key).digest('hex');
  }
}
