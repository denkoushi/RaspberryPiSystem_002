import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger } from '../../lib/logger.js';
import { FileStorageIntegrityMismatchError } from './file-storage-errors.js';
import {
  normalizeStorageKey,
  prepareAtomicWrite,
  resolveSecureFile,
} from './secure-atomic-file.js';

export type FileStorageIntegrityRecord = {
  version: 1;
  storageKey: string;
  sha256: string;
  size: number;
  createdAt: string;
  updatedAt: string;
};

export type FileStorageBackfillState = {
  version: 1;
  status: 'pending' | 'running' | 'complete' | 'failed';
  cursor: string | null;
  scannedCount: number;
  registeredCount: number;
  processedBytes: number;
  mismatchCount: number;
  lastErrorCode: string | null;
  updatedAt: string;
};

const STATE_KEY = '.integrity/v1/state.json';

function recordKey(storageKey: string): string {
  const digest = createHash('sha256').update(storageKey, 'utf8').digest('hex');
  return `.integrity/v1/objects/${digest.slice(0, 2)}/${digest}.json`;
}

function parseRecord(raw: Buffer, expectedStorageKey: string): FileStorageIntegrityRecord {
  const parsed = JSON.parse(raw.toString('utf8')) as Partial<FileStorageIntegrityRecord>;
  if (
    parsed.version !== 1 ||
    parsed.storageKey !== expectedStorageKey ||
    typeof parsed.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(parsed.sha256) ||
    typeof parsed.size !== 'number' ||
    !Number.isSafeInteger(parsed.size) ||
    parsed.size < 0 ||
    typeof parsed.createdAt !== 'string' ||
    typeof parsed.updatedAt !== 'string'
  ) {
    throw new FileStorageIntegrityMismatchError();
  }
  return parsed as FileStorageIntegrityRecord;
}

export class FileStorageIntegrityCatalog {
  constructor(private readonly root: string) {}

  async get(storageKey: string): Promise<FileStorageIntegrityRecord | null> {
    const normalized = normalizeStorageKey(storageKey);
    try {
      const file = await resolveSecureFile(this.root, recordKey(normalized), {
        allowMissing: false,
      });
      return parseRecord(await fs.readFile(file), normalized);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      if (error instanceof FileStorageIntegrityMismatchError) {
        throw error;
      }
      logger.error(
        { code: 'FILE_STORAGE_INTEGRITY_MISMATCH' },
        'File storage integrity catalog record could not be read'
      );
      throw new FileStorageIntegrityMismatchError();
    }
  }

  async put(input: {
    storageKey: string;
    sha256: string;
    size: number;
    createdAt?: string;
    updatedAt?: string;
  }): Promise<FileStorageIntegrityRecord> {
    const storageKey = normalizeStorageKey(input.storageKey);
    const existing = await this.get(storageKey);
    const now = new Date().toISOString();
    const record: FileStorageIntegrityRecord = {
      version: 1,
      storageKey,
      sha256: input.sha256,
      size: input.size,
      createdAt: existing?.createdAt ?? input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const prepared = await prepareAtomicWrite(
      this.root,
      recordKey(storageKey),
      Buffer.from(`${JSON.stringify(record)}\n`, 'utf8'),
      'replace'
    );
    try {
      await prepared.commit();
    } finally {
      await prepared.discard();
    }
    return record;
  }

  async delete(storageKey: string): Promise<void> {
    const normalized = normalizeStorageKey(storageKey);
    const file = await resolveSecureFile(this.root, recordKey(normalized), {
      allowMissing: true,
    });
    await fs.unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
    const handle = await fs.open(path.dirname(file), 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async verify(storageKey: string, data: Buffer): Promise<'verified' | 'missing'> {
    return this.verifyMetadata(
      storageKey,
      createHash('sha256').update(data).digest('hex'),
      data.length
    );
  }

  async verifyMetadata(
    storageKey: string,
    sha256: string,
    size: number
  ): Promise<'verified' | 'missing'> {
    const record = await this.get(storageKey);
    if (!record) return 'missing';
    if (record.sha256 !== sha256 || record.size !== size) {
      logger.error(
        {
          code: 'FILE_STORAGE_INTEGRITY_MISMATCH',
          storageKeyHash: createHash('sha256').update(storageKey).digest('hex'),
        },
        'File storage integrity mismatch'
      );
      throw new FileStorageIntegrityMismatchError();
    }
    return 'verified';
  }

  async readState(): Promise<FileStorageBackfillState> {
    try {
      const file = await resolveSecureFile(this.root, STATE_KEY, { allowMissing: false });
      const parsed = JSON.parse((await fs.readFile(file)).toString('utf8')) as FileStorageBackfillState;
      if (
        parsed.version !== 1 ||
        !['pending', 'running', 'complete', 'failed'].includes(parsed.status) ||
        !(parsed.cursor === null || typeof parsed.cursor === 'string') ||
        !this.isCount(parsed.scannedCount) ||
        !this.isCount(parsed.registeredCount) ||
        !this.isCount(parsed.processedBytes) ||
        !this.isCount(parsed.mismatchCount) ||
        !(parsed.lastErrorCode === null || typeof parsed.lastErrorCode === 'string') ||
        typeof parsed.updatedAt !== 'string'
      ) {
        throw new Error('invalid state');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error(
          { code: 'FILE_STORAGE_INTEGRITY_MISMATCH' },
          'File storage backfill state could not be read'
        );
        throw new FileStorageIntegrityMismatchError();
      }
      return {
        version: 1,
        status: 'pending',
        cursor: null,
        scannedCount: 0,
        registeredCount: 0,
        processedBytes: 0,
        mismatchCount: 0,
        lastErrorCode: null,
        updatedAt: new Date(0).toISOString(),
      };
    }
  }

  async writeState(state: FileStorageBackfillState): Promise<void> {
    const prepared = await prepareAtomicWrite(
      this.root,
      STATE_KEY,
      Buffer.from(`${JSON.stringify(state)}\n`, 'utf8'),
      'replace'
    );
    try {
      await prepared.commit();
    } finally {
      await prepared.discard();
    }
  }

  async requiresCatalog(): Promise<boolean> {
    const state = await this.readState();
    return state.status === 'complete' && state.mismatchCount === 0;
  }

  integrityRoot(): string {
    return path.join(this.root, '.integrity', 'v1');
  }

  private isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  }
}
