import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

const getStorageBaseDir = () =>
  process.env.PHOTO_STORAGE_DIR ||
  (process.env.NODE_ENV === 'test' ? '/tmp/test-photo-storage' : '/opt/RaspberryPiSystem_002/storage');

const getIllustrationsDir = () => path.join(getStorageBaseDir(), 'pallet-machine-illustrations');

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
};

const MAX_BYTES = 8 * 1024 * 1024;

const PUBLIC_PREFIX = '/api/storage/pallet-machine-illustrations/';

/**
 * パレット可視化・加工機イラスト（PNG/JPEG）の保存。配信 URL は `/api/storage/pallet-machine-illustrations/{uuid}{ext}`。
 */
export class PalletMachineIllustrationStorage {
  static async initialize(): Promise<void> {
    await fs.mkdir(getIllustrationsDir(), { recursive: true });
  }

  static assertMime(mimetype: string): string {
    const ext = MIME_TO_EXT[mimetype.toLowerCase()];
    if (!ext) {
      throw new Error(`サポートしていない画像形式です: ${mimetype}`);
    }
    return ext;
  }

  static getMaxBytes(): number {
    return MAX_BYTES;
  }

  static async saveIllustration(buffer: Buffer, mimetype: string): Promise<{ relativeUrl: string; contentType: string }> {
    if (buffer.length > MAX_BYTES) {
      throw new Error(`画像サイズが大きすぎます（最大 ${MAX_BYTES} バイト）`);
    }
    const ext = this.assertMime(mimetype);
    const id = randomUUID();
    const filename = `${id}${ext}`;
    const fullPath = path.join(getIllustrationsDir(), filename);
    await fs.mkdir(getIllustrationsDir(), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return {
      relativeUrl: `${PUBLIC_PREFIX}${filename}`,
      contentType: mimetype.toLowerCase().startsWith('image/') ? mimetype : 'application/octet-stream',
    };
  }

  static async readIllustration(relativeUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    if (!relativeUrl.startsWith(PUBLIC_PREFIX)) {
      throw new Error('Invalid illustration URL');
    }
    const filename = relativeUrl.slice(PUBLIC_PREFIX.length);
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Invalid illustration path');
    }
    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
    const fullPath = path.join(getIllustrationsDir(), filename);
    const buffer = await fs.readFile(fullPath);
    return { buffer, contentType };
  }

  static async deleteIllustrationFile(relativeUrl: string): Promise<void> {
    if (!relativeUrl.startsWith(PUBLIC_PREFIX)) {
      return;
    }
    const filename = relativeUrl.slice(PUBLIC_PREFIX.length);
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return;
    }
    const fullPath = path.join(getIllustrationsDir(), filename);
    try {
      await fs.unlink(fullPath);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') throw err;
    }
  }
}
