import { describe, expect, it, vi } from 'vitest';

import type { WorkInstructionEditRepository } from '../repositories/work-instruction-edit-repository.port.js';
import type { WorkInstructionEditFileStorePort } from '../work-instruction-edit-file-store.adapter.js';
import { WorkInstructionEditAssetCleanupService } from '../work-instruction-edit-asset-cleanup.service.js';

const candidate = {
  assetId: 'edit-asset-1',
  storageKey: 'work-instruction-assets/editing/edit-asset-1.png',
  createdAt: new Date('2026-08-31T00:00:00.000Z'),
  deletePendingAt: new Date('2026-08-31T00:00:00.000Z'),
};

function serviceFixture(input: {
  candidates?: typeof candidate[];
  removed?: boolean;
  fileDelete?: () => Promise<void>;
  recordFailure?: () => Promise<void>;
}) {
  const repository = {
    claimEditAssetCleanupCandidates: vi.fn(async () => input.candidates ?? []),
    deleteEditAssetRecord: vi.fn(async () => input.removed ?? true),
    recordEditAssetDeletionFailure: vi.fn(input.recordFailure ?? (async () => undefined)),
  };
  const files = {
    delete: vi.fn(input.fileDelete ?? (async () => undefined)),
  };
  return {
    service: new WorkInstructionEditAssetCleanupService(
      repository as unknown as WorkInstructionEditRepository,
      files as unknown as WorkInstructionEditFileStorePort,
    ),
    repository,
    files,
  };
}

describe('WorkInstructionEditAssetCleanupService edge cases', () => {
  it('does no work when there are no claimed candidates', async () => {
    const fixture = serviceFixture({});

    await expect(fixture.service.cleanup()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(fixture.files.delete).not.toHaveBeenCalled();
    expect(fixture.repository.deleteEditAssetRecord).not.toHaveBeenCalled();
  });

  it('counts a physical deletion whose guarded DB delete found no row as a non-failure', async () => {
    const fixture = serviceFixture({ candidates: [candidate], removed: false });

    await expect(fixture.service.cleanup()).resolves.toEqual({ deleted: 0, failed: 0 });
    expect(fixture.files.delete).toHaveBeenCalledWith({ storageKey: candidate.storageKey });
    expect(fixture.repository.deleteEditAssetRecord).toHaveBeenCalledWith({ assetId: candidate.assetId });
  });

  it('retains a failed candidate even when recording its failure also fails', async () => {
    const fixture = serviceFixture({
      candidates: [candidate],
      fileDelete: async () => { throw 'disk unavailable'; },
      recordFailure: async () => { throw new Error('database unavailable'); },
    });

    await expect(fixture.service.cleanup()).resolves.toEqual({ deleted: 0, failed: 1 });
    expect(fixture.repository.recordEditAssetDeletionFailure).toHaveBeenCalledWith({
      assetId: candidate.assetId,
      error: 'disk unavailable',
    });
    expect(fixture.repository.deleteEditAssetRecord).not.toHaveBeenCalled();
  });
});
