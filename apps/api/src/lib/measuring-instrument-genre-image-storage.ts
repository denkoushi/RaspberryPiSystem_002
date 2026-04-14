import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

const getStorageBaseDir = () =>
  process.env.PHOTO_STORAGE_DIR ||
  (process.env.NODE_ENV === 'test' ? '/tmp/test-photo-storage' : '/opt/RaspberryPiSystem_002/storage');

/** 本番では `docker-compose.server.yml` で `measuring-instrument-genres-storage` をホストにバインドすること（未マウントだとコンテナ再作成で消失） */
const getGenreImageDir = () => path.join(getStorageBaseDir(), 'measuring-instrument-genres');

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp'
};

const MAX_BYTES = 12 * 1024 * 1024;

export class MeasuringInstrumentGenreImageStorage {
  static async initialize(): Promise<void> {
    await fs.mkdir(getGenreImageDir(), { recursive: true });
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

  static async save(buffer: Buffer, mimetype: string): Promise<{ relativeUrl: string; contentType: string }> {
    if (buffer.length > MAX_BYTES) {
      throw new Error(`画像サイズが大きすぎます（最大 ${MAX_BYTES} バイト）`);
    }
    const ext = this.assertMime(mimetype);
    const filename = `${randomUUID()}${ext}`;
    const fullPath = path.join(getGenreImageDir(), filename);
    await fs.mkdir(getGenreImageDir(), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return {
      relativeUrl: `/api/storage/measuring-instrument-genres/${filename}`,
      contentType: mimetype.toLowerCase().startsWith('image/') ? mimetype : 'application/octet-stream'
    };
  }

  static async read(relativeUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    const prefix = '/api/storage/measuring-instrument-genres/';
    if (!relativeUrl.startsWith(prefix)) {
      throw new Error('Invalid measuring instrument genre image URL');
    }
    const filename = relativeUrl.slice(prefix.length);
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Invalid measuring instrument genre image path');
    }
    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === '.png'
        ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'application/octet-stream';
    const fullPath = path.join(getGenreImageDir(), filename);
    const buffer = await fs.readFile(fullPath);
    return { buffer, contentType };
  }
}
