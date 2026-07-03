import { randomUUID } from 'crypto';
import { promises as fs, type Stats } from 'fs';
import path from 'path';

const getStorageBaseDir = () =>
  process.env.PHOTO_STORAGE_DIR ||
  (process.env.NODE_ENV === 'test' ? '/tmp/test-photo-storage' : '/opt/RaspberryPiSystem_002/storage');

const getProcedureImagesDir = () => path.join(getStorageBaseDir(), 'assembly-procedure-images');

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp'
};

const MAX_BYTES = 12 * 1024 * 1024;
const PROCEDURE_IMAGE_URL_PREFIX = '/api/storage/assembly-procedure-images/';

function resolveProcedureImageFile(relativeUrl: string): { fullPath: string; contentType: string } {
  if (!relativeUrl.startsWith(PROCEDURE_IMAGE_URL_PREFIX)) {
    throw new Error('Invalid assembly procedure image URL');
  }
  const filename = relativeUrl.slice(PROCEDURE_IMAGE_URL_PREFIX.length);
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid assembly procedure image path');
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
  return { fullPath: path.join(getProcedureImagesDir(), filename), contentType };
}

export class AssemblyProcedureImageStorage {
  static async initialize(): Promise<void> {
    await fs.mkdir(getProcedureImagesDir(), { recursive: true });
  }

  static assertMime(mimetype: string): string {
    const ext = MIME_TO_EXT[mimetype.toLowerCase()];
    if (!ext) {
      throw new Error(`サポートしていない手順書画像形式です: ${mimetype}`);
    }
    return ext;
  }

  static getMaxBytes(): number {
    return MAX_BYTES;
  }

  static async saveImage(buffer: Buffer, mimetype: string): Promise<{ relativeUrl: string; contentType: string }> {
    if (buffer.length > MAX_BYTES) {
      throw new Error(`手順書画像サイズが大きすぎます（最大 ${MAX_BYTES} バイト）`);
    }
    const ext = this.assertMime(mimetype);
    const filename = `${randomUUID()}${ext}`;
    const fullPath = path.join(getProcedureImagesDir(), filename);
    await fs.mkdir(getProcedureImagesDir(), { recursive: true });
    await fs.writeFile(fullPath, buffer);
    return {
      relativeUrl: `${PROCEDURE_IMAGE_URL_PREFIX}${filename}`,
      contentType: mimetype.toLowerCase().startsWith('image/') ? mimetype : 'application/octet-stream'
    };
  }

  static async statImage(relativeUrl: string): Promise<Stats> {
    const { fullPath } = resolveProcedureImageFile(relativeUrl);
    return fs.stat(fullPath);
  }

  static async readImage(relativeUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    const { fullPath, contentType } = resolveProcedureImageFile(relativeUrl);
    return { buffer: await fs.readFile(fullPath), contentType };
  }

  static async deleteImage(relativeUrl: string): Promise<void> {
    try {
      const { fullPath } = resolveProcedureImageFile(relativeUrl);
      await fs.unlink(fullPath).catch(() => undefined);
    } catch {
      return;
    }
  }
}
