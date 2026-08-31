import { describe, expect, it, vi } from 'vitest';

import { WorkInstructionEditAssetCleanupService } from '../work-instruction-edit-asset-cleanup.service.js';
import { WorkInstructionEditService } from '../work-instruction-edit.service.js';
import type { WorkInstructionEditRepository } from '../repositories/work-instruction-edit-repository.port.js';

function cleanupRepository() {
  return {
    claimEditAssetCleanupCandidates: vi.fn(async () => [{
      assetId: 'asset-1',
      storageKey: 'work-instruction-assets/editing/asset-1.jpg',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      deletePendingAt: new Date('2026-08-01T00:00:00.000Z')
    }]),
    deleteEditAssetRecord: vi.fn(async () => true),
    recordEditAssetDeletionFailure: vi.fn(async () => undefined)
  };
}

describe('work-instruction edit asset lifecycle', () => {
  it('deletes a claimed asset and closes its DB row when the durable file is already absent', async () => {
    const repository = cleanupRepository();
    const files = { delete: vi.fn(async () => undefined) };
    const service = new WorkInstructionEditAssetCleanupService(
      repository as unknown as WorkInstructionEditRepository,
      files as never
    );

    await expect(service.cleanup(new Date('2026-08-31T00:00:00.000Z'))).resolves.toEqual({ deleted: 1, failed: 0 });
    expect(files.delete).toHaveBeenCalledWith({ storageKey: 'work-instruction-assets/editing/asset-1.jpg' });
    expect(repository.deleteEditAssetRecord).toHaveBeenCalledWith({ assetId: 'asset-1' });
  });

  it('keeps DELETE_PENDING for a physical failure so the next tick can retry', async () => {
    const repository = cleanupRepository();
    const files = { delete: vi.fn(async () => { throw new Error('disk unavailable'); }) };
    const service = new WorkInstructionEditAssetCleanupService(
      repository as unknown as WorkInstructionEditRepository,
      files as never
    );

    await expect(service.cleanup(new Date('2026-08-31T00:00:00.000Z'))).resolves.toEqual({ deleted: 0, failed: 1 });
    expect(repository.recordEditAssetDeletionFailure).toHaveBeenCalledWith({ assetId: 'asset-1', error: 'disk unavailable' });
    expect(repository.deleteEditAssetRecord).not.toHaveBeenCalled();
  });

  it('treats an idempotent source-file delete as success and completes the tombstone', async () => {
    const repository = {
      requestSourceAssetDeletion: vi.fn(async () => ({
        auditId: 'audit-1', assetId: 'source-asset-1', storageKey: 'work-instruction-assets/source-1.jpg', sha256: 'a'.repeat(64), status: 'REQUESTED' as const
      })),
      completeSourceAssetDeletion: vi.fn(async () => undefined),
      failSourceAssetDeletion: vi.fn(async () => undefined)
    };
    const sourceFiles = { delete: vi.fn(async () => undefined) };
    const service = new WorkInstructionEditService(
      repository as unknown as WorkInstructionEditRepository,
      {} as never,
      sourceFiles as never,
      { requireAccessPassword: vi.fn(async () => undefined) } as never
    );

    await expect(service.deleteSourceAsset({ sourceVersionId: 'version-1', assetId: 'source-asset-1', requestedBy: 'admin' })).resolves.toEqual({
      assetId: 'source-asset-1', auditId: 'audit-1', status: 'DELETED'
    });
    expect(repository.completeSourceAssetDeletion).toHaveBeenCalledWith({ auditId: 'audit-1', assetId: 'source-asset-1' });
    expect(repository.failSourceAssetDeletion).not.toHaveBeenCalled();
  });
});
