import { createHash } from 'node:crypto';

import type {
  DurableFileStorePort,
  StoredFileResult,
} from '../file-storage/durable-file-store.port.js';
import { getFileStorageRuntime } from '../file-storage/file-storage-runtime.js';
import type { WorkInstructionStagedAsset } from './domain/types.js';

export type WorkInstructionAssetBytes = ReadonlyMap<string, Buffer>;

export interface WorkInstructionFileStorePort {
  writeStagedAssets(
    stagedAssets: ReadonlyArray<WorkInstructionStagedAsset>,
    bytesByAssetId: WorkInstructionAssetBytes
  ): Promise<ReadonlyArray<StoredFileResult>>;
  read(asset: { storageKey: string }): Promise<Buffer>;
  delete(asset: { storageKey: string }): Promise<void>;
}

/**
 * Durable filesystem adapter for work-instruction originals. Database staging
 * is performed by the repository; this adapter only writes immutable bytes,
 * reads active bytes, and deletes files that the repository has released.
 */
export class WorkInstructionFileStoreAdapter implements WorkInstructionFileStorePort {
  constructor(private readonly store: DurableFileStorePort = getFileStorageRuntime().store) {}

  async writeStagedAssets(
    stagedAssets: ReadonlyArray<WorkInstructionStagedAsset>,
    bytesByAssetId: WorkInstructionAssetBytes
  ): Promise<ReadonlyArray<StoredFileResult>> {
    const requests = stagedAssets.map((asset) => {
      const bytes = bytesByAssetId.get(asset.assetId);
      if (!bytes) throw new Error(`Missing bytes for staged work-instruction asset ${asset.assetId}`);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== asset.sha256 || bytes.length !== asset.sizeBytes) {
        throw new Error(`Staged work-instruction asset integrity mismatch: ${asset.assetId}`);
      }
      return {
        key: asset.storageKey,
        data: bytes,
        mode: 'create' as const,
        integrity: true,
      };
    });
    return this.store.writeBatch(requests);
  }

  async read(asset: { storageKey: string }): Promise<Buffer> {
    return this.store.read(asset.storageKey, { verifyIntegrity: true });
  }

  async delete(asset: { storageKey: string }): Promise<void> {
    await this.store.delete(asset.storageKey, { integrity: true });
  }

}
