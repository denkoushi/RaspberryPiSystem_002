import { promises as fs } from 'fs';
import path from 'path';

import { getFileStorageRoot } from '../../file-storage/file-storage-config.js';
import { writeAtomicFileAtRoot } from '../../file-storage/secure-atomic-file.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getWebCaptureDir(): string {
  const renderDir = process.env.SIGNAGE_RENDER_DIR || path.join(getFileStorageRoot(), 'signage-rendered');
  return path.join(renderDir, 'web-captures');
}

function fileNameFor(id: string): string {
  if (!UUID_PATTERN.test(id)) {
    throw new Error('Invalid web capture id');
  }
  return `${id}.jpg`;
}

/** ページ撮影コンテンツの最新画像（1 コンテンツ 1 ファイル。履歴は持たない） */
export const WebCaptureStorage = {
  async save(id: string, jpeg: Buffer): Promise<void> {
    const dir = getWebCaptureDir();
    await fs.mkdir(dir, { recursive: true });
    await writeAtomicFileAtRoot(dir, fileNameFor(id), jpeg, 'replace');
  },

  async read(id: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(path.join(getWebCaptureDir(), fileNameFor(id)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },

  async remove(id: string): Promise<void> {
    await fs.rm(path.join(getWebCaptureDir(), fileNameFor(id)), { force: true });
  },
};
