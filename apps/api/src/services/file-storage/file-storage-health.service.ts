import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LocalDurableFileStore } from './local-durable-file-store.js';
import {
  FileStorageCapacityExhaustedError,
  FileStorageIntegrityMismatchError,
  FileStorageUnavailableError,
} from './file-storage-errors.js';
import { DURABLE_FILE_NAMESPACES } from './file-storage-config.js';
import type { FileStorageIntegrityCatalog } from './file-storage-integrity-catalog.js';
import { prepareAtomicWrite, syncDirectory } from './secure-atomic-file.js';

export type FileStorageHealthSnapshot = {
  status: 'ok' | 'warning' | 'error';
  reason?:
    | 'capacity-warning'
    | 'capacity-high'
    | 'capacity-critical'
    | 'capacity-exhausted'
    | 'integrity-backfill'
    | 'integrity-failed'
    | 'unavailable';
  usagePercent?: number;
  availableBytes?: number;
};

export class FileStorageHealthService {
  private lastSnapshot: FileStorageHealthSnapshot = {
    status: 'error',
    reason: 'unavailable',
  };

  constructor(
    private readonly root: string,
    private readonly store: LocalDurableFileStore,
    private readonly catalog: FileStorageIntegrityCatalog,
    private readonly probeNamespaces: readonly string[] = DURABLE_FILE_NAMESPACES
  ) {}

  async startupProbe(): Promise<FileStorageHealthSnapshot> {
    const payload = Buffer.from(randomUUID(), 'utf8');
    try {
      for (const namespace of [...this.probeNamespaces, '.integrity/v1']) {
        await this.probeNamespace(namespace, payload);
      }
      return await this.check();
    } catch (error) {
      this.lastSnapshot = { status: 'error', reason: 'unavailable' };
      if (error instanceof FileStorageCapacityExhaustedError) throw error;
      throw new FileStorageUnavailableError(error);
    }
  }

  async check(): Promise<FileStorageHealthSnapshot> {
    try {
      const [capacity, backfillState] = await Promise.all([
        this.store.capacity(),
        this.catalog.readState(),
      ]);
      const usagePercent =
        capacity.totalBytes > 0
          ? Math.round(((capacity.totalBytes - capacity.availableBytes) / capacity.totalBytes) * 1000) /
            10
          : 100;
      if (backfillState.status === 'failed') {
        this.lastSnapshot = {
          status: 'error',
          reason: 'integrity-failed',
          usagePercent,
          availableBytes: capacity.availableBytes,
        };
      } else if (capacity.availableBytes < capacity.reserveBytes) {
        this.lastSnapshot = {
          status: 'error',
          reason: 'capacity-exhausted',
          usagePercent,
          availableBytes: capacity.availableBytes,
        };
      } else if (usagePercent >= 90) {
        this.lastSnapshot = {
          status: 'error',
          reason: 'capacity-critical',
          usagePercent,
          availableBytes: capacity.availableBytes,
        };
      } else if (usagePercent >= 80) {
        this.lastSnapshot = {
          status: 'warning',
          reason: 'capacity-high',
          usagePercent,
          availableBytes: capacity.availableBytes,
        };
      } else if (usagePercent >= 70) {
        this.lastSnapshot = {
          status: 'warning',
          reason: 'capacity-warning',
          usagePercent,
          availableBytes: capacity.availableBytes,
        };
      } else if (backfillState.status !== 'complete') {
        this.lastSnapshot = {
          status: 'warning',
          reason: 'integrity-backfill',
          usagePercent,
          availableBytes: capacity.availableBytes,
        };
      } else {
        this.lastSnapshot = {
          status: 'ok',
          usagePercent,
          availableBytes: capacity.availableBytes,
        };
      }
      return this.lastSnapshot;
    } catch (error) {
      if (error instanceof FileStorageCapacityExhaustedError) throw error;
      this.lastSnapshot = {
        status: 'error',
        reason:
          error instanceof FileStorageIntegrityMismatchError
            ? 'integrity-failed'
            : 'unavailable',
      };
      return this.lastSnapshot;
    }
  }

  snapshot(): FileStorageHealthSnapshot {
    return this.lastSnapshot;
  }

  private async probeNamespace(namespace: string, payload: Buffer): Promise<void> {
    const key = `${namespace}/.health-${randomUUID()}.probe`;
    const file = path.join(this.root, ...key.split('/'));
    const prepared = await prepareAtomicWrite(this.root, key, payload, 'create');
    try {
      await prepared.commit();
      const persisted = await fs.readFile(file);
      if (
        createHash('sha256').update(payload).digest('hex') !==
        createHash('sha256').update(persisted).digest('hex')
      ) {
        throw new Error('storage probe checksum mismatch');
      }
    } finally {
      await prepared.discard();
      await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      await syncDirectory(path.dirname(file));
    }
  }
}
