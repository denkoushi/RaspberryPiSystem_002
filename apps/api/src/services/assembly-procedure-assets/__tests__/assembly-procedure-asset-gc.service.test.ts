import { describe, expect, it, vi } from 'vitest';

import {
  AssemblyProcedureAssetGcService,
  type AssemblyProcedureAssetGcCandidate,
  type AssemblyProcedureAssetGcRepository
} from '../assembly-procedure-asset-gc.service.js';

type FakeAsset = AssemblyProcedureAssetGcCandidate & {
  createdAt: Date;
  ownerIsActiveDraft: boolean;
  overlayReferenceCount: number;
  sourceReferenceCount: number;
};

class FakeGcRepository implements AssemblyProcedureAssetGcRepository {
  lastInput: {
    cutoff: Date;
    limit: number;
    candidateAssetIds?: readonly string[];
  } | null = null;

  constructor(private readonly assets: FakeAsset[]) {}

  async claimAndDeleteUnreferencedAssets(input: {
    cutoff: Date;
    limit: number;
    candidateAssetIds?: readonly string[];
  }): Promise<AssemblyProcedureAssetGcCandidate[]> {
    this.lastInput = input;
    const allowedIds = input.candidateAssetIds ? new Set(input.candidateAssetIds) : null;
    const selected = this.assets
      .filter((asset) =>
        asset.createdAt <= input.cutoff &&
        (allowedIds === null || allowedIds.has(asset.id)) &&
        !asset.ownerIsActiveDraft &&
        asset.overlayReferenceCount === 0 &&
        asset.sourceReferenceCount === 0
      )
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .slice(0, input.limit);
    for (const asset of selected) {
      this.assets.splice(this.assets.indexOf(asset), 1);
    }
    return selected.map(({ id, storageKey }) => ({ id, storageKey }));
  }
}

const now = new Date('2026-08-21T12:00:00.000Z');
const old = new Date('2026-08-21T09:00:00.000Z');
const fresh = new Date('2026-08-21T11:30:00.000Z');

function asset(id: string, overrides: Partial<FakeAsset> = {}): FakeAsset {
  return {
    id,
    storageKey: `assembly-procedure-assets/${id}.jpg`,
    createdAt: old,
    ownerIsActiveDraft: false,
    overlayReferenceCount: 0,
    sourceReferenceCount: 0,
    ...overrides
  };
}

describe('AssemblyProcedureAssetGcService', () => {
  it('protects active draft uploads and revision-shared assets', async () => {
    const repository = new FakeGcRepository([
      asset('pending', { ownerIsActiveDraft: true }),
      asset('overlay-shared', { overlayReferenceCount: 2 }),
      asset('source-shared', { sourceReferenceCount: 2 }),
      asset('abandoned', { ownerIsActiveDraft: false }),
      asset('fresh', { createdAt: fresh })
    ]);
    const storage = { delete: vi.fn(async () => undefined) };
    const service = new AssemblyProcedureAssetGcService({ repository, storage });

    const result = await service.collect({ now, minAgeMs: 60 * 60 * 1000 });

    expect(result).toMatchObject({ claimed: 1, physicallyDeleted: 1 });
    expect(storage.delete).toHaveBeenCalledWith({
      storageKey: 'assembly-procedure-assets/abandoned.jpg'
    });
    expect(repository.lastInput?.cutoff).toEqual(new Date('2026-08-21T11:00:00.000Z'));
    expect(repository['assets'].map((item) => item.id)).toEqual([
      'pending',
      'overlay-shared',
      'source-shared',
      'fresh'
    ]);
  });

  it('uses a bounded candidate set so unrelated assets remain pending', async () => {
    const repository = new FakeGcRepository([asset('selected'), asset('other')]);
    const storage = { delete: vi.fn(async () => undefined) };
    const service = new AssemblyProcedureAssetGcService({ repository, storage });

    const result = await service.collect({
      now,
      // Exact candidates detached by a just-committed save/delete may be
      // collected immediately; the repository still rechecks references and
      // active-DRAFT ownership before deletion.
      minAgeMs: 0,
      candidateAssetIds: ['selected']
    });

    expect(result.claimed).toBe(1);
    expect(repository.lastInput).toMatchObject({
      cutoff: now,
      candidateAssetIds: ['selected']
    });
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(repository['assets'].map((item) => item.id)).toEqual(['other']);
  });

  it('does not fail the save path when physical deletion fails', async () => {
    const repository = new FakeGcRepository([asset('orphan')]);
    const warning = vi.fn();
    const storage = {
      delete: vi.fn(async () => {
        throw new Error('storage unavailable');
      })
    };
    const service = new AssemblyProcedureAssetGcService({
      repository,
      storage,
      logger: { warn: warning }
    });

    const result = await service.collect({ now, minAgeMs: 0 });

    expect(result).toEqual({
      claimed: 1,
      physicallyDeleted: 0,
      physicalDeleteFailures: [
        { id: 'orphan', storageKey: 'assembly-procedure-assets/orphan.jpg' }
      ]
    });
    expect(warning).toHaveBeenCalledTimes(1);
  });
});
