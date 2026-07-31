import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../../lib/logger.js';
import { DURABLE_FILE_NAMESPACES } from './file-storage-config.js';
import { FileStorageIntegrityMismatchError } from './file-storage-errors.js';
import type {
  FileStorageBackfillState,
  FileStorageIntegrityCatalog,
} from './file-storage-integrity-catalog.js';
import type { LocalDurableFileStore } from './local-durable-file-store.js';

const DEFAULT_BYTE_BUDGET = 2 * 1024 * 1024 * 1024;

async function listFiles(root: string, namespace: string): Promise<string[]> {
  const namespaceRoot = path.join(root, namespace);
  const results: string[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('FILE_STORAGE_INVALID_PATH');
      }
      if (entry.name.startsWith('.') && entry.name.endsWith('.tmp')) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        results.push(path.relative(root, absolute).split(path.sep).join('/'));
      }
    }
  };
  await walk(namespaceRoot).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  return results;
}

export class FileStorageIntegrityBackfillService {
  private inFlight: Promise<FileStorageBackfillState> | null = null;

  constructor(
    private readonly root: string,
    private readonly store: LocalDurableFileStore,
    private readonly catalog: FileStorageIntegrityCatalog,
    private readonly byteBudget = DEFAULT_BYTE_BUDGET
  ) {}

  runOnce(): Promise<FileStorageBackfillState> {
    this.inFlight ??= this.execute().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async execute(): Promise<FileStorageBackfillState> {
    let state = await this.catalog.readState();
    if (state.status === 'complete' && state.mismatchCount === 0) return state;
    if (state.status === 'failed') return state;
    state = {
      ...state,
      status: 'running',
      lastErrorCode: null,
      updatedAt: new Date().toISOString(),
    };
    await this.catalog.writeState(state);

    try {
      const allKeys = (
        await Promise.all(
          DURABLE_FILE_NAMESPACES.map((namespace) => listFiles(this.root, namespace))
        )
      )
        .flat()
        .sort((left, right) => left.localeCompare(right));
      let bytesThisRun = 0;
      for (const key of allKeys) {
        if (state.cursor && key <= state.cursor) continue;
        const stat = await this.store.stat(key);
        if (stat.size > this.byteBudget) {
          throw Object.assign(
            new Error('A legacy file exceeds the integrity backfill byte budget'),
            { code: 'FILE_STORAGE_BACKFILL_FILE_TOO_LARGE' }
          );
        }
        if (bytesThisRun + stat.size > this.byteBudget) break;
        const hashed = await this.store.hash(key);
        const verification = await this.catalog.verifyMetadata(
          key,
          hashed.sha256,
          hashed.size
        );
        if (verification === 'missing') {
          await this.catalog.put({
            storageKey: key,
            sha256: hashed.sha256,
            size: hashed.size,
          });
          state.registeredCount += 1;
        }
        bytesThisRun += hashed.size;
        state = {
          ...state,
          cursor: key,
          scannedCount: state.scannedCount + 1,
          processedBytes: state.processedBytes + hashed.size,
          updatedAt: new Date().toISOString(),
        };
        await this.catalog.writeState(state);
      }
      const remaining = allKeys.some((key) => !state.cursor || key > state.cursor);
      state = {
        ...state,
        status: remaining ? 'pending' : 'complete',
        cursor: remaining ? state.cursor : null,
        updatedAt: new Date().toISOString(),
      };
      await this.catalog.writeState(state);
      logger.info(
        {
          status: state.status,
          scannedCount: state.scannedCount,
          registeredCount: state.registeredCount,
          processedBytes: state.processedBytes,
        },
        'File storage integrity backfill run completed'
      );
      return state;
    } catch (error) {
      state = {
        ...state,
        status: 'failed',
        mismatchCount:
          error instanceof FileStorageIntegrityMismatchError
            ? state.mismatchCount + 1
            : state.mismatchCount,
        lastErrorCode:
          error instanceof Error && 'code' in error
            ? String((error as Error & { code?: string }).code)
            : 'FILE_STORAGE_BACKFILL_FAILED',
        updatedAt: new Date().toISOString(),
      };
      await this.catalog.writeState(state);
      logger.error(
        { code: state.lastErrorCode },
        'File storage integrity backfill stopped without modifying source files'
      );
      throw error;
    }
  }
}

export class FileStorageIntegrityBackfillScheduler {
  private timer: NodeJS.Timeout | null = null;
  private service: Pick<FileStorageIntegrityBackfillService, 'runOnce'> | null = null;
  private currentRun: Promise<void> | null = null;

  start(service: Pick<FileStorageIntegrityBackfillService, 'runOnce'>): void {
    if (this.timer) return;
    this.service = service;
    this.run();
    this.timer = setInterval(() => {
      this.run();
    }, 60 * 60 * 1000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.currentRun;
    this.service = null;
  }

  private run(): void {
    if (!this.service || this.currentRun) return;
    this.currentRun = this.service
      .runOnce()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        this.currentRun = null;
      });
  }
}

const scheduler = new FileStorageIntegrityBackfillScheduler();

export function getFileStorageIntegrityBackfillScheduler(): FileStorageIntegrityBackfillScheduler {
  return scheduler;
}
