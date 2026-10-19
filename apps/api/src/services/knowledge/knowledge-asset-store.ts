import { createHash } from 'node:crypto';

import type { DurableFileStorePort } from '../file-storage/durable-file-store.port.js';
import { FileStorageAlreadyExistsError } from '../file-storage/file-storage-errors.js';

/** Immutable content-addressed bytes backed by the existing integrity-checked durable store. */
export class KnowledgeAssetStore {
  constructor(private readonly store: DurableFileStorePort) {}

  async save(bytes: Buffer, variant: 'original' | 'display.jpg'): Promise<{ id: string; key: string }> {
    const id = createHash('sha256').update(bytes).digest('hex');
    const key = `knowledge-assets/${id}/${variant}`;
    try {
      await this.store.write({ key, data: bytes, mode: 'create', integrity: true });
    } catch (error) {
      if (!(error instanceof FileStorageAlreadyExistsError)) throw error;
      const existing = await this.store.read(key, { verifyIntegrity: true });
      if (!existing.equals(bytes)) throw new Error('Knowledge asset identity conflict');
    }
    return { id, key };
  }

  async readDisplay(imageId: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(imageId)) throw new Error('Invalid image identity');
    return this.store.read(`knowledge-assets/${imageId}/display.jpg`, { verifyIntegrity: true });
  }
  async readOriginal(assetId: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(assetId)) throw new Error('Invalid asset identity');
    return this.store.read(`knowledge-assets/${assetId}/original`, { verifyIntegrity: true });
  }
}
