import type {
  WorkInstructionApplyResult,
  WorkInstructionAssetInput,
  WorkInstructionAssetView,
  WorkInstructionCleanupCandidate,
  WorkInstructionGroupSummaryView,
  WorkInstructionGroupView,
  WorkInstructionImportMessageView,
  WorkInstructionImportOutcome,
  WorkInstructionPartCandidatePageView,
  WorkInstructionPartAliasView,
  WorkInstructionPacket,
  WorkInstructionRowView,
  WorkInstructionStagedAsset
} from '../domain/types.js';

export type StageWorkInstructionAssetsInput = {
  assets: ReadonlyArray<WorkInstructionAssetInput>;
  now?: Date;
};

export type ApplyWorkInstructionPacketInput = {
  packet: WorkInstructionPacket;
  stagedAssets: ReadonlyArray<WorkInstructionStagedAsset>;
  now?: Date;
};

export type CleanupWorkInstructionAssetsInput = {
  now: Date;
  limit: number;
  /** Assets held by a currently running ingest are never cleanup candidates. */
  activeAssetIds?: ReadonlyArray<string>;
};

export type WorkInstructionRowsQuery = {
  partNumber?: string;
  shootingTarget?: string;
  includeUnclassified?: boolean;
  limit: number;
  offset: number;
};

export type WorkInstructionGroupsQuery = {
  partNumber?: string;
  shootingTarget?: string;
  limit: number;
  offset: number;
};

export type WorkInstructionPartCandidatesQuery = {
  prefix: string;
  fallback: boolean;
  limit: number;
  offset: number;
};

export type UpsertWorkInstructionPartAliasInput = {
  scannedPartNumber: string;
  canonicalPartNumber: string;
  lastSelectedClientDeviceId?: string | null;
  now?: Date;
};

export type WorkInstructionImportMessagesQuery = {
  limit: number;
  offset: number;
  gmailMessageIds?: ReadonlyArray<string>;
  outcome?: WorkInstructionImportOutcome;
  /** Select retry/recovery/ack-cleanup work due by this instant. Due results are oldest-first. */
  retryDueAt?: Date;
  mailCleanupPending?: boolean;
};

export type RecordWorkInstructionImportMessageInput = {
  gmailMessageId: string;
  outcome: WorkInstructionImportOutcome;
  error?: string | null;
  nextRetryAt?: Date | null;
  mailCleanupPending?: boolean;
  /** Optimistic state guard for concurrent retry/failure callbacks. */
  expectedOutcome?: WorkInstructionImportOutcome | null;
};

export type DeleteWorkInstructionAssetsInput = {
  assetIds: ReadonlyArray<string>;
};

/** Persistence boundary for the independent work-instruction domain. */
export interface WorkInstructionRepository {
  /** Insert immutable asset metadata before the filesystem write is published. */
  stageAssets(input: StageWorkInstructionAssetsInput): Promise<ReadonlyArray<WorkInstructionStagedAsset>>;

  /**
   * Apply one complete SharePoint row snapshot. The implementation obtains the
   * source identity transaction lock and publishes all step/asset pointers in
   * one database transaction.
   */
  applyPacket(input: ApplyWorkInstructionPacketInput): Promise<WorkInstructionApplyResult>;

  /**
   * Atomically claims only unreferenced eligible assets. A caller must delete
   * the returned immutable files before invoking deleteAssetRecords. Claiming
   * in the same short transaction as the eligibility check prevents an apply
   * transaction from publishing an asset while cleanup is deleting it.
   */
  claimCleanupCandidates(input: CleanupWorkInstructionAssetsInput): Promise<ReadonlyArray<WorkInstructionCleanupCandidate>>;
  deleteAssetRecords(input: DeleteWorkInstructionAssetsInput): Promise<number>;
  /** Records a durable-file deletion failure so the pending asset is retried. */
  recordAssetDeletionFailure?(input: { assetIds: ReadonlyArray<string>; error: string }): Promise<void>;

  readGroup(input: { partNumber: string; shootingTarget: string }): Promise<WorkInstructionGroupView | null>;
  /** Public kiosk projection; falls back to readGroup before version backfill. */
  readPublishedGroup?(input: { partNumber: string; shootingTarget: string }): Promise<WorkInstructionGroupView | null>;
  readGroups(input: WorkInstructionGroupsQuery): Promise<ReadonlyArray<WorkInstructionGroupSummaryView>>;
  /** Public kiosk group summaries; falls back to latest summaries before backfill. */
  readPublishedGroups?(input: WorkInstructionGroupsQuery): Promise<ReadonlyArray<WorkInstructionGroupSummaryView>>;
  readPublishedPartCandidates(input: WorkInstructionPartCandidatesQuery): Promise<WorkInstructionPartCandidatePageView>;
  readPublishedPartAlias(scannedPartNumber: string): Promise<WorkInstructionPartAliasView | null>;
  upsertPartAlias(input: UpsertWorkInstructionPartAliasInput): Promise<WorkInstructionPartAliasView>;
  readRows(input: WorkInstructionRowsQuery): Promise<ReadonlyArray<WorkInstructionRowView>>;
  readAsset(assetId: string): Promise<WorkInstructionAssetView | null>;

  /**
   * Upsert an email-level result. Terminal outcomes are monotonic; callers
   * performing a concurrent transition should provide expectedOutcome so an
   * old failure cannot downgrade a successful application.
   */
  recordImportMessage(input: RecordWorkInstructionImportMessageInput): Promise<WorkInstructionImportMessageView>;
  readImportMessage(gmailMessageId: string): Promise<WorkInstructionImportMessageView | null>;
  readImportMessages(input: WorkInstructionImportMessagesQuery): Promise<ReadonlyArray<WorkInstructionImportMessageView>>;
}
