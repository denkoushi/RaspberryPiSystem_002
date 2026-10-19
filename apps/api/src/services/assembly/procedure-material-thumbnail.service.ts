import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { PHOTO_MAX_INPUT_PIXELS } from './procedure-material-gmail-packet-resolver.js';

export class ProcedureMaterialThumbnailService {
  private readonly cache = new Map<string, Buffer>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  private byteSize = 0;

  async read(bytes: Buffer): Promise<Buffer> {
    const key = createHash('sha256').update(bytes).digest('hex');
    const cached = this.cache.get(key);
    if (cached) { this.cache.delete(key); this.cache.set(key, cached); return cached; }
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = sharp(bytes, { limitInputPixels: PHOTO_MAX_INPUT_PIXELS }).rotate()
      .resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer()
      .then((thumbnail) => {
        this.cache.set(key, thumbnail); this.byteSize += thumbnail.length;
        while (this.cache.size > 128 || this.byteSize > 16 * 1024 * 1024) {
          const oldest = this.cache.keys().next().value!;
          this.byteSize -= this.cache.get(oldest)!.length; this.cache.delete(oldest);
        }
        return thumbnail;
      }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, task);
    return task;
  }
}
