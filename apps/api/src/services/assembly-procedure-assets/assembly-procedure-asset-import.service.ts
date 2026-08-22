import type {
  AssemblyProcedureAssetSaveInput,
  AssemblyProcedureAssetStoragePort,
  StoredAssemblyProcedureAsset,
} from './assembly-procedure-asset-storage.port.js';

/**
 * DB-facing shape intentionally contains no Prisma types. The API/domain
 * owner can map this shape to the eventual asset metadata row.
 */
export type AssemblyProcedureAssetRecordInput = {
  asset: StoredAssemblyProcedureAsset;
  metadata?: Readonly<Record<string, unknown>>;
};

export interface AssemblyProcedureAssetRecordPort<TRecord = unknown> {
  create(input: AssemblyProcedureAssetRecordInput): Promise<TRecord>;
}

export type AssemblyProcedureAssetImportResult<TRecord> = {
  asset: StoredAssemblyProcedureAsset;
  record: TRecord;
};

/**
 * Persists the immutable blob before its metadata row and compensates only
 * blobs created by this invocation when metadata persistence fails. Existing
 * assets are never replaced or deleted: the storage adapter uses create-only
 * writes and this service tracks references returned by its own save calls.
 */
export class AssemblyProcedureAssetImportService<TRecord = unknown> {
  constructor(
    private readonly storage: AssemblyProcedureAssetStoragePort,
    private readonly records: AssemblyProcedureAssetRecordPort<TRecord>,
  ) {}

  async import(
    input: AssemblyProcedureAssetSaveInput & {
      metadata?: Readonly<Record<string, unknown>>;
    },
  ): Promise<AssemblyProcedureAssetImportResult<TRecord>> {
    const asset = await this.storage.save(input);
    try {
      const record = await this.records.create({
        asset,
        metadata: input.metadata,
      });
      return { asset, record };
    } catch (error) {
      await this.storage.delete(asset).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Import several blobs as one metadata operation. This is useful when a
   * document import stores its original together with generated image
   * assets. The compensation list is local to this call only.
   */
  async importBundle(
    input: {
      assets: readonly AssemblyProcedureAssetSaveInput[];
      metadata?: Readonly<Record<string, unknown>>;
    },
  ): Promise<{
    assets: StoredAssemblyProcedureAsset[];
    record: TRecord;
  }> {
    if (input.assets.length === 0) {
      throw new Error('Assembly procedure asset bundle is empty');
    }
    const saved: StoredAssemblyProcedureAsset[] = [];
    try {
      for (const assetInput of input.assets) {
        // Sequential writes keep the compensation order deterministic and
        // avoid making a large document consume all write slots at once.
        // eslint-disable-next-line no-await-in-loop
        saved.push(await this.storage.save(assetInput));
      }
      const record = await this.records.create({
        asset: saved[0]!,
        metadata: {
          ...(input.metadata ?? {}),
          assets: saved,
        },
      });
      return { assets: saved, record };
    } catch (error) {
      await Promise.all(saved.map((asset) => this.storage.delete(asset).catch(() => undefined)));
      throw error;
    }
  }
}
