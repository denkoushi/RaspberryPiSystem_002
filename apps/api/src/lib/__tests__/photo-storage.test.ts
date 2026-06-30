import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { PhotoStorage } from '../photo-storage.js';

const tmpDir = () => path.join(os.tmpdir(), `photo-storage-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);

describe('PhotoStorage path safety', () => {
  let storageDir: string;

  beforeEach(async () => {
    storageDir = tmpDir();
    process.env.PHOTO_STORAGE_DIR = storageDir;
    await fs.mkdir(path.join(storageDir, 'photos', '2026', '06'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(storageDir, { recursive: true, force: true }).catch(() => {});
    delete process.env.PHOTO_STORAGE_DIR;
  });

  it('reads photos inside the storage directory', async () => {
    const filePath = path.join(storageDir, 'photos', '2026', '06', 'inside.jpg');
    await fs.writeFile(filePath, Buffer.from('inside'));

    const buffer = await PhotoStorage.readPhoto('/api/storage/photos/2026/06/inside.jpg');

    expect(buffer.toString()).toBe('inside');
  });

  it('rejects traversal outside the storage directory', async () => {
    await expect(PhotoStorage.readPhoto('/api/storage/photos/2026/06/../../../secret.jpg')).rejects.toThrow(
      'Invalid photo path',
    );
  });

  it('rejects malformed encoded photo paths', async () => {
    await expect(PhotoStorage.readPhoto('/api/storage/photos/2026/06/%E0%A4%A.jpg')).rejects.toThrow(
      'Invalid photo path',
    );
  });
});
