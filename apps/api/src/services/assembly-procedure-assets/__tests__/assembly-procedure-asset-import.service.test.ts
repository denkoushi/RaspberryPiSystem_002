import { describe, expect, it, vi } from 'vitest';

import { AssemblyProcedureAssetImportService } from '../assembly-procedure-asset-import.service.js';
import type {
  AssemblyProcedureAssetStoragePort,
  StoredAssemblyProcedureAsset,
} from '../assembly-procedure-asset-storage.port.js';

const asset: StoredAssemblyProcedureAsset = {
  assetId: 'asset-1',
  storageKey: 'assembly-procedure-assets/asset-1.pdf',
  relativeUrl: '/api/storage/assembly-procedure-assets/asset-1.pdf',
  contentType: 'application/pdf',
  size: 4,
  sha256: 'a'.repeat(64),
};

describe('AssemblyProcedureAssetImportService', () => {
  it('compensates only assets saved by the failed metadata operation', async () => {
    const storage: AssemblyProcedureAssetStoragePort = {
      initialize: vi.fn(),
      save: vi.fn(async () => asset),
      read: vi.fn(),
      stat: vi.fn(),
      delete: vi.fn(async () => undefined),
    };
    const records = { create: vi.fn(async () => { throw new Error('db unavailable'); }) };
    const service = new AssemblyProcedureAssetImportService(storage, records);

    await expect(
      service.import({ data: Buffer.from('data'), contentType: 'application/pdf' }),
    ).rejects.toThrow('db unavailable');
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(asset);
  });
});
