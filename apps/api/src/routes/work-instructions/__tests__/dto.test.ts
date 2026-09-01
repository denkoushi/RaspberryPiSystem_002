import { describe, expect, it } from 'vitest';

import { computeWorkInstructionMemoFingerprint } from '../../../services/work-instructions/domain/editing.js';
import { toEditingViewDto, toRowDto } from '../dto.js';

describe('work-instruction response DTOs', () => {
  it('exposes an asset API URL without leaking the internal storage key', () => {
    const dto = toRowDto({
      id: 'row-1',
      source: {
        system: 'SharePoint',
        list: 'WorkInstructions',
        itemId: 640,
        modified: new Date('2026-08-29T00:00:00Z'),
      },
      partNumber: 'PART-1',
      shootingTarget: '研削',
      contentHash: 'hash',
      rawManifest: { schema_version: 1 },
      steps: [{
        id: 'step-1',
        step: 1,
        text: '確認',
        imageName: 'photo.webp',
        imageAssetId: 'asset-1',
        imageStorageKey: 'work-instruction-assets/asset-1',
        imageMimeType: 'image/webp',
        imageSha256: 'a'.repeat(64),
      }],
      createdAt: new Date('2026-08-29T00:00:00Z'),
      updatedAt: new Date('2026-08-29T00:00:00Z'),
    });

    expect(dto.steps[0]).toMatchObject({
      imageAssetId: 'asset-1',
      imageUrl: '/api/work-instructions/assets/asset-1',
    });
    expect(dto.steps[0]).not.toHaveProperty('imageStorageKey');
  });

  it('exposes the server-computed memo fingerprint on editor target steps', () => {
    const now = new Date('2026-08-29T00:00:00Z');
    const sourceVersion = {
      id: 'version-1',
      rowId: 'row-1',
      sourceModified: now,
      partNumber: 'PART-1',
      shootingTarget: '研削',
      rawManifest: { schema_version: 1 },
      contentHash: 'hash',
      createdAt: now,
      steps: [{
        id: 'step-1',
        step: 1,
        text: '  確認\\r\\n',
        imageName: null,
        imageAssetId: null,
        imageStorageKey: null,
        imageMimeType: null,
        imageSha256: null,
        imageDeletedAt: null,
        imageDeletedBy: null
      }]
    };
    const revision = {
      id: 'revision-1',
      sourceVersionId: sourceVersion.id,
      revisionNumber: 1,
      supersedesRevisionId: null,
      copiedFromRevisionId: null,
      isRevisionHead: true,
      status: 'DRAFT' as const,
      editVersion: 0,
      baseContentHash: sourceVersion.contentHash,
      createdAt: now,
      updatedAt: now,
      overlays: [],
      memoOverrides: []
    };
    const dto = toEditingViewDto({
      rowId: sourceVersion.rowId,
      source: { system: 'SharePoint', list: 'WorkInstructions', itemId: 640, modified: now },
      latestVersion: sourceVersion,
      publishedVersion: sourceVersion,
      draftRevision: revision,
      publishedRevision: null
    });

    expect(dto.draftRevision?.steps[0]).toMatchObject({
      memoFingerprint: computeWorkInstructionMemoFingerprint(sourceVersion.steps[0]!)
    });
  });
});
