import { createHash } from 'node:crypto';

import sharp from 'sharp';

import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';

import { PHOTO_MAX_INPUT_PIXELS } from './procedure-material-gmail-packet-resolver.js';

export class ProcedureMaterialThumbnailService {
  private readonly cache = new Map<string, Buffer>();
  private readonly pending = new Map<string, Promise<Buffer>>();
  private byteSize = 0;

  async readStored(storageKey: string, store: DurableFileStorePort): Promise<Buffer> {
    if (!/^procedure-materials\/[a-f0-9]{64}\/original$/.test(storageKey)) {
      return this.read(await store.read(storageKey, { verifyIntegrity: true }));
    }
    const key = storageKey.replace(/original$/, 'thumbnail-640.webp');
    const existing = this.pending.get(key);
    if (existing) return existing;
    const task = (async () => {
      try {
        const saved = await store.read(key, { verifyIntegrity: true });
        // verifyIntegrity checks the stored SHA-256; a header check is enough to reject foreign content.
        const metadata = await sharp(saved, { limitInputPixels: PHOTO_MAX_INPUT_PIXELS }).metadata();
        if (metadata.format !== 'webp' || !metadata.width || !metadata.height || metadata.width > 640 || metadata.height > 640) throw new Error('Invalid thumbnail');
        return saved;
      } catch {
        const thumbnail = await this.read(await store.read(storageKey, { verifyIntegrity: true }));
        try { await store.write({ key, data: thumbnail, mode: 'replace', integrity: true }); }
        catch { /* A full or unavailable store must not prevent displaying the photo. */ }
        return thumbnail;
      }
    })().finally(() => { this.pending.delete(key); });
    this.pending.set(key, task);
    return task;
  }

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
