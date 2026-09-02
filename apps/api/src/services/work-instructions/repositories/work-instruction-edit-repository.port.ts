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

export type WorkInstructionEditorAuthorization = {
  /** Authentication id issued by POST /work-instructions/editor-authentications. */
  authenticationId?: string | null;
  /** Registered ClientDevice.id resolved from x-client-key. */
  clientDeviceId?: string | null;
  /** Fastify request id used to correlate one HTTP operation. */
  requestId?: string | null;
};

/** Authorization required when completing a source-image deletion. */
export type RequiredWorkInstructionEditorAuthorization = {
  authenticationId: string;
  clientDeviceId: string;
  requestId?: string | null;
};

export type WorkInstructionEditorAuthenticationView = {
  id: string;
  employeeId: string;
  employeeCodeSnapshot: string;
  employeeNameSnapshot: string;
  clientDeviceId: string;
  clientDeviceNameSnapshot: string;
  partNumber: string;
  shootingTarget: string;
  authenticatedAt: Date;
  expiresAt: Date;
};

export type WorkInstructionEditAuditAction =
  | 'DRAFT_CREATED'
  | 'SAVED'
  | 'PUBLISHED'
  | 'DISCARDED'
  | 'ASSET_UPLOADED'
  | 'REGION_CREATED'
  | 'SOURCE_IMAGE_DELETED';

export type WorkInstructionEditAuditLogView = {
  id: string;
  authenticationId: string;
  action: WorkInstructionEditAuditAction;
  employeeIdSnapshot: string;
  employeeCodeSnapshot: string;
  employeeNameSnapshot: string;
  clientDeviceIdSnapshot: string;
  clientDeviceNameSnapshot: string;
  partNumber: string;
  shootingTarget: string;
  rowId: string | null;
  sourceVersionId: string | null;
  revisionId: string | null;
  editVersionBefore: number | null;
  editVersionAfter: number | null;
  requestId: string;
  changeSet: unknown;
  createdAt: Date;
};

export type WorkInstructionPublishRevisionInput = {
  revisionId: string;
  expectedEditVersion: number;
  expectedSourceVersionId?: string;
  expectedContentHash?: string;
  confirmUnassigned?: boolean;
  editorAuthenticationId?: string | null;
  clientDeviceId?: string | null;
  requestId?: string | null;
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
  createEditorAuthentication(input: {
    partNumber: string;
    shootingTarget: string;
    employeeTagUid: string;
    clientDeviceId: string;
    now?: Date;
  }): Promise<WorkInstructionEditorAuthenticationView>;
  validateEditorAuthentication(input: WorkInstructionEditorAuthorization & {
    expectedGroup?: WorkInstructionGroupIdentity;
    revisionId?: string;
    sourceVersionId?: string;
  }): Promise<WorkInstructionEditorAuthenticationView>;
  listEditAuditLogs(input: {
    partNumber: string;
    shootingTarget: string;
    limit?: number;
    offset?: number;
  }): Promise<ReadonlyArray<WorkInstructionEditAuditLogView>>;
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
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }>;
  createDraftRevisionGroup(inputs: ReadonlyArray<{
    rowId: string;
    sourceVersionId?: string;
    copyFromRevisionId?: string;
    expectedPublishedVersionId?: string;
    expectedLatestVersionId?: string;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }>, expectedGroup?: WorkInstructionGroupIdentity, authorization?: WorkInstructionEditorAuthorization): Promise<ReadonlyArray<{ revision: WorkInstructionEditRevisionView; copy: WorkInstructionCopyResult }>>;
  saveOverlays(input: {
    revisionId: string;
    expectedEditVersion: number;
    expectedSourceVersionId: string;
    expectedContentHash: string;
    elements: ReadonlyArray<WorkInstructionOverlayElementInput>;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<WorkInstructionEditRevisionView>;
  /** Canonical atomic draft write. Omitted memoOverrides means preserve memos. */
  saveDraft(input: {
    revisionId: string;
    expectedEditVersion: number;
    expectedSourceVersionId: string;
    expectedContentHash: string;
    elements: ReadonlyArray<WorkInstructionOverlayElementInput>;
    memoOverrides: ReadonlyArray<WorkInstructionMemoOverrideInput>;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
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
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<WorkInstructionEditRevisionView>;
  publishRevision(input: WorkInstructionPublishRevisionInput): Promise<WorkInstructionPublishRevisionResult>;
  /** Publishes all supplied row revisions atomically, locking rows in a stable order. */
  publishRevisionGroup(inputs: ReadonlyArray<WorkInstructionPublishRevisionInput>, expectedGroup?: WorkInstructionGroupIdentity, authorization?: WorkInstructionEditorAuthorization): Promise<ReadonlyArray<WorkInstructionPublishRevisionResult>>;
  discardRevision(input: {
    revisionId: string;
    expectedEditVersion?: number;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<WorkInstructionEditRevisionView>;
  stageEditAsset(input: {
    revisionId: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    origin?: WorkInstructionEditAssetOriginInput;
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
  }): Promise<WorkInstructionEditAssetView>;
  activateEditAsset(input: { assetId: string; revisionId: string; action?: WorkInstructionEditAuditAction; authorization?: WorkInstructionEditorAuthorization }): Promise<WorkInstructionEditAssetView>;
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
    editorAuthenticationId?: string | null;
    clientDeviceId?: string | null;
    requestId?: string | null;
  }): Promise<{
    auditId: string;
    assetId: string;
    storageKey: string;
    sha256: string;
    status: 'REQUESTED' | 'DELETED' | 'FAILED';
  }>;
  completeSourceAssetDeletion(input: {
    auditId: string;
    assetId: string;
    authorization: RequiredWorkInstructionEditorAuthorization;
  }): Promise<void>;
  failSourceAssetDeletion(input: { auditId: string; error: string }): Promise<void>;
};
