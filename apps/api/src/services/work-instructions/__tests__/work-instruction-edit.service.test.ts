import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { TextCandidatePort } from '../../image-region/text-candidate.port.js';
import type {
  WorkInstructionCopyResult,
  WorkInstructionEditAssetView,
  WorkInstructionEditRevisionContext,
  WorkInstructionEditRevisionView,
  WorkInstructionEditingView,
  WorkInstructionSourceVersionView
} from '../domain/editing.js';
import type { WorkInstructionEditRepository } from '../repositories/work-instruction-edit-repository.port.js';
import { workInstructionEditStorageKey } from '../work-instruction-edit-file-store.adapter.js';
import type { WorkInstructionEditFileStorePort } from '../work-instruction-edit-file-store.adapter.js';
import { WorkInstructionEditService } from '../work-instruction-edit.service.js';
import type { WorkInstructionAccessService } from '../work-instruction-access.service.js';
import type { WorkInstructionFileStorePort } from '../work-instruction-file-store.adapter.js';

const now = new Date('2026-08-31T00:00:00.000Z');
const rowId = 'row-1';
const revisionId = 'revision-1';
const sourceVersionId = 'source-version-1';

const sourceVersion: WorkInstructionSourceVersionView = {
  id: sourceVersionId,
  rowId,
  sourceModified: now,
  partNumber: 'MD004',
  shootingTarget: '研削',
  rawManifest: { fixture: true },
  contentHash: 'a'.repeat(64),
  createdAt: now,
  steps: [{
    id: 'step-1',
    step: 1,
    text: '本文',
    imageName: 'step-1.jpg',
    imageAssetId: 'source-asset-1',
    imageStorageKey: 'work-instruction-assets/source-asset-1.jpg',
    imageMimeType: 'image/jpeg',
    imageSha256: 'b'.repeat(64),
    imageDeletedAt: null,
    imageDeletedBy: null
  }]
};

const revision: WorkInstructionEditRevisionView = {
  id: revisionId,
  sourceVersionId,
  revisionNumber: 1,
  supersedesRevisionId: null,
  copiedFromRevisionId: null,
  isRevisionHead: true,
  status: 'DRAFT',
  editVersion: 0,
  baseContentHash: sourceVersion.contentHash,
  createdAt: now,
  updatedAt: now,
  overlays: []
};

const copy: WorkInstructionCopyResult = {
  elements: [],
  copiedCount: 0,
  needsReviewCount: 0,
  unassignedCount: 0,
  skippedCount: 0,
  unassignedIds: []
};

const editingView: WorkInstructionEditingView = {
  rowId,
  source: { system: 'SharePoint', list: 'List', itemId: 101, modified: now },
  latestVersion: sourceVersion,
  publishedVersion: sourceVersion,
  draftRevision: revision,
  publishedRevision: null
};

const revisionContext: WorkInstructionEditRevisionContext = {
  revision,
  source: editingView.source,
  sourceVersion
};

function editAsset(overrides: Partial<WorkInstructionEditAssetView> = {}): WorkInstructionEditAssetView {
  return {
    id: 'edit-asset-1',
    storageKey: 'work-instruction-assets/editing/edit-asset-1.png',
    mimeType: 'image/png',
    sizeBytes: 3,
    sha256: 'c'.repeat(64),
    status: 'ACTIVE',
    origin: 'UPLOAD',
    originSourceVersionId: null,
    originSourceStep: null,
    originBbox: null,
    ownerRevisionId: revisionId,
    createdAt: now,
    activatedAt: now,
    deletePendingAt: null,
    ...overrides
  };
}

function makeRepository() {
  return {
    readEditingView: vi.fn(async () => null),
    readRevisionContext: vi.fn(async () => null),
    listSourceVersions: vi.fn(async () => []),
    findSourceVersionForDeletion: vi.fn(async () => null),
    readRevisionSourceImage: vi.fn(async () => null),
    createDraftRevision: vi.fn(async () => ({ revision, copy })),
    createDraftRevisionGroup: vi.fn(async () => [{ revision, copy }]),
    saveOverlays: vi.fn(async () => revision),
    saveDraft: vi.fn(async () => revision),
    applyRoiRebase: vi.fn(async () => revision),
    publishRevision: vi.fn(async () => ({ revision, migration: { needsReviewCount: 0, unassignedCount: 0, skippedCount: 0 } })),
    publishRevisionGroup: vi.fn(async () => []),
    discardRevision: vi.fn(async () => revision),
    stageEditAsset: vi.fn(async () => editAsset({ id: 'staged-edit-asset', status: 'STAGED', activatedAt: null })),
    activateEditAsset: vi.fn(async () => editAsset()),
    releaseEditAsset: vi.fn(async () => null),
    markEditAssetDeletePending: vi.fn(async () => undefined),
    readEditAsset: vi.fn(async () => null),
    claimEditAssetCleanupCandidates: vi.fn(async () => []),
    deleteEditAssetRecord: vi.fn(async () => true),
    recordEditAssetDeletionFailure: vi.fn(async () => undefined),
    requestSourceAssetDeletion: vi.fn(async () => ({
      auditId: 'audit-1',
      assetId: 'source-asset-1',
      storageKey: 'work-instruction-assets/source-asset-1.jpg',
      sha256: 'b'.repeat(64),
      status: 'REQUESTED' as const
    })),
    completeSourceAssetDeletion: vi.fn(async () => undefined),
    failSourceAssetDeletion: vi.fn(async () => undefined)
  };
}

function makeEditFiles() {
  return {
    write: vi.fn(async ({ assetId, bytes, mimeType }: { assetId: string; bytes: Buffer; mimeType: string }) => ({
      assetId,
      storageKey: workInstructionEditStorageKey(assetId, mimeType),
      mimeType,
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })),
    read: vi.fn(async () => Buffer.from('edit-bytes')),
    delete: vi.fn(async () => undefined)
  };
}

function makeSourceFiles() {
  return {
    writeStagedAssets: vi.fn(async () => []),
    read: vi.fn(async () => Buffer.from('source-bytes')),
    delete: vi.fn(async () => undefined)
  };
}

function makeAccess() {
  return {
    requireAccessPassword: vi.fn(async (_password: string | undefined) => undefined)
  };
}

function makeTextCandidates() {
  return {
    extractCandidates: vi.fn(async () => [])
  };
}

function makeService(input: {
  repository?: ReturnType<typeof makeRepository>;
  editFiles?: ReturnType<typeof makeEditFiles>;
  sourceFiles?: ReturnType<typeof makeSourceFiles>;
  access?: ReturnType<typeof makeAccess>;
  textCandidates?: ReturnType<typeof makeTextCandidates>;
} = {}) {
  const repository = input.repository ?? makeRepository();
  const editFiles = input.editFiles ?? makeEditFiles();
  const sourceFiles = input.sourceFiles ?? makeSourceFiles();
  const access = input.access ?? makeAccess();
  const textCandidates = input.textCandidates ?? makeTextCandidates();
  const service = new WorkInstructionEditService(
    repository as unknown as WorkInstructionEditRepository,
    editFiles as unknown as WorkInstructionEditFileStorePort,
    sourceFiles as unknown as WorkInstructionFileStorePort,
    access as unknown as WorkInstructionAccessService,
    textCandidates as unknown as TextCandidatePort
  );
  return { service, repository, editFiles, sourceFiles, access, textCandidates };
}

function uploadInput(overrides: Partial<{
  accessPassword: string;
  revisionId: string;
  bytes: Buffer;
  mimeType: string;
  origin: { origin: 'UPLOAD' | 'ROI'; sourceVersionId?: string; sourceStep?: number; bbox?: { xRatio: number; yRatio: number; widthRatio: number; heightRatio: number } };
}> = {}) {
  return {
    accessPassword: 'secret',
    revisionId,
    bytes: Buffer.from('abc'),
    mimeType: 'image/png',
    ...overrides
  };
}

function sourceDeletionRequest(overrides: Partial<{
  auditId: string;
  assetId: string;
  storageKey: string;
  sha256: string;
  status: 'REQUESTED' | 'DELETED' | 'FAILED';
}> = {}) {
  return {
    auditId: 'audit-1',
    assetId: 'source-asset-1',
    storageKey: 'work-instruction-assets/source-asset-1.jpg',
    sha256: 'b'.repeat(64),
    status: 'REQUESTED' as const,
    ...overrides
  };
}

describe('WorkInstructionEditService', () => {
  describe('repository forwarding and access control', () => {
    it('forwards read APIs and authenticated draft creation, including group identity', async () => {
      const fixture = makeService();
      fixture.repository.readEditingView.mockResolvedValue(editingView);
      fixture.repository.readRevisionContext.mockResolvedValue(revisionContext);
      fixture.repository.listSourceVersions.mockResolvedValue([sourceVersion]);

      await expect(fixture.service.readEditingView(rowId)).resolves.toBe(editingView);
      await expect(fixture.service.readRevisionContext(revisionId)).resolves.toBe(revisionContext);
      await expect(fixture.service.listSourceVersions(rowId)).resolves.toEqual([sourceVersion]);
      expect(fixture.repository.readEditingView).toHaveBeenCalledWith(rowId);
      expect(fixture.repository.readRevisionContext).toHaveBeenCalledWith(revisionId);
      expect(fixture.repository.listSourceVersions).toHaveBeenCalledWith(rowId);

      const draftInput = {
        rowId,
        sourceVersionId,
        copyFromRevisionId: 'old-revision',
        expectedPublishedVersionId: 'published-version',
        expectedLatestVersionId: 'latest-version',
        accessPassword: 'secret'
      };
      await expect(fixture.service.createDraftRevision(draftInput)).resolves.toEqual({ revision, copy });
      expect(fixture.access.requireAccessPassword).toHaveBeenCalledWith('secret');
      expect(fixture.repository.createDraftRevision).toHaveBeenCalledWith(draftInput);

      const rows = [{ rowId, sourceVersionId }];
      await expect(fixture.service.createDraftRevisionGroup({
        accessPassword: 'secret',
        partNumber: 'MD004',
        shootingTarget: '研削',
        rows
      })).resolves.toEqual([{ revision, copy }]);
      expect(fixture.repository.createDraftRevisionGroup).toHaveBeenCalledWith(rows, {
        partNumber: 'MD004',
        shootingTarget: '研削'
      });

      await fixture.service.createDraftRevisionGroup({ accessPassword: 'secret', rows: [] });
      expect(fixture.repository.createDraftRevisionGroup).toHaveBeenLastCalledWith([], undefined);
    });

    it('preserves memo copy counts and overrides while rebasing a copied ROI asset', async () => {
      const fixture = makeService();
      const roiOverlay = {
        id: 'roi-overlay-1',
        kind: 'IMAGE' as const,
        assetId: 'roi-asset-old',
        objectFit: 'contain' as const,
        sourceStep: 1,
        migratedFromStep: 1,
        baseStepFingerprint: 'overlay-base',
        targetStepFingerprint: 'overlay-target',
        migrationState: 'MIGRATED' as const,
        bbox: { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 },
        zIndex: 1,
        opacity: 1
      };
      const copiedMemo = {
        id: 'memo-1',
        sourceStep: 1,
        migratedFromStep: 1,
        baseStepFingerprint: 'memo-base',
        targetStepFingerprint: 'memo-target',
        migrationState: 'MIGRATED' as const,
        text: '引継ぎmemo'
      };
      const roiRevision: WorkInstructionEditRevisionView = {
        ...revision,
        overlays: [roiOverlay],
        assets: {
          'roi-asset-old': editAsset({
            id: 'roi-asset-old',
            origin: 'ROI',
            originSourceVersionId: 'source-version-old',
            originSourceStep: 1,
            originBbox: roiOverlay.bbox
          })
        }
      };
      const roiCopy: WorkInstructionCopyResult = {
        elements: [roiOverlay],
        copiedCount: 1,
        needsReviewCount: 0,
        unassignedCount: 0,
        skippedCount: 0,
        unassignedIds: [],
        memo: {
          overrides: [copiedMemo],
          copiedCount: 1,
          needsReviewCount: 0,
          unassignedCount: 0,
          skippedCount: 0,
          unassignedIds: []
        }
      };
      fixture.repository.createDraftRevision.mockResolvedValue({ revision: roiRevision, copy: roiCopy });
      fixture.repository.readRevisionSourceImage.mockResolvedValue({
        assetId: 'source-asset-1',
        storageKey: 'work-instruction-assets/source-asset-1.png',
        mimeType: 'image/png',
        sourceVersionId: 'source-version-old',
        sourceStep: 1
      });
      fixture.sourceFiles.read.mockResolvedValue(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64'
      ));
      fixture.repository.activateEditAsset.mockResolvedValue(editAsset({
        id: 'rebased-roi-asset',
        storageKey: 'work-instruction-assets/editing/rebased-roi-asset.jpg',
        mimeType: 'image/jpeg',
        origin: 'ROI',
        originSourceVersionId: 'source-version-old',
        originSourceStep: 1,
        originBbox: roiOverlay.bbox
      }));
      fixture.repository.applyRoiRebase.mockResolvedValue(roiRevision);

      const result = await fixture.service.createDraftRevision({ rowId, sourceVersionId });

      expect(result.copy).toMatchObject({
        copiedCount: 1,
        needsReviewCount: 0,
        unassignedCount: 0,
        skippedCount: 0,
        memo: {
          copiedCount: 1,
          needsReviewCount: 0,
          unassignedCount: 0,
          skippedCount: 0,
          overrides: [copiedMemo]
        }
      });
      expect(result.copy.elements[0]).toMatchObject({ assetId: 'rebased-roi-asset' });
      expect(fixture.repository.applyRoiRebase).toHaveBeenCalledWith({
        revisionId,
        expectedEditVersion: 0,
        updates: [{
          overlayId: 'roi-overlay-1',
          editAssetId: 'rebased-roi-asset',
          sourceStep: 1,
          migrationState: 'MIGRATED',
          targetStepFingerprint: 'overlay-target'
        }]
      });
    });

    it('forwards save, publish, group publish, and discard only after access succeeds', async () => {
      const fixture = makeService();
      const saveInput = {
        accessPassword: 'secret',
        revisionId,
        expectedEditVersion: 0,
        expectedSourceVersionId: sourceVersionId,
        expectedContentHash: sourceVersion.contentHash,
        elements: []
      };
      const publishInput = { accessPassword: 'secret', revisionId, expectedEditVersion: 0 };
      const publishGroupInput = {
        accessPassword: 'secret',
        partNumber: 'MD004',
        shootingTarget: '研削',
        revisions: [{ revisionId, expectedEditVersion: 0 }]
      };
      const discardInput = { accessPassword: 'secret', revisionId, expectedEditVersion: 0 };
      const published = { revision: { ...revision, status: 'PUBLISHED' as const }, migration: { needsReviewCount: 0, unassignedCount: 0, skippedCount: 0 } };
      fixture.repository.publishRevision.mockResolvedValue(published);
      fixture.repository.publishRevisionGroup.mockResolvedValue([published]);

      await expect(fixture.service.saveOverlays(saveInput)).resolves.toBe(revision);
      const draftSaveInput = {
        ...saveInput,
        memoOverrides: [{ sourceStep: 1, text: '' }]
      };
      await expect(fixture.service.saveDraft(draftSaveInput)).resolves.toBe(revision);
      await expect(fixture.service.publishRevision(publishInput)).resolves.toBe(published);
      await expect(fixture.service.publishRevisionGroup(publishGroupInput)).resolves.toEqual([published]);
      await expect(fixture.service.discardRevision(discardInput)).resolves.toBe(revision);

      expect(fixture.access.requireAccessPassword).toHaveBeenNthCalledWith(1, 'secret');
      expect(fixture.access.requireAccessPassword).toHaveBeenNthCalledWith(2, 'secret');
      expect(fixture.access.requireAccessPassword).toHaveBeenNthCalledWith(3, 'secret');
      expect(fixture.access.requireAccessPassword).toHaveBeenNthCalledWith(4, 'secret');
      expect(fixture.repository.saveOverlays).toHaveBeenCalledWith(saveInput);
      expect(fixture.repository.saveDraft).toHaveBeenCalledWith(draftSaveInput);
      expect(fixture.repository.publishRevision).toHaveBeenCalledWith(publishInput);
      expect(fixture.repository.publishRevisionGroup).toHaveBeenCalledWith(
        publishGroupInput.revisions,
        { partNumber: 'MD004', shootingTarget: '研削' }
      );
      expect(fixture.repository.discardRevision).toHaveBeenCalledWith(discardInput);
    });

    it('does not call write repositories when the access password is rejected', async () => {
      const fixture = makeService();
      fixture.access.requireAccessPassword.mockRejectedValue(new Error('wrong password'));

      await expect(fixture.service.saveOverlays({
        accessPassword: 'wrong',
        revisionId,
        expectedEditVersion: 0,
        expectedSourceVersionId: sourceVersionId,
        expectedContentHash: sourceVersion.contentHash,
        elements: []
      })).rejects.toThrow('wrong password');
      await expect(fixture.service.publishRevision({ accessPassword: 'wrong', revisionId, expectedEditVersion: 0 })).rejects.toThrow('wrong password');
      await expect(fixture.service.discardRevision({ accessPassword: 'wrong', revisionId })).rejects.toThrow('wrong password');

      expect(fixture.repository.saveOverlays).not.toHaveBeenCalled();
      expect(fixture.repository.publishRevision).not.toHaveBeenCalled();
      expect(fixture.repository.discardRevision).not.toHaveBeenCalled();
    });
  });

  describe('edit asset lifecycle', () => {
    it('stages, writes, verifies, and activates an uploaded asset', async () => {
      const fixture = makeService();
      const staged = editAsset({ id: 'staged-asset', status: 'STAGED', activatedAt: null });
      const active = editAsset({ id: 'staged-asset', status: 'ACTIVE' });
      fixture.repository.stageEditAsset.mockResolvedValue(staged);
      fixture.repository.activateEditAsset.mockResolvedValue(active);
      const input = uploadInput({ mimeType: 'image/jpg', origin: { origin: 'UPLOAD' } });

      await expect(fixture.service.uploadEditAsset(input)).resolves.toBe(active);

      const stagedInput = fixture.repository.stageEditAsset.mock.calls[0]?.[0];
      expect(stagedInput).toMatchObject({
        revisionId,
        mimeType: 'image/jpeg',
        sizeBytes: input.bytes.length,
        origin: input.origin
      });
      expect(stagedInput?.sha256).toBe(createHash('sha256').update(input.bytes).digest('hex'));
      const writeInput = fixture.editFiles.write.mock.calls[0]?.[0];
      expect(writeInput).toMatchObject({ assetId: expect.any(String), bytes: input.bytes, mimeType: 'image/jpeg' });
      expect(writeInput?.assetId).toBe(stagedInput?.storageKey.split('/').at(-1)?.replace('.jpg', ''));
      expect(fixture.repository.activateEditAsset).toHaveBeenCalledWith({ assetId: staged.id, revisionId });
      expect(fixture.access.requireAccessPassword).toHaveBeenCalledWith('secret');
    });

    it('rejects empty, oversized, and unsupported uploads before staging', async () => {
      const fixture = makeService();
      const cases = [
        { input: uploadInput({ bytes: Buffer.alloc(0) }), code: 'WORK_INSTRUCTION_EDIT_ASSET_EMPTY' },
        { input: uploadInput({ bytes: Buffer.alloc(12 * 1024 * 1024 + 1) }), code: 'WORK_INSTRUCTION_EDIT_ASSET_TOO_LARGE' },
        { input: uploadInput({ mimeType: 'image/gif' }), code: 'WORK_INSTRUCTION_EDIT_ASSET_MIME_INVALID' }
      ];

      for (const testCase of cases) {
        await expect(fixture.service.uploadEditAsset(testCase.input)).rejects.toMatchObject({ code: testCase.code });
      }
      expect(fixture.repository.stageEditAsset).not.toHaveBeenCalled();
      expect(fixture.editFiles.write).not.toHaveBeenCalled();
    });

    it('releases a staged row when the physical write fails', async () => {
      const fixture = makeService();
      const staged = editAsset({ id: 'staged-asset', status: 'STAGED', activatedAt: null });
      fixture.repository.stageEditAsset.mockResolvedValue(staged);
      fixture.editFiles.write.mockRejectedValue(new Error('disk write failed'));

      await expect(fixture.service.uploadEditAsset(uploadInput())).rejects.toThrow('disk write failed');
      expect(fixture.repository.releaseEditAsset).toHaveBeenCalledWith({ assetId: staged.id, revisionId });
      expect(fixture.editFiles.delete).not.toHaveBeenCalled();
      expect(fixture.repository.markEditAssetDeletePending).not.toHaveBeenCalled();
    });

    it('compensates an integrity mismatch by deleting bytes and releasing metadata', async () => {
      const fixture = makeService();
      const staged = editAsset({ id: 'staged-asset', status: 'STAGED', activatedAt: null });
      fixture.repository.stageEditAsset.mockResolvedValue(staged);
      fixture.editFiles.write.mockImplementation(async ({ assetId, bytes, mimeType }) => ({
        assetId,
        storageKey: 'work-instruction-assets/editing/wrong-key.png',
        mimeType,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
      }));

      await expect(fixture.service.uploadEditAsset(uploadInput())).rejects.toMatchObject({
        code: 'WORK_INSTRUCTION_EDIT_ASSET_INTEGRITY_ERROR'
      });
      const writeInput = fixture.editFiles.write.mock.calls[0]?.[0];
      expect(fixture.editFiles.delete).toHaveBeenCalledWith({ storageKey: workInstructionEditStorageKey(writeInput!.assetId, 'image/png') });
      expect(fixture.repository.releaseEditAsset).toHaveBeenCalledWith({ assetId: staged.id, revisionId });
      expect(fixture.repository.markEditAssetDeletePending).not.toHaveBeenCalled();
    });

    it('marks metadata DELETE_PENDING when activation fails and byte compensation fails', async () => {
      const fixture = makeService();
      const staged = editAsset({ id: 'staged-asset', status: 'STAGED', activatedAt: null });
      fixture.repository.stageEditAsset.mockResolvedValue(staged);
      fixture.repository.activateEditAsset.mockRejectedValue(new Error('database activation failed'));
      fixture.editFiles.delete.mockRejectedValue(new Error('disk cleanup failed'));

      await expect(fixture.service.uploadEditAsset(uploadInput())).rejects.toThrow('database activation failed');
      const writeInput = fixture.editFiles.write.mock.calls[0]?.[0];
      expect(fixture.editFiles.delete).toHaveBeenCalledWith({
        storageKey: workInstructionEditStorageKey(writeInput!.assetId, writeInput!.mimeType)
      });
      expect(fixture.repository.markEditAssetDeletePending).toHaveBeenCalledWith({ assetId: staged.id, revisionId });
      expect(fixture.repository.releaseEditAsset).not.toHaveBeenCalled();
    });
  });

  describe('asset reads and text candidates', () => {
    it('returns only active edit assets and reads their durable bytes', async () => {
      const fixture = makeService();
      fixture.repository.readEditAsset.mockResolvedValueOnce(null);
      await expect(fixture.service.readEditAsset('missing')).resolves.toBeNull();

      fixture.repository.readEditAsset.mockResolvedValueOnce(editAsset({ status: 'DELETE_PENDING' }));
      await expect(fixture.service.readEditAsset('pending')).resolves.toBeNull();
      expect(fixture.editFiles.read).not.toHaveBeenCalled();

      const active = editAsset();
      fixture.repository.readEditAsset.mockResolvedValueOnce(active);
      fixture.editFiles.read.mockResolvedValue(Buffer.from('active-bytes'));
      await expect(fixture.service.readEditAsset(active.id)).resolves.toEqual({
        asset: active,
        bytes: Buffer.from('active-bytes')
      });
      expect(fixture.editFiles.read).toHaveBeenCalledWith({ storageKey: active.storageKey });
    });

    it('extracts and groups text candidates for a source step', async () => {
      const fixture = makeService();
      const sourceImage = {
        assetId: 'source-asset-1',
        storageKey: 'work-instruction-assets/source-asset-1.jpg',
        mimeType: 'image/jpeg',
        sourceVersionId,
        sourceStep: 1
      };
      const bbox = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.5, heightRatio: 0.3 };
      fixture.repository.readRevisionSourceImage.mockResolvedValue(sourceImage);
      fixture.sourceFiles.read.mockResolvedValue(Buffer.from('source-image'));
      fixture.textCandidates.extractCandidates.mockResolvedValue([
        { text: 'M8', confidence: 0.9, bounds: { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.1, heightRatio: 0.1 }, pageIndex: 0, source: 'coordinate-ocr' },
        { text: '×20', confidence: 0.8, bounds: { xRatio: 0.22, yRatio: 0.2, widthRatio: 0.15, heightRatio: 0.1 }, pageIndex: 0, source: 'coordinate-ocr' }
      ]);

      await expect(fixture.service.findTextCandidates({
        accessPassword: 'secret',
        revisionId,
        stepKey: 'SharePoint:List:101:1',
        bbox
      })).resolves.toEqual([expect.objectContaining({
        text: 'M8×20',
        confidence: 0.8,
        source: 'coordinate-ocr',
        stepKey: 'SharePoint:List:101:1'
      })]);
      expect(fixture.repository.readRevisionSourceImage).toHaveBeenCalledWith(revisionId, 1);
      expect(fixture.textCandidates.extractCandidates).toHaveBeenCalledWith({
        imageBytes: Buffer.from('source-image'),
        imageMimeType: 'image/jpeg',
        bbox,
        roi: bbox
      });
    });

    it('wraps source reads and candidate extraction failures as an editor error', async () => {
      const fixture = makeService();
      fixture.repository.readRevisionSourceImage.mockResolvedValue({
        assetId: 'source-asset-1',
        storageKey: 'work-instruction-assets/source-asset-1.jpg',
        mimeType: 'image/jpeg',
        sourceVersionId,
        sourceStep: 1
      });
      fixture.sourceFiles.read.mockRejectedValue(new Error('source unavailable'));

      await expect(fixture.service.findTextCandidates({
        accessPassword: 'secret',
        revisionId,
        stepKey: 'SharePoint:List:101:1',
        bbox: { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 }
      })).rejects.toMatchObject({
        statusCode: 503,
        code: 'WORK_INSTRUCTION_TEXT_CANDIDATES_FAILED',
        message: '文章候補の抽出に失敗しました: source unavailable'
      });

      fixture.repository.readRevisionSourceImage.mockResolvedValue(null);
      await expect(fixture.service.findTextCandidates({
        accessPassword: 'secret',
        revisionId,
        stepKey: 'SharePoint:List:101:1',
        bbox: { xRatio: 0, yRatio: 0, widthRatio: 1, heightRatio: 1 }
      })).rejects.toMatchObject({ statusCode: 404, code: 'WORK_INSTRUCTION_SOURCE_IMAGE_NOT_FOUND' });
    });
  });

  describe('source asset deletion', () => {
    it('handles requested, idempotently deleted, and failed source deletions', async () => {
      const fixture = makeService();
      fixture.repository.requestSourceAssetDeletion
        .mockResolvedValueOnce(sourceDeletionRequest({ auditId: 'audit-requested' }))
        .mockResolvedValueOnce(sourceDeletionRequest({ auditId: 'audit-already-deleted', status: 'DELETED' }))
        .mockResolvedValueOnce(sourceDeletionRequest({ auditId: 'audit-failed' }));
      fixture.sourceFiles.delete
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('source disk unavailable'));

      await expect(fixture.service.deleteSourceAsset({ sourceVersionId, assetId: 'source-asset-1', requestedBy: 'admin' })).resolves.toEqual({
        assetId: 'source-asset-1',
        auditId: 'audit-requested',
        status: 'DELETED'
      });
      await expect(fixture.service.deleteSourceAsset({ sourceVersionId, assetId: 'source-asset-1', requestedBy: 'admin' })).resolves.toEqual({
        assetId: 'source-asset-1',
        auditId: 'audit-already-deleted',
        status: 'DELETED'
      });
      await expect(fixture.service.deleteSourceAsset({ sourceVersionId, assetId: 'source-asset-1', requestedBy: 'admin' })).resolves.toEqual({
        assetId: 'source-asset-1',
        auditId: 'audit-failed',
        status: 'FAILED',
        error: 'source disk unavailable'
      });

      expect(fixture.sourceFiles.delete).toHaveBeenCalledTimes(2);
      expect(fixture.repository.completeSourceAssetDeletion).toHaveBeenCalledWith({ auditId: 'audit-requested', assetId: 'source-asset-1' });
      expect(fixture.repository.completeSourceAssetDeletion).not.toHaveBeenCalledWith({ auditId: 'audit-already-deleted', assetId: 'source-asset-1' });
      expect(fixture.repository.failSourceAssetDeletion).toHaveBeenCalledWith({ auditId: 'audit-failed', error: 'source disk unavailable' });
    });

    it('deletes each unique source-version image and reports a skipped asset independently', async () => {
      const fixture = makeService();
      const version = {
        ...sourceVersion,
        steps: [
          ...sourceVersion.steps,
          { ...sourceVersion.steps[0], id: 'step-2', step: 2, imageAssetId: 'source-asset-2' },
          { ...sourceVersion.steps[0], id: 'step-3', step: 3, imageAssetId: 'source-asset-1' },
          { ...sourceVersion.steps[0], id: 'step-4', step: 4, imageAssetId: null }
        ]
      };
      fixture.repository.findSourceVersionForDeletion.mockResolvedValue(version);
      fixture.repository.requestSourceAssetDeletion.mockImplementation(async ({ assetId }) => {
        if (assetId === 'source-asset-2') throw new Error('already being deleted');
        return sourceDeletionRequest({ assetId, auditId: `audit-${assetId}` });
      });

      await expect(fixture.service.deleteSourceVersionImages({ sourceVersionId, requestedBy: 'admin' })).resolves.toEqual([
        { assetId: 'source-asset-1', auditId: 'audit-source-asset-1', status: 'DELETED' },
        { assetId: 'source-asset-2', auditId: null, status: 'SKIPPED', error: 'already being deleted' }
      ]);
      expect(fixture.repository.findSourceVersionForDeletion).toHaveBeenCalledWith(sourceVersionId);
      expect(fixture.repository.requestSourceAssetDeletion).toHaveBeenCalledTimes(2);
      expect(fixture.sourceFiles.delete).toHaveBeenCalledTimes(1);

      fixture.repository.findSourceVersionForDeletion.mockResolvedValue(null);
      await expect(fixture.service.deleteSourceVersionImages({ sourceVersionId, requestedBy: 'admin' })).rejects.toMatchObject({
        statusCode: 404,
        code: 'WORK_INSTRUCTION_SOURCE_VERSION_NOT_FOUND'
      });
    });
  });
});
