import { randomUUID } from 'crypto';
import type { Stats } from 'fs';
import path from 'path';
import { getFileStorageRoot } from '../services/file-storage/file-storage-config.js';
import { getFileStorageRuntime } from '../services/file-storage/file-storage-runtime.js';

const getStorageBaseDir = () => getFileStorageRoot();

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
    await getFileStorageRuntime().store.initialize(['assembly-procedure-images']);
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
    await getFileStorageRuntime().store.write({
      key: `assembly-procedure-images/${filename}`,
      data: buffer,
      mode: 'create',
      integrity: true,
    });
    return {
      relativeUrl: `${PROCEDURE_IMAGE_URL_PREFIX}${filename}`,
      contentType: mimetype.toLowerCase().startsWith('image/') ? mimetype : 'application/octet-stream'
    };
  }

  static async statImage(relativeUrl: string): Promise<Stats> {
    const { fullPath } = resolveProcedureImageFile(relativeUrl);
    return getFileStorageRuntime().store.stat(
      path.relative(getStorageBaseDir(), fullPath).split(path.sep).join('/')
    );
  }

  static async readImage(relativeUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    const { fullPath, contentType } = resolveProcedureImageFile(relativeUrl);
    const key = path.relative(getStorageBaseDir(), fullPath).split(path.sep).join('/');
    return {
      buffer: await getFileStorageRuntime().store.read(key, { verifyIntegrity: true }),
      contentType,
    };
  }

  static async deleteImage(relativeUrl: string): Promise<void> {
    try {
      const { fullPath } = resolveProcedureImageFile(relativeUrl);
      const key = path.relative(getStorageBaseDir(), fullPath).split(path.sep).join('/');
      await getFileStorageRuntime().store.delete(key, { integrity: true });
    } catch {
      return;
    }
  }
}
