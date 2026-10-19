import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import {
  FileStorageAlreadyExistsError,
  FileStorageInvalidPathError,
} from './file-storage-errors.js';
import type { FileWriteMode } from './durable-file-store.port.js';

export type PreparedAtomicWrite = {
  destination: string;
  key: string;
  sha256: string;
  size: number;
  isCommitted: () => boolean;
  commit: () => Promise<void>;
  discard: () => Promise<void>;
};

export function normalizeStorageKey(rawKey: string): string {
  if (
    rawKey.length === 0 ||
    rawKey.includes('\0') ||
    rawKey.includes('\\') ||
    path.isAbsolute(rawKey)
  ) {
    throw new FileStorageInvalidPathError();
  }
  const segments = rawKey.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new FileStorageInvalidPathError();
  }
  return segments.join('/');
}

async function assertDirectoryNotSymlink(directory: string): Promise<void> {
  const stat = await fs.lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new FileStorageInvalidPathError();
  }
}

export async function ensureSecureRoot(root: string): Promise<void> {
  if (!path.isAbsolute(root)) {
    throw new FileStorageInvalidPathError();
  }
  await fs.mkdir(root, { recursive: true });
  await assertDirectoryNotSymlink(root);
}

async function ensureSecureParent(root: string, key: string): Promise<string> {
  await ensureSecureRoot(root);
  const segments = normalizeStorageKey(key).split('/');
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      await assertDirectoryNotSymlink(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      try {
        await fs.mkdir(current);
      } catch (mkdirError) {
        if ((mkdirError as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw mkdirError;
        }
      }
      await assertDirectoryNotSymlink(current);
    }
  }
  return path.dirname(path.join(root, ...segments));
}

export async function resolveSecureFile(
  root: string,
  rawKey: string,
  options: { allowMissing: boolean }
): Promise<string> {
  const key = normalizeStorageKey(rawKey);
  await ensureSecureParent(root, key);
  const destination = path.join(root, ...key.split('/'));
  try {
    const stat = await fs.lstat(destination);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new FileStorageInvalidPathError();
    }
  } catch (error) {
    if (options.allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return destination;
    }
    throw error;
  }
  return destination;
}

export async function syncDirectory(directory: string): Promise<void> {
  const handle = await fs.open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function prepareAtomicWrite(
  root: string,
  rawKey: string,
  data: Buffer,
  mode: FileWriteMode
): Promise<PreparedAtomicWrite> {
  const key = normalizeStorageKey(rawKey);
  const parent = await ensureSecureParent(root, key);
  const destination = await resolveSecureFile(root, key, { allowMissing: true });
  const temporary = path.join(parent, `.${path.basename(destination)}.${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close().catch(() => undefined);
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
  await handle.close();

  const expectedHash = createHash('sha256').update(data).digest('hex');
  const persisted = await fs.readFile(temporary);
  const actualHash = createHash('sha256').update(persisted).digest('hex');
  if (actualHash !== expectedHash) {
    await fs.unlink(temporary).catch(() => undefined);
    throw new Error('Atomic file staging verification failed');
  }

  let destinationCommitted = false;
  return {
    destination,
    key,
    sha256: expectedHash,
    size: data.length,
    isCommitted: () => destinationCommitted,
    commit: async () => {
      if (destinationCommitted) return;
      if (mode === 'create') {
        try {
          await fs.link(temporary, destination);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new FileStorageAlreadyExistsError();
          }
          throw error;
        }
        destinationCommitted = true;
        await fs.unlink(temporary);
      } else {
        const existing = await fs.lstat(destination).catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (existing?.isSymbolicLink()) {
          throw new FileStorageInvalidPathError();
        }
        await fs.rename(temporary, destination);
        destinationCommitted = true;
      }
      await syncDirectory(parent);
    },
    discard: async () => {
      await fs.unlink(temporary).catch(() => undefined);
    },
  };
}

export async function writeAtomicFileAtRoot(
  root: string,
  key: string,
  data: Buffer,
  mode: FileWriteMode
): Promise<void> {
  const prepared = await prepareAtomicWrite(root, key, data, mode);
  try {
    await prepared.commit();
  } finally {
    await prepared.discard();
  }
}
