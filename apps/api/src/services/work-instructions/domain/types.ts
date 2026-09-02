import type { WorkInstructionMemoMigrationState, WorkInstructionOverlayElement } from './editing.js';

/** JSON values accepted by the SharePoint manifest boundary. */
export type WorkInstructionJsonValue =
  | string
  | number
  | boolean
  | null
  | WorkInstructionJsonValue[]
  | { [key: string]: WorkInstructionJsonValue };

export type WorkInstructionSourceIdentity = {
  system: string;
  list: string;
  itemId: number;
};

export type WorkInstructionSource = WorkInstructionSourceIdentity & {
  modified: Date;
};

export type WorkInstructionStepInput = {
  step: number;
  text: string;
  imageName: string | null;
  /** The image digest is supplied by the attachment adapter, not the manifest. */
  imageHash?: string | null;
  /** Filled by the repository after the corresponding asset is staged. */
  imageAssetId?: string | null;
};

export type WorkInstructionPacket = {
  source: WorkInstructionSource;
  partNumber: string | null;
  shootingTarget: string | null;
  rawManifest: WorkInstructionJsonValue;
  steps: ReadonlyArray<WorkInstructionStepInput>;
  /** SHA-256 over the canonical manifest and referenced image digests. */
  contentHash: string;
};

export const WORK_INSTRUCTION_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp'
] as const;

export type WorkInstructionImageMimeType = (typeof WORK_INSTRUCTION_IMAGE_MIME_TYPES)[number];

export type WorkInstructionAssetInput = {
  assetId: string;
  imageName: string;
  storageKey: string;
  mimeType: WorkInstructionImageMimeType;
  sizeBytes: number;
  sha256: string;
};

export type WorkInstructionAssetStatus = 'STAGED' | 'ACTIVE' | 'DELETE_PENDING';

export type WorkInstructionStagedAsset = WorkInstructionAssetInput & {
  status: 'STAGED';
  createdAt: Date;
};

export type WorkInstructionApplyOutcome = 'APPLIED' | 'DUPLICATE' | 'STALE' | 'CONFLICT';

export type WorkInstructionApplyResult = {
  outcome: WorkInstructionApplyOutcome;
  rowId: string | null;
  sourceVersionId?: string;
  publishedVersionId?: string;
  displacedAssetIds: ReadonlyArray<string>;
};

export type WorkInstructionCleanupCandidate = {
  assetId: string;
  storageKey: string;
  status: WorkInstructionAssetStatus;
  createdAt: Date;
  deletePendingAt: Date | null;
};

export type WorkInstructionStepView = {
  id: string;
  step: number;
  text: string;
  imageName: string | null;
  imageAssetId: string | null;
  imageStorageKey: string | null;
  imageMimeType: WorkInstructionImageMimeType | null;
  imageSha256: string | null;
  /** Revision-owned memo override; undefined means use immutable source text. */
  memoOverride?: string;
  memoMigrationState?: WorkInstructionMemoMigrationState;
  overlays?: ReadonlyArray<WorkInstructionOverlayElement>;
  overlayAssets?: Readonly<Record<string, WorkInstructionOverlayAssetView>>;
};

/** Public metadata for editor-created IMAGE overlays; storage keys stay private. */
export type WorkInstructionOverlayAssetView = {
  assetId: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  url: string;
};

export type WorkInstructionRowView = {
  id: string;
  source: WorkInstructionSource;
  partNumber: string | null;
  shootingTarget: string | null;
  contentHash: string;
  rawManifest: WorkInstructionJsonValue;
  steps: ReadonlyArray<WorkInstructionStepView>;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkInstructionGroupedStepView = WorkInstructionStepView & {
  rowId: string;
  source: WorkInstructionSourceIdentity;
};

export type WorkInstructionGroupView = {
  partNumber: string;
  shootingTarget: string;
  rows: ReadonlyArray<WorkInstructionRowView>;
  steps: ReadonlyArray<WorkInstructionGroupedStepView>;
  /** True when at least one row has a newer imported version than its public pointer. */
  updateAvailable?: boolean;
};

export type WorkInstructionGroupSummaryView = {
  partNumber: string;
  shootingTarget: string;
  rowCount: number;
  stepCount: number;
  latestModified: Date;
};

export type WorkInstructionPartCandidateView = {
  partNumber: string;
  partName: string | null;
  shootingTargets: ReadonlyArray<string>;
};

export type WorkInstructionPartCandidatePageView = {
  matchedPrefix: string | null;
  candidates: ReadonlyArray<WorkInstructionPartCandidateView>;
  hasMore: boolean;
};

export type WorkInstructionPartAliasView = {
  scannedPartNumber: string;
  canonicalPartNumber: string;
  partName: string | null;
  shootingTargets: ReadonlyArray<string>;
  selectionCount: number;
  createdAt: Date;
  lastSelectedAt: Date;
};

export type WorkInstructionPartAliasValidationReason = 'EXACT_EXISTS' | 'TARGET_NOT_FOUND';

/** Validation failure raised when a learned part alias cannot be persisted safely. */
export class WorkInstructionPartAliasValidationError extends Error {
  constructor(public readonly reason: WorkInstructionPartAliasValidationReason) {
    super(reason === 'EXACT_EXISTS'
      ? 'the scanned part number already has a public work instruction'
      : 'the canonical part number has no public work instruction');
    this.name = 'WorkInstructionPartAliasValidationError';
  }
}

export type WorkInstructionAssetView = {
  assetId: string;
  storageKey: string;
  mimeType: WorkInstructionImageMimeType;
  sizeBytes: number;
  sha256: string;
  status: WorkInstructionAssetStatus;
  createdAt: Date;
  activatedAt: Date | null;
  deletePendingAt: Date | null;
};

export type WorkInstructionImportOutcome =
  | 'PENDING'
  | 'PROCESSING'
  | 'APPLIED'
  | 'DUPLICATE'
  | 'STALE'
  | 'CONFLICT'
  | 'INVALID'
  | 'RETRYABLE';

export type WorkInstructionImportMessageView = {
  id: string;
  gmailMessageId: string;
  outcome: WorkInstructionImportOutcome;
  error: string | null;
  nextRetryAt: Date | null;
  mailCleanupPending: boolean;
  createdAt: Date;
  updatedAt: Date;
};
