import { createHash, randomUUID } from 'node:crypto';

import { logger } from '../../lib/logger.js';
import type {
  WorkInstructionCopyResult,
  WorkInstructionEditAssetView,
  WorkInstructionEditRevisionView,
  WorkInstructionEditRevisionContext,
  WorkInstructionEditAssetOriginInput,
  WorkInstructionEditingView,
  WorkInstructionMemoOverrideInput,
  WorkInstructionOverlayElementInput,
  WorkInstructionSourceVersionView
} from './domain/editing.js';
import { WORK_INSTRUCTION_EDIT_IMAGE_MAX_BYTES, WorkInstructionEditingError } from './domain/editing.js';
import type { WorkInstructionFileStorePort } from './work-instruction-file-store.adapter.js';
import {
  normalizeWorkInstructionEditMimeType,
  workInstructionEditStorageKey,
  type WorkInstructionEditFileStorePort
} from './work-instruction-edit-file-store.adapter.js';
import type {
  WorkInstructionEditRepository,
  WorkInstructionGroupIdentity,
  WorkInstructionPublishRevisionInput,
  WorkInstructionPublishRevisionResult
} from './repositories/work-instruction-edit-repository.port.js';
import { WorkInstructionAccessService } from './work-instruction-access.service.js';
import { cropImageRegionRoi, groupTextCandidates, type ImageRegionRoi, type TextCandidate, type TextCandidatePort } from '../image-region/index.js';
import { CoordinateOcrTextCandidateAdapter } from '../image-region/coordinate-ocr-text-candidate.adapter.js';
import { getImageOcrLayoutPort } from '../ocr/image-ocr-runtime.js';

export type WorkInstructionSourceAssetDeletionResult = {
  assetId: string;
  auditId: string | null;
  status: 'DELETED' | 'FAILED' | 'REQUESTED' | 'SKIPPED';
  error?: string;
};

export type WorkInstructionTextCandidate = TextCandidate & { stepKey?: string | null };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Application boundary for editor auth, durable bytes, and revision persistence. */
export class WorkInstructionEditService {
  constructor(
    private readonly repository: WorkInstructionEditRepository,
    private readonly editFiles: WorkInstructionEditFileStorePort,
    private readonly sourceFiles: WorkInstructionFileStorePort,
    private readonly accessService: WorkInstructionAccessService = new WorkInstructionAccessService(),
    private readonly textCandidates: TextCandidatePort = new CoordinateOcrTextCandidateAdapter(getImageOcrLayoutPort())
  ) {}

  readEditingView(rowId: string): Promise<WorkInstructionEditingView | null> {
    return this.repository.readEditingView(rowId);
  }

  readRevisionContext(revisionId: string): Promise<WorkInstructionEditRevisionContext | null> {
    return this.repository.readRevisionContext(revisionId);
  }

  listSourceVersions(rowId: string): Promise<ReadonlyArray<WorkInstructionSourceVersionView>> {
    return this.repository.listSourceVersions(rowId);
  }

  async createDraftRevision(input: {
    rowId: string;
    sourceVersionId?: string;
    copyFromRevisionId?: string;
    expectedPublishedVersionId?: string;
    expectedLatestVersionId?: string;
    accessPassword?: string;
  }): Promise<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const result = await this.repository.createDraftRevision(input);
    return this.rebaseCopiedRoiAssets(result);
  }

  async createDraftRevisionGroup(input: {
    accessPassword?: string;
    partNumber?: string;
    shootingTarget?: string;
    rows: ReadonlyArray<{
      rowId: string;
      sourceVersionId?: string;
      copyFromRevisionId?: string;
      expectedPublishedVersionId?: string;
      expectedLatestVersionId?: string;
    }>;
  }): Promise<ReadonlyArray<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }>> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const results: Array<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }> = [];
    const expectedGroup: WorkInstructionGroupIdentity | undefined = input.partNumber && input.shootingTarget
      ? { partNumber: input.partNumber, shootingTarget: input.shootingTarget }
      : undefined;
    for (const row of await this.repository.createDraftRevisionGroup(input.rows, expectedGroup)) {
      // A failed ROI crop is represented on that overlay as NEEDS_REVIEW or
      // UNASSIGNED, so one bad source image never aborts the group copy.
      // eslint-disable-next-line no-await-in-loop
      results.push(await this.rebaseCopiedRoiAssets(row));
    }
    return results;
  }

  private async rebaseCopiedRoiAssets(
    result: { revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }
  ): Promise<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }> {
    const updates: Array<{
      overlayId: string;
      editAssetId?: string;
      sourceStep: number | null;
      migrationState: 'MIGRATED' | 'NEEDS_REVIEW' | 'UNASSIGNED' | 'SKIPPED';
      targetStepFingerprint?: string | null;
    }> = [];
    const stagedAssets: Array<{ assetId: string; storageKey: string }> = [];
    for (const overlay of result.revision.overlays) {
      if (overlay.kind !== 'IMAGE') continue;
      const originalAsset = result.revision.assets?.[overlay.assetId];
      if (!originalAsset || originalAsset.origin !== 'ROI' || originalAsset.originSourceVersionId === result.revision.sourceVersionId) continue;
      if (overlay.sourceStep == null) {
        updates.push({ overlayId: overlay.id, sourceStep: null, migrationState: 'UNASSIGNED' });
        continue;
      }
      if (!originalAsset.originBbox) {
        updates.push({ overlayId: overlay.id, sourceStep: overlay.sourceStep, migrationState: 'NEEDS_REVIEW' });
        continue;
      }
      try {
        const source = await this.sourceImageForStep(result.revision.id, String(overlay.sourceStep));
        const sourceBytes = await this.sourceFiles.read({ storageKey: source.storageKey });
        const cropped = await cropImageRegionRoi(sourceBytes, originalAsset.originBbox);
        const replacement = await this.persistEditAsset({
          revisionId: result.revision.id,
          bytes: cropped.buffer,
          mimeType: cropped.contentType,
          origin: {
            origin: 'ROI',
            sourceVersionId: source.sourceVersionId,
            sourceStep: source.sourceStep,
            bbox: originalAsset.originBbox
          }
        });
        stagedAssets.push({ assetId: replacement.id, storageKey: replacement.storageKey });
        updates.push({
          overlayId: overlay.id,
          editAssetId: replacement.id,
          sourceStep: overlay.sourceStep,
          migrationState: overlay.migrationState,
          targetStepFingerprint: overlay.targetStepFingerprint
        });
      } catch (error) {
        logger.warn({ err: error, revisionId: result.revision.id, overlayId: overlay.id }, 'work_instruction_roi_rebase_failed');
        updates.push({ overlayId: overlay.id, sourceStep: overlay.sourceStep, migrationState: 'NEEDS_REVIEW' });
      }
    }
    if (updates.length === 0) return result;
    let revision: WorkInstructionEditRevisionView;
    try {
      revision = await this.repository.applyRoiRebase({
        revisionId: result.revision.id,
        expectedEditVersion: result.revision.editVersion,
        updates
      });
    } catch (error) {
      // New physical bytes must not outlive a failed metadata update. The
      // repository release is best effort; DELETE_PENDING remains recoverable
      // when a durable delete is temporarily unavailable.
      for (const asset of stagedAssets) {
        await this.editFiles.delete({ storageKey: asset.storageKey }).catch(() => undefined);
        await this.repository.releaseEditAsset({ assetId: asset.assetId, revisionId: result.revision.id }).catch(() => undefined);
      }
      throw error;
    }
    const updatesByOverlay = new Map(updates.map((update) => [update.overlayId, update]));
    const elements = result.copy.elements.map((element) => {
      const update = updatesByOverlay.get(element.id);
      if (!update) return element;
      if (element.kind === 'IMAGE') {
        return {
          ...element,
          assetId: update.editAssetId ?? element.assetId,
          sourceStep: update.sourceStep,
          migrationState: update.migrationState
        };
      }
      return { ...element, sourceStep: update.sourceStep, migrationState: update.migrationState };
    }) as unknown as WorkInstructionCopyResult['elements'];
    return {
      revision,
      copy: {
        elements,
        copiedCount: elements.length,
        needsReviewCount: elements.filter((element) => element.migrationState === 'NEEDS_REVIEW').length,
        unassignedCount: elements.filter((element) => element.migrationState === 'UNASSIGNED').length,
        skippedCount: elements.filter((element) => element.migrationState === 'SKIPPED').length,
        unassignedIds: elements.filter((element) => element.migrationState === 'UNASSIGNED').map((element) => element.id)
      }
    };
  }

  async saveOverlays(input: {
    accessPassword?: string;
    revisionId: string;
    expectedEditVersion: number;
    expectedSourceVersionId: string;
    expectedContentHash: string;
    elements: ReadonlyArray<WorkInstructionOverlayElementInput>;
  }): Promise<WorkInstructionEditRevisionView> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    return this.repository.saveOverlays(input);
  }

  async saveDraft(input: {
    accessPassword?: string;
    revisionId: string;
    expectedEditVersion: number;
    expectedSourceVersionId: string;
    expectedContentHash: string;
    elements: ReadonlyArray<WorkInstructionOverlayElementInput>;
    memoOverrides: ReadonlyArray<WorkInstructionMemoOverrideInput>;
  }): Promise<WorkInstructionEditRevisionView> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    return this.repository.saveDraft(input);
  }

  async publishRevision(input: WorkInstructionPublishRevisionInput & { accessPassword?: string }): Promise<WorkInstructionPublishRevisionResult> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    return this.repository.publishRevision(input);
  }

  async publishRevisionGroup(input: {
    accessPassword?: string;
    partNumber?: string;
    shootingTarget?: string;
    revisions: ReadonlyArray<WorkInstructionPublishRevisionInput>;
  }): Promise<ReadonlyArray<WorkInstructionPublishRevisionResult>> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const expectedGroup: WorkInstructionGroupIdentity | undefined = input.partNumber && input.shootingTarget
      ? { partNumber: input.partNumber, shootingTarget: input.shootingTarget }
      : undefined;
    return this.repository.publishRevisionGroup(input.revisions, expectedGroup);
  }

  async discardRevision(input: { accessPassword?: string; revisionId: string; expectedEditVersion?: number }): Promise<WorkInstructionEditRevisionView> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    return this.repository.discardRevision(input);
  }

  async uploadEditAsset(input: { accessPassword?: string; revisionId: string; bytes: Buffer; mimeType: string; origin?: WorkInstructionEditAssetOriginInput }): Promise<WorkInstructionEditAssetView> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    return this.persistEditAsset(input);
  }

  /** Shared physical/DB asset lifecycle used by authenticated uploads and ROI rebase. */
  private async persistEditAsset(input: { revisionId: string; bytes: Buffer; mimeType: string; origin?: WorkInstructionEditAssetOriginInput }): Promise<WorkInstructionEditAssetView> {
    if (!Buffer.isBuffer(input.bytes) || input.bytes.length === 0) {
      throw new WorkInstructionEditingError(400, 'overlay画像が空です', 'WORK_INSTRUCTION_EDIT_ASSET_EMPTY');
    }
    if (input.bytes.length > WORK_INSTRUCTION_EDIT_IMAGE_MAX_BYTES) {
      throw new WorkInstructionEditingError(400, 'overlay画像が大きすぎます', 'WORK_INSTRUCTION_EDIT_ASSET_TOO_LARGE');
    }
    let mimeType: string;
    try {
      mimeType = normalizeWorkInstructionEditMimeType(input.mimeType);
    } catch (error) {
      throw new WorkInstructionEditingError(400, errorMessage(error), 'WORK_INSTRUCTION_EDIT_ASSET_MIME_INVALID');
    }
    const assetId = randomUUID();
    const storageKey = workInstructionEditStorageKey(assetId, mimeType);
    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const staged = await this.repository.stageEditAsset({
      revisionId: input.revisionId,
      storageKey,
      mimeType,
      sizeBytes: input.bytes.length,
      sha256,
      origin: input.origin
    });
    let written = false;
    try {
      const stored = await this.editFiles.write({ assetId, bytes: input.bytes, mimeType });
      written = true;
      if (stored.storageKey !== storageKey || stored.sha256 !== sha256 || stored.sizeBytes !== input.bytes.length) {
        throw new WorkInstructionEditingError(500, 'overlay画像の保存結果が一致しません', 'WORK_INSTRUCTION_EDIT_ASSET_INTEGRITY_ERROR');
      }
      return await this.repository.activateEditAsset({ assetId: staged.id, revisionId: input.revisionId });
    } catch (error) {
      // A staged DB row is intentionally retained when physical deletion
      // fails; the cleanup candidate can be retried without losing metadata.
      if (!written) {
        await this.repository.releaseEditAsset({ assetId: staged.id, revisionId: input.revisionId }).catch((releaseError) => {
          logger.warn({ err: releaseError, assetId: staged.id }, 'work_instruction_edit_asset_release_failed');
        });
      } else {
        let physicalDeleted = false;
        try {
          await this.editFiles.delete({ storageKey });
          physicalDeleted = true;
        } catch (cleanupError) {
          logger.warn({ err: cleanupError, storageKey }, 'work_instruction_edit_asset_compensation_failed');
        }
        if (physicalDeleted) {
          await this.repository.releaseEditAsset({ assetId: staged.id, revisionId: input.revisionId }).catch((releaseError) => {
            logger.warn({ err: releaseError, assetId: staged.id }, 'work_instruction_edit_asset_release_failed');
          });
        } else {
          await this.repository.markEditAssetDeletePending({ assetId: staged.id, revisionId: input.revisionId }).catch((markError) => {
            logger.warn({ err: markError, assetId: staged.id }, 'work_instruction_edit_asset_delete_pending_failed');
          });
        }
      }
      throw error;
    }
  }

  async readEditAsset(assetId: string): Promise<{ asset: WorkInstructionEditAssetView; bytes: Buffer } | null> {
    const asset = await this.repository.readEditAsset(assetId);
    if (!asset || asset.status !== 'ACTIVE') return null;
    return { asset, bytes: await this.editFiles.read({ storageKey: asset.storageKey }) };
  }

  private stepNumberFromKey(stepKey: string): number {
    const value = Number(stepKey.split(':').at(-1));
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new WorkInstructionEditingError(400, '手順識別子が不正です', 'WORK_INSTRUCTION_STEP_KEY_INVALID');
    }
    return value;
  }

  private async sourceImageForStep(revisionId: string, stepKey: string) {
    const source = await this.repository.readRevisionSourceImage(revisionId, this.stepNumberFromKey(stepKey));
    if (!source) {
      throw new WorkInstructionEditingError(404, '手順画像が見つかりません', 'WORK_INSTRUCTION_SOURCE_IMAGE_NOT_FOUND');
    }
    return source;
  }

  async createImageRegion(input: {
    accessPassword?: string;
    revisionId: string;
    stepKey: string;
    bbox: ImageRegionRoi;
  }): Promise<WorkInstructionEditAssetView> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const source = await this.sourceImageForStep(input.revisionId, input.stepKey);
    let cropped;
    try {
      const bytes = await this.sourceFiles.read({ storageKey: source.storageKey });
      cropped = await cropImageRegionRoi(bytes, input.bbox);
    } catch (error) {
      throw new WorkInstructionEditingError(400, `画像範囲の切り出しに失敗しました: ${errorMessage(error)}`, 'WORK_INSTRUCTION_IMAGE_REGION_FAILED');
    }
    return this.uploadEditAsset({
      accessPassword: input.accessPassword,
      revisionId: input.revisionId,
      bytes: cropped.buffer,
      mimeType: cropped.contentType,
      origin: {
        origin: 'ROI',
        sourceVersionId: source.sourceVersionId,
        sourceStep: source.sourceStep,
        bbox: input.bbox
      }
    });
  }

  async findTextCandidates(input: {
    accessPassword?: string;
    revisionId: string;
    stepKey: string;
    bbox: ImageRegionRoi;
  }): Promise<ReadonlyArray<WorkInstructionTextCandidate>> {
    await this.accessService.requireAccessPassword(input.accessPassword);
    const source = await this.sourceImageForStep(input.revisionId, input.stepKey);
    let candidates: TextCandidate[];
    try {
      const bytes = await this.sourceFiles.read({ storageKey: source.storageKey });
      candidates = await this.textCandidates.extractCandidates({
        imageBytes: bytes,
        imageMimeType: source.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
        bbox: input.bbox,
        roi: input.bbox
      });
    } catch (error) {
      throw new WorkInstructionEditingError(503, `文章候補の抽出に失敗しました: ${errorMessage(error)}`, 'WORK_INSTRUCTION_TEXT_CANDIDATES_FAILED');
    }
    return groupTextCandidates(candidates).map((candidate) => ({ ...candidate, stepKey: input.stepKey }));
  }

  async deleteSourceAsset(input: { sourceVersionId: string; assetId: string; requestedBy: string }): Promise<WorkInstructionSourceAssetDeletionResult> {
    const request = await this.repository.requestSourceAssetDeletion(input);
    if (request.status === 'DELETED') {
      return { assetId: request.assetId, auditId: request.auditId, status: 'DELETED' };
    }
    try {
      await this.sourceFiles.delete({ storageKey: request.storageKey });
      await this.repository.completeSourceAssetDeletion({ auditId: request.auditId, assetId: request.assetId });
      return { assetId: request.assetId, auditId: request.auditId, status: 'DELETED' };
    } catch (error) {
      const reason = errorMessage(error);
      await this.repository.failSourceAssetDeletion({ auditId: request.auditId, error: reason }).catch((recordError) => {
        logger.warn({ err: recordError, auditId: request.auditId }, 'work_instruction_source_asset_deletion_failure_record_failed');
      });
      return { assetId: request.assetId, auditId: request.auditId, status: 'FAILED', error: reason };
    }
  }

  /** Deletes every currently referenced image in one source version independently. */
  async deleteSourceVersionImages(input: { sourceVersionId: string; requestedBy: string }): Promise<ReadonlyArray<WorkInstructionSourceAssetDeletionResult>> {
    const version = await this.repository.findSourceVersionForDeletion(input.sourceVersionId);
    if (!version) {
      throw new WorkInstructionEditingError(404, '原本版が見つかりません', 'WORK_INSTRUCTION_SOURCE_VERSION_NOT_FOUND');
    }
    const assetIds = [...new Set(version.steps.map((step) => step.imageAssetId).filter((assetId): assetId is string => Boolean(assetId)))];
    const results: WorkInstructionSourceAssetDeletionResult[] = [];
    for (const assetId of assetIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        results.push(await this.deleteSourceAsset({ ...input, assetId }));
      } catch (error) {
        results.push({ assetId, auditId: null, status: 'SKIPPED', error: errorMessage(error) });
      }
    }
    return results;
  }
}
