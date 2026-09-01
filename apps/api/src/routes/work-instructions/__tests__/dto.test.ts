import { describe, expect, it } from 'vitest';

import { computeWorkInstructionMemoFingerprint } from '../../../services/work-instructions/domain/editing.js';
import { toEditorGroupDto, toEditingViewDto, toRowDto } from '../dto.js';

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

  it('summarizes migrated overlays and memo overrides on editor revisions', () => {
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
        text: '確認',
        imageName: 'photo.webp',
        imageAssetId: 'asset-1',
        imageStorageKey: 'work-instruction-assets/asset-1',
        imageMimeType: 'image/webp',
        imageSha256: 'a'.repeat(64),
        imageDeletedAt: null,
        imageDeletedBy: null
      }]
    };
    const overlay = {
      id: 'overlay-1',
      kind: 'TEXT' as const,
      text: '注記',
      sourceStep: 1,
      migratedFromStep: 1,
      baseStepFingerprint: 'overlay-base',
      targetStepFingerprint: 'overlay-target',
      migrationState: 'MIGRATED' as const,
      bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.1 },
      zIndex: 1,
      opacity: 1
    };
    const memoOverride = {
      id: 'memo-override-1',
      sourceStep: 1,
      migratedFromStep: 1,
      baseStepFingerprint: computeWorkInstructionMemoFingerprint(sourceVersion.steps[0]!),
      targetStepFingerprint: computeWorkInstructionMemoFingerprint(sourceVersion.steps[0]!),
      migrationState: 'MIGRATED' as const,
      text: '現場memo'
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
      overlays: [overlay],
      memoOverrides: [memoOverride]
    };
    const source = { system: 'SharePoint', list: 'WorkInstructions', itemId: 640, modified: now };
    const editing = {
      rowId: sourceVersion.rowId,
      source,
      latestVersion: sourceVersion,
      publishedVersion: sourceVersion,
      draftRevision: revision,
      publishedRevision: null
    };
    const dto = toEditingViewDto(editing);

    expect(dto.draftRevision?.migration).toEqual({
      total: 1,
      migrated: 1,
      needsReview: 0,
      unassigned: 0,
      skipped: 0,
      memo: {
        total: 1,
        migrated: 1,
        needsReview: 0,
        unassigned: 0,
        skipped: 0
      }
    });
    expect(dto.draftRevision?.memoOverrides).toEqual([
      expect.objectContaining({
        text: '現場memo',
        sourceStep: 1,
        migratedFromStep: 1,
        stepKey: 'SharePoint:WorkInstructions:640:1',
        migratedFromStepKey: 'SharePoint:WorkInstructions:640:1'
      })
    ]);
    expect(dto.draftRevision?.steps[0]).toMatchObject({
      memoOverride: '現場memo',
      memoMigrationState: 'MIGRATED',
      overlays: [expect.objectContaining({ id: 'overlay-1', stepKey: 'SharePoint:WorkInstructions:640:1' })]
    });

    const archivedVersion = { ...sourceVersion, id: 'version-0', contentHash: 'archived-hash' };
    const group = toEditorGroupDto({
      partNumber: 'PART-1',
      shootingTarget: '研削',
      rows: [{
        source,
        editing,
        sourceVersions: [archivedVersion, sourceVersion],
        latestRevisionNumber: 1,
        publishedRevisionNumber: 1
      }]
    });

    expect(group.history[0]).toMatchObject({
      id: 'version-0',
      status: 'archived',
      imageCount: 1,
      eligibleImageCount: 1,
      canDeleteImage: true,
      images: [{
        assetId: 'asset-1',
        imageName: 'photo.webp',
        imageUrl: '/api/work-instructions/assets/asset-1',
        imageMimeType: 'image/webp',
        imageSha256: 'a'.repeat(64),
        canDeleteImage: true
      }]
    });
    expect(group.rows[0]?.published.steps[0]).not.toHaveProperty('memoOverride');

    const publishedOverlay = {
      id: 'published-overlay-1',
      kind: 'IMAGE' as const,
      assetId: 'published-asset-1',
      objectFit: 'contain' as const,
      sourceStep: 1,
      migratedFromStep: 1,
      baseStepFingerprint: 'published-overlay-base',
      targetStepFingerprint: 'published-overlay-target',
      migrationState: 'MIGRATED' as const,
      bbox: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.3, heightRatio: 0.4 },
      zIndex: 2,
      opacity: 1
    };
    const publishedAsset = {
      id: 'published-asset-1',
      storageKey: 'work-instruction-assets/editing/published-asset-1.png',
      mimeType: 'image/png',
      sizeBytes: 42,
      sha256: 'b'.repeat(64),
      status: 'ACTIVE' as const,
      origin: 'ROI' as const,
      originSourceVersionId: 'version-0',
      originSourceStep: 1,
      originBbox: publishedOverlay.bbox,
      ownerRevisionId: 'revision-1',
      createdAt: now,
      activatedAt: now,
      deletePendingAt: null
    };

    const publishedGroup = toEditorGroupDto({
      partNumber: 'PART-1',
      shootingTarget: '研削',
      rows: [{
        source,
        editing: {
          ...editing,
          draftRevision: null,
          publishedRevision: {
            ...revision,
            status: 'PUBLISHED' as const,
            overlays: [overlay, publishedOverlay],
            assets: { 'published-asset-1': publishedAsset }
          }
        },
        sourceVersions: [archivedVersion, sourceVersion],
        latestRevisionNumber: 1,
        publishedRevisionNumber: 1
      }]
    });

    expect(publishedGroup.rows[0]?.published.steps[0]).toMatchObject({
      memoOverride: '現場memo',
      memoMigrationState: 'MIGRATED'
    });
    expect(publishedGroup.rows[0]?.published.steps[0]?.overlays).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'overlay-1', stepKey: 'SharePoint:WorkInstructions:640:1' })
    ]));
    expect(publishedGroup.rows[0]?.published).toMatchObject({
      assets: {
        'published-asset-1': {
          assetId: 'published-asset-1',
          contentType: 'image/png',
          byteSize: 42,
          url: '/api/work-instructions/edit-assets/published-asset-1'
        }
      }
    });
    expect(publishedGroup.rows[0]?.published.steps[0]?.overlays).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'published-overlay-1', assetId: 'published-asset-1' })
    ]));
  });
});
