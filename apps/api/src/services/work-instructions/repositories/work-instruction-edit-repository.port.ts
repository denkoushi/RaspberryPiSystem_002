import type {
  WorkInstructionCopyResult,
  WorkInstructionEditAssetView,
  WorkInstructionEditRevisionView,
  WorkInstructionEditAssetOriginInput,
  WorkInstructionEditRevisionContext,
  WorkInstructionEditingView,
  WorkInstructionMemoOverrideInput,
  WorkInstructionOverlayElementInput,
  WorkInstructionSourceVersionView
} from '../domain/editing.js';

export type WorkInstructionPublishRevisionInput = {
  revisionId: string;
  expectedEditVersion: number;
  expectedSourceVersionId?: string;
  expectedContentHash?: string;
  confirmUnassigned?: boolean;
};

export type WorkInstructionPublishRevisionResult = {
  revision: WorkInstructionEditRevisionView;
  migration: {
    needsReviewCount: number;
    unassignedCount: number;
    skippedCount: number;
    memo?: {
      needsReviewCount: number;
      unassignedCount: number;
      skippedCount: number;
    };
  };
};

export type WorkInstructionEditAssetCleanupCandidate = {
  assetId: string;
  storageKey: string;
  createdAt: Date;
  deletePendingAt: Date | null;
};

export type WorkInstructionGroupIdentity = {
  partNumber: string;
  shootingTarget: string;
};

export type WorkInstructionEditRepository = {
  readEditingView(rowId: string): Promise<WorkInstructionEditingView | null>;
  readRevisionContext(revisionId: string): Promise<WorkInstructionEditRevisionContext | null>;
  listSourceVersions(rowId: string): Promise<ReadonlyArray<WorkInstructionSourceVersionView>>;
  findSourceVersionForDeletion(sourceVersionId: string): Promise<WorkInstructionSourceVersionView | null>;
  readRevisionSourceImage(revisionId: string, step: number): Promise<{ assetId: string; storageKey: string; mimeType: string; sourceVersionId: string; sourceStep: number } | null>;
  createDraftRevision(input: {
    rowId: string;
    sourceVersionId?: string;
    copyFromRevisionId?: string;
    expectedPublishedVersionId?: string;
    expectedLatestVersionId?: string;
  }): Promise<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }>;
  createDraftRevisionGroup(inputs: ReadonlyArray<{
    rowId: string;
    sourceVersionId?: string;
    copyFromRevisionId?: string;
    expectedPublishedVersionId?: string;
    expectedLatestVersionId?: string;
  }>, expectedGroup?: WorkInstructionGroupIdentity): Promise<ReadonlyArray<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }>>;
  saveOverlays(input: {
    revisionId: string;
    expectedEditVersion: number;
    expectedSourceVersionId: string;
    expectedContentHash: string;
    elements: ReadonlyArray<WorkInstructionOverlayElementInput>;
  }): Promise<WorkInstructionEditRevisionView>;
  /** Canonical atomic draft write. Omitted memoOverrides means preserve memos. */
  saveDraft(input: {
    revisionId: string;
    expectedEditVersion: number;
    expectedSourceVersionId: string;
    expectedContentHash: string;
    elements: ReadonlyArray<WorkInstructionOverlayElementInput>;
    memoOverrides: ReadonlyArray<WorkInstructionMemoOverrideInput>;
  }): Promise<WorkInstructionEditRevisionView>;
  /** Applies best-effort ROI rebase results as one optimistic revision update. */
  applyRoiRebase(input: {
    revisionId: string;
    expectedEditVersion: number;
    updates: ReadonlyArray<{
      overlayId: string;
      editAssetId?: string;
      sourceStep: number | null;
      migrationState: 'MIGRATED' | 'NEEDS_REVIEW' | 'UNASSIGNED' | 'SKIPPED';
      targetStepFingerprint?: string | null;
    }>;
  }): Promise<WorkInstructionEditRevisionView>;
  publishRevision(input: WorkInstructionPublishRevisionInput): Promise<WorkInstructionPublishRevisionResult>;
  /** Publishes all supplied row revisions atomically, locking rows in a stable order. */
  publishRevisionGroup(inputs: ReadonlyArray<WorkInstructionPublishRevisionInput>, expectedGroup?: WorkInstructionGroupIdentity): Promise<ReadonlyArray<WorkInstructionPublishRevisionResult>>;
  discardRevision(input: {
    revisionId: string;
    expectedEditVersion?: number;
  }): Promise<WorkInstructionEditRevisionView>;
  stageEditAsset(input: {
    revisionId: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    origin?: WorkInstructionEditAssetOriginInput;
  }): Promise<WorkInstructionEditAssetView>;
  activateEditAsset(input: { assetId: string; revisionId: string }): Promise<WorkInstructionEditAssetView>;
  /** Releases an uploaded asset that could not be attached to an overlay. */
  releaseEditAsset(input: { assetId: string; revisionId: string }): Promise<WorkInstructionEditAssetView | null>;
  markEditAssetDeletePending(input: { assetId: string; revisionId: string }): Promise<void>;
  readEditAsset(assetId: string): Promise<WorkInstructionEditAssetView | null>;
  claimEditAssetCleanupCandidates(input: { now: Date; limit: number }): Promise<ReadonlyArray<WorkInstructionEditAssetCleanupCandidate>>;
  deleteEditAssetRecord(input: { assetId: string }): Promise<boolean>;
  recordEditAssetDeletionFailure(input: { assetId: string; error: string }): Promise<void>;
  requestSourceAssetDeletion(input: {
    sourceVersionId: string;
    assetId: string;
    requestedBy: string;
  }): Promise<{
    auditId: string;
    assetId: string;
    storageKey: string;
    sha256: string;
    status: 'REQUESTED' | 'DELETED' | 'FAILED';
  }>;
  completeSourceAssetDeletion(input: { auditId: string; assetId: string }): Promise<void>;
  failSourceAssetDeletion(input: { auditId: string; error: string }): Promise<void>;
};
