import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

const getStorageBaseDir = () =>
  process.env.PHOTO_STORAGE_DIR ||
  (process.env.NODE_ENV === 'test' ? '/tmp/test-photo-storage' : '/opt/RaspberryPiSystem_002/storage');

const getDrawingsDir = () => path.join(getStorageBaseDir(), 'part-measurement-drawings');

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp'
};

const MAX_BYTES = 12 * 1024 * 1024;

/**
 * 部品測定 visual template 用の図面画像（1枚）を保存・読み込みする。
 * 配信 URL は `/api/storage/part-measurement-drawings/{uuid}{ext}` とする。
 */
export class PartMeasurementDrawingStorage {
  static async initialize(): Promise<void> {
    await fs.mkdir(getDrawingsDir(), { recursive: true });
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

  /**
   * バッファを保存し、API 経由で参照する相対 URL を返す。
   */
  static async saveDrawing(buffer: Buffer, mimetype: string): Promise<{ relativeUrl: string; contentType: string }> {
    if (buffer.length > MAX_BYTES) {
      throw new Error(`画像サイズが大きすぎます（最大 ${MAX_BYTES} バイト）`);
    }
    const ext = this.assertMime(mimetype);
    const id = randomUUID();
    const filename = `${id}${ext}`;
    const fullPath = path.join(getDrawingsDir(), filename);
    await fs.mkdir(getDrawingsDir(), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return {
      relativeUrl: `/api/storage/part-measurement-drawings/${filename}`,
      contentType: mimetype.toLowerCase().startsWith('image/') ? mimetype : 'application/octet-stream'
    };
  }

  /**
   * `/api/storage/part-measurement-drawings/...` からファイル名部分を除いたパスを解決して読み込む。
   */
  static async readDrawing(relativeUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    const prefix = '/api/storage/part-measurement-drawings/';
    if (!relativeUrl.startsWith(prefix)) {
      throw new Error('Invalid drawing URL');
    }
    const filename = relativeUrl.slice(prefix.length);
    if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new Error('Invalid drawing path');
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
    const fullPath = path.join(getDrawingsDir(), filename);
    const buffer = await fs.readFile(fullPath);
    return { buffer, contentType };
  }
}
