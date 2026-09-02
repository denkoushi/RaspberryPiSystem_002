import { api } from '../http';

import type {
  WorkInstructionImageMimeType,
  WorkInstructionOverlayElement
} from './work-instructions';
import type { OverlayBBox } from '@raspi-system/shared-types';

/**
 * Assets created while editing a WorkInstruction. Source assets are separate.
 *
 * The editor group projection already uses the compact `assetId` /
 * `contentType` / `byteSize` / `url` shape, while the ROI and upload routes
 * expose the canonical persisted asset view (`id` / `mimeType` / `sizeBytes`
 * / `imageUrl`). The client normalizes both shapes before returning an asset
 * to the editor controller; the canonical fields remain here so a response
 * can be represented without losing provenance or lifecycle information.
 */
export type WorkInstructionEditAssetDto = {
  assetId: string;
  id?: string;
  storageKey?: string;
  contentType?: WorkInstructionImageMimeType | string;
  byteSize?: number;
  sha256?: string;
  url?: string;
  relativeUrl?: string;
  mimeType?: WorkInstructionImageMimeType | string;
  sizeBytes?: number;
  imageUrl?: string;
  status?: 'STAGED' | 'ACTIVE' | 'DELETE_PENDING' | string;
  origin?: 'UPLOAD' | 'ROI' | string;
  originSourceVersionId?: string | null;
  originSourceStep?: number | null;
  originBbox?: OverlayBBox | null;
  ownerRevisionId?: string | null;
  createdAt?: string;
  activatedAt?: string | null;
  deletePendingAt?: string | null;
};

type WorkInstructionEditAssetResponseDto = Partial<WorkInstructionEditAssetDto> & {
  id?: string;
  mimeType?: WorkInstructionImageMimeType | string;
  sizeBytes?: number;
  imageUrl?: string | null;
};

function normalizeEditAsset(asset: WorkInstructionEditAssetResponseDto): WorkInstructionEditAssetDto {
  const assetId = asset.assetId ?? asset.id;
  if (!assetId) throw new Error('編集画像asset IDがレスポンスにありません。');
  return {
    ...asset,
    assetId,
    storageKey: asset.storageKey ?? assetId,
    contentType: asset.contentType ?? asset.mimeType,
    byteSize: asset.byteSize ?? asset.sizeBytes,
    url: asset.url ?? asset.imageUrl ?? undefined
  };
}

export type WorkInstructionTextCandidateDto = {
  text: string;
  confidence: number | null;
  bounds: OverlayBBox | null;
  pageIndex: number | null;
  stepKey?: string | null;
  source: string;
};

export type WorkInstructionMigrationState = 'migrated' | 'needs_review' | 'unassigned' | 'skipped';

export type WorkInstructionMemoMigrationState =
  | 'MIGRATED'
  | 'NEEDS_REVIEW'
  | 'UNASSIGNED'
  | 'SKIPPED'
  | 'migrated'
  | 'needs_review'
  | 'unassigned'
  | 'skipped';

export type WorkInstructionMemoOverrideAction =
  | 'AUTO'
  | 'KEEP'
  | 'USE_SOURCE'
  | 'auto'
  | 'keep'
  | 'use-source';

/** Revision-owned memo override. An empty memo is a valid override value. */
export type WorkInstructionMemoOverrideDto = {
  /** Stable persisted identity used to keep assigned and unassigned lineages distinct. */
  id?: string;
  stepKey: string | null;
  /** Canonical API/DB text field; an empty string is still an active override. */
  text: string;
  /** Accepted only when reading older client-shaped responses. Requests use text. */
  memo?: string;
  sourceStep?: number | null;
  migratedFromStep?: number | null;
  migratedFromStepKey?: string | null;
  baseStepFingerprint?: string | null;
  targetStepFingerprint?: string | null;
  expectedTargetStepFingerprint?: string | null;
  migrationState?: WorkInstructionMemoMigrationState;
  action?: WorkInstructionMemoOverrideAction;
};

export type WorkInstructionEditorStepDto = {
  /** Stable source tuple + step key. Never use the transient import UUID for migration. */
  stepKey: string;
  sourceVersionId: string;
  sourceSystem: string;
  sourceList: string;
  sourceItemId: number;
  step: number;
  text: string;
  /** Original source text remains available while effective memo is derived. */
  memo?: string | null;
  effectiveMemo?: string | null;
  memoOverride?: string | null;
  memoMigrationState?: WorkInstructionMemoMigrationState;
  /** Optional server-computed memo fingerprint used when resolving an orphan. */
  memoFingerprint?: string | null;
  imageName: string | null;
  imageAssetId: string | null;
  imageUrl: string | null;
  imageMimeType: WorkInstructionImageMimeType | null;
  imageSha256: string | null;
  imageDeletedAt?: string | null;
  imageDeletedBy?: string | null;
  sourceModified: string;
  contentHash: string;
  overlays: WorkInstructionOverlayElement[];
  migrationState?: WorkInstructionMigrationState;
  migratedFromStepKey?: string | null;
};

export type WorkInstructionSourceVersionDto = {
  id: string;
  revisionNumber: number;
  sourceModified: string;
  contentHash: string;
  status: 'latest' | 'published' | 'archived' | 'deleted' | string;
  steps: WorkInstructionEditorStepDto[];
  /** All image assets owned by this source version; a version delete is bulk. */
  images?: WorkInstructionSourceImageDto[];
  /** Revision-owned overlay assets projected for version comparison. */
  assets?: Record<string, WorkInstructionEditAssetDto>;
};

export type WorkInstructionSourceImageDto = {
  assetId: string | null;
  imageName: string | null;
  imageUrl: string | null;
  imageMimeType: WorkInstructionImageMimeType | null;
  imageSha256: string | null;
  deletedAt?: string | null;
  deletedBy?: string | null;
  canDeleteImage?: boolean;
};

export type WorkInstructionEditRevisionDto = {
  id: string;
  sourceVersionId: string;
  status: 'draft' | 'published' | 'archived' | string;
  revisionNumber: number;
  editVersion: number;
  sourceModified: string;
  contentHash?: string;
  steps: WorkInstructionEditorStepDto[];
  overlays?: WorkInstructionOverlayElement[];
  baseContentHash?: string;
  assets?: Record<string, WorkInstructionEditAssetDto>;
  memoOverrides?: WorkInstructionMemoOverrideDto[];
  migration?: WorkInstructionMigrationSummaryDto;
  createdAt?: string;
  updatedAt?: string;
};

/** Save routes may return the persisted revision without its derived steps. */
type WorkInstructionEditRevisionResponseDto = Omit<WorkInstructionEditRevisionDto, 'steps' | 'assets'> & {
  steps?: WorkInstructionEditorStepDto[];
  assets?: Record<string, WorkInstructionEditAssetResponseDto>;
  memoOverrides?: WorkInstructionMemoOverrideResponseDto[] | Record<string, Omit<WorkInstructionMemoOverrideResponseDto, 'stepKey'>>;
};

type WorkInstructionMemoOverrideResponseDto = Omit<WorkInstructionMemoOverrideDto, 'stepKey' | 'text' | 'memo'> & {
  stepKey?: string | null;
  text?: string;
  memo?: string;
};

function normalizeMemoOverrides(
  overrides: WorkInstructionEditRevisionResponseDto['memoOverrides']
): WorkInstructionMemoOverrideDto[] {
  const normalize = (override: WorkInstructionMemoOverrideResponseDto, fallbackStepKey = '') => {
    const { stepKey, text, memo, ...metadata } = override;
    return {
      ...metadata,
      stepKey: stepKey ?? (fallbackStepKey || null),
      text: typeof text === 'string' ? text : typeof memo === 'string' ? memo : ''
    };
  };
  if (Array.isArray(overrides)) return overrides.map((override) => normalize(override));
  if (!overrides || typeof overrides !== 'object') return [];
  const record = overrides as Record<string, WorkInstructionMemoOverrideResponseDto>;
  return Object.entries(record).map(([stepKey, override]) => normalize(override, stepKey));
}

function normalizeEditRevision(revision: WorkInstructionEditRevisionResponseDto): WorkInstructionEditRevisionDto {
  return {
    ...revision,
    steps: revision.steps ?? [],
    ...(revision.memoOverrides === undefined ? {} : { memoOverrides: normalizeMemoOverrides(revision.memoOverrides) }),
    assets: Object.fromEntries(Object.entries(revision.assets ?? {}).map(([assetId, asset]) => [
      assetId,
      normalizeEditAsset({ ...asset, assetId: asset.assetId ?? asset.id ?? assetId })
    ]))
  };
}

export type WorkInstructionMemoMigrationSummaryDto = {
  total: number;
  migrated: number;
  needsReview: number;
  unassigned: number;
  skipped: number;
};

export type WorkInstructionMigrationSummaryDto = WorkInstructionMemoMigrationSummaryDto & {
  /** Memo migration is reported separately from overlay migration by the API. */
  memo: WorkInstructionMemoMigrationSummaryDto;
};

export type WorkInstructionEditorGroupDto = {
  partNumber: string;
  shootingTarget: string;
  rows: WorkInstructionEditorRowDto[];
  migration: WorkInstructionMigrationSummaryDto;
  history?: WorkInstructionRevisionHistoryItemDto[];
};

/** One source tuple in the read-time group. A group may contain many rows. */
export type WorkInstructionEditorRowDto = {
  rowId: string;
  source: {
    system: string;
    list: string;
    itemId: number;
    modified?: string | null;
  };
  published: WorkInstructionSourceVersionDto;
  latest: WorkInstructionSourceVersionDto;
  draft: WorkInstructionEditRevisionDto | null;
  updateAvailable: boolean;
  migration?: WorkInstructionMigrationSummaryDto;
  history?: WorkInstructionRevisionHistoryItemDto[];
};

export type WorkInstructionRevisionHistoryItemDto = {
  id: string;
  rowId?: string;
  sourceVersionId: string;
  revisionNumber: number;
  sourceModified: string;
  contentHash: string;
  status: 'latest' | 'published' | 'archived' | 'deleted' | string;
  isLatest: boolean;
  isPublished: boolean;
  publishedRevisionId?: string | null;
  annotationRevisionId?: string | null;
  imageCount: number;
  deletedImageCount: number;
  eligibleImageCount: number;
  canDeleteImage: boolean;
  imageDeletedAt?: string | null;
  imageDeletedBy?: string | null;
  images: WorkInstructionSourceImageDto[];
};

export type WorkInstructionEditorGroupQuery = {
  partNumber: string;
  shootingTarget: string;
};

export type WorkInstructionEditorAuthenticationDto = {
  id: string;
  employee: {
    id: string;
    employeeCode: string;
    displayName: string;
  };
  authenticatedAt: string;
  expiresAt: string;
};

/** Append-only editor audit item returned by the NFC-bound audit endpoint. */
export type WorkInstructionEditorAuditItemDto = {
  id: string;
  action: string;
  employeeIdSnapshot?: string | null;
  employeeCodeSnapshot?: string | null;
  employeeNameSnapshot?: string | null;
  clientDeviceIdSnapshot?: string | null;
  clientDeviceNameSnapshot?: string | null;
  partNumber?: string;
  shootingTarget?: string;
  rowId?: string | null;
  sourceVersionId?: string | null;
  revisionId?: string | null;
  editVersionBefore?: number | null;
  editVersionAfter?: number | null;
  requestId?: string | null;
  changeSet?: unknown;
  createdAt: string;
};

const WORK_INSTRUCTION_BASE = '/work-instructions';

const editorAuthenticationHeaders = (authenticationId: string) => ({
  'x-work-instruction-editor-authentication-id': authenticationId
});

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function groupParams(input: WorkInstructionEditorGroupQuery) {
  return {
    partNumber: input.partNumber,
    resource: input.shootingTarget
  };
}

export async function getWorkInstructionEditorGroup(
  input: WorkInstructionEditorGroupQuery
): Promise<WorkInstructionEditorGroupDto> {
  const { data } = await api.get<WorkInstructionEditorGroupDto>(
    `${WORK_INSTRUCTION_BASE}/editor-group`,
    { params: groupParams(input) }
  );
  return data;
}

export async function createWorkInstructionEditorAuthentication(input: {
  partNumber: string;
  shootingTarget: string;
  employeeTagUid: string;
}): Promise<WorkInstructionEditorAuthenticationDto> {
  const { data } = await api.post<{ authentication: WorkInstructionEditorAuthenticationDto }>(
    `${WORK_INSTRUCTION_BASE}/editor-authentications`,
    input
  );
  return data.authentication;
}

/** Creates or returns the idempotent DRAFT and applies the initial bulk migration. */
export async function copyWorkInstructionOverlayDraft(input: {
  partNumber: string;
  shootingTarget: string;
  rows: Array<{
    rowId: string;
    publishedSourceVersionId: string;
    latestSourceVersionId: string;
  }>;
  authenticationId: string;
}) {
  const { authenticationId, ...body } = input;
  const { data } = await api.post<{
    group?: WorkInstructionEditorGroupDto;
    rows?: WorkInstructionEditorRowDto[];
    partNumber?: string;
    shootingTarget?: string;
    migration?: WorkInstructionMigrationSummaryDto;
    history?: WorkInstructionRevisionHistoryItemDto[];
    revisions?: WorkInstructionEditRevisionDto[];
    revision?: WorkInstructionEditRevisionDto;
  }>(
    `${WORK_INSTRUCTION_BASE}/editor-revisions/copy`,
    body,
    { headers: editorAuthenticationHeaders(authenticationId) }
  );
  const inlineGroup = Array.isArray(data.rows) && typeof data.partNumber === 'string' && typeof data.shootingTarget === 'string'
    ? {
        partNumber: data.partNumber,
        shootingTarget: data.shootingTarget,
        rows: data.rows,
        migration: data.migration ?? {
          total: 0,
          migrated: 0,
          needsReview: 0,
          unassigned: 0,
          skipped: 0,
          memo: { total: 0, migrated: 0, needsReview: 0, unassigned: 0, skipped: 0 }
        },
        history: data.history
      }
    : undefined;
  return {
    group: data.group ?? inlineGroup,
    revisions: data.revisions ?? (data.revision ? [data.revision] : [])
  };
}

export async function saveWorkInstructionOverlayDraft(input: {
  revisionId: string;
  authenticationId: string;
  expectedEditVersion: number;
  expectedSourceVersionId: string;
  expectedContentHash: string;
  elements: WorkInstructionOverlayElement[];
  memoOverrides?: WorkInstructionMemoOverrideDto[];
}) {
  const { data } = await api.put<{ revision?: WorkInstructionEditRevisionResponseDto } & Partial<WorkInstructionEditRevisionResponseDto>>(
    `${WORK_INSTRUCTION_BASE}/editor-revisions/${encoded(input.revisionId)}/draft`,
    {
      expectedEditVersion: input.expectedEditVersion,
      expectedSourceVersionId: input.expectedSourceVersionId,
      expectedContentHash: input.expectedContentHash,
      elements: input.elements,
      memoOverrides: input.memoOverrides ?? []
    },
    { headers: editorAuthenticationHeaders(input.authenticationId) }
  );
  return normalizeEditRevision((data.revision ?? data) as WorkInstructionEditRevisionResponseDto);
}

export async function discardWorkInstructionOverlayDraft(input: {
  revisionId: string;
  authenticationId: string;
  expectedEditVersion?: number;
}) {
  const { authenticationId, revisionId, expectedEditVersion } = input;
  const { data } = await api.post<{ revision?: WorkInstructionEditRevisionDto | null } & Partial<WorkInstructionEditRevisionDto>>(
    `${WORK_INSTRUCTION_BASE}/editor-revisions/${encoded(revisionId)}/discard`,
    expectedEditVersion === undefined ? {} : { expectedEditVersion },
    { headers: editorAuthenticationHeaders(authenticationId) }
  );
  return (data.revision ?? ('id' in data ? data : null)) as WorkInstructionEditRevisionDto | null;
}

/** Publishes all source-row revisions in one group transaction. */
export async function publishWorkInstructionOverlayDraft(input: {
  partNumber: string;
  shootingTarget: string;
  revisionIds: string[];
  authenticationId: string;
  expectedEditVersions: Record<string, number>;
  confirmUnassigned?: boolean;
}) {
  const { authenticationId, ...body } = input;
  const { data } = await api.post<{ group?: WorkInstructionEditorGroupDto } & Partial<WorkInstructionEditorGroupDto>>(
    `${WORK_INSTRUCTION_BASE}/editor-revisions/publish`,
    body,
    { headers: editorAuthenticationHeaders(authenticationId) }
  );
  return data.group ?? data as WorkInstructionEditorGroupDto;
}

export async function createWorkInstructionImageRegion(input: {
  revisionId: string;
  stepKey: string;
  authenticationId: string;
  bbox: OverlayBBox;
}) {
  const { data } = await api.post<{ asset?: WorkInstructionEditAssetResponseDto } & WorkInstructionEditAssetResponseDto>(
    `${WORK_INSTRUCTION_BASE}/editor-revisions/${encoded(input.revisionId)}/regions/image`,
    {
      stepKey: input.stepKey,
      bbox: input.bbox
    },
    { headers: editorAuthenticationHeaders(input.authenticationId) }
  );
  return normalizeEditAsset(data.asset ?? data);
}

export async function findWorkInstructionTextCandidates(input: {
  revisionId: string;
  stepKey: string;
  authenticationId: string;
  bbox: OverlayBBox;
}) {
  const { data } = await api.post<{ candidates?: WorkInstructionTextCandidateDto[] } & Partial<WorkInstructionTextCandidateDto[]>>(
    `${WORK_INSTRUCTION_BASE}/editor-revisions/${encoded(input.revisionId)}/regions/text`,
    {
      stepKey: input.stepKey,
      bbox: input.bbox
    },
    { headers: editorAuthenticationHeaders(input.authenticationId) }
  );
  return data.candidates ?? (Array.isArray(data) ? data as unknown as WorkInstructionTextCandidateDto[] : []);
}

export async function uploadWorkInstructionOverlayImage(input: {
  revisionId: string;
  stepKey: string;
  authenticationId: string;
  file: File;
}) {
  const formData = new FormData();
  formData.append('stepKey', input.stepKey);
  formData.append('file', input.file);
  const { data } = await api.post<{ asset?: WorkInstructionEditAssetResponseDto } & WorkInstructionEditAssetResponseDto>(
    `${WORK_INSTRUCTION_BASE}/editor-revisions/${encoded(input.revisionId)}/assets`,
    formData,
    {
      headers: {
        'Content-Type': 'multipart/form-data',
        ...editorAuthenticationHeaders(input.authenticationId)
      }
    }
  );
  return normalizeEditAsset(data.asset ?? data);
}

export async function listWorkInstructionRevisionHistory(
  input: WorkInstructionEditorGroupQuery & { authenticationId: string }
): Promise<WorkInstructionRevisionHistoryItemDto[]> {
  const { data } = await api.get<{ history?: WorkInstructionRevisionHistoryItemDto[] } & Partial<WorkInstructionRevisionHistoryItemDto[]>>(
    `${WORK_INSTRUCTION_BASE}/editor-revisions/history`,
    { params: groupParams(input), headers: editorAuthenticationHeaders(input.authenticationId) }
  );
  return data.history ?? (Array.isArray(data) ? data as unknown as WorkInstructionRevisionHistoryItemDto[] : []);
}

export async function listWorkInstructionEditorAudit(input: WorkInstructionEditorGroupQuery & {
  authenticationId: string;
}): Promise<WorkInstructionEditorAuditItemDto[]> {
  const { data } = await api.get<{
    items?: WorkInstructionEditorAuditItemDto[];
  } & Partial<WorkInstructionEditorAuditItemDto[]>>(
    `${WORK_INSTRUCTION_BASE}/editor-audit`,
    {
      params: groupParams(input),
      headers: editorAuthenticationHeaders(input.authenticationId)
    }
  );
  return data.items ?? (Array.isArray(data) ? data as unknown as WorkInstructionEditorAuditItemDto[] : []);
}

export type WorkInstructionSourceAssetDeletionStatus = 'DELETED' | 'FAILED' | 'REQUESTED' | 'SKIPPED' | string;

export type WorkInstructionSourceAssetDeletionResultDto = {
  assetId: string;
  auditId: string | null;
  status: WorkInstructionSourceAssetDeletionStatus;
  error?: string;
};

export type WorkInstructionSourceVersionImageDeleteResponseDto = {
  results: WorkInstructionSourceAssetDeletionResultDto[];
  deletedCount: number;
  /** Kept for deployments that still expose the older alias. */
  deletedImageCount?: number;
  failedCount?: number;
};

/** Requests one version-scoped bulk deletion; all images in the version are handled by the API. */
export async function deleteWorkInstructionSourceVersionImages(input: {
  sourceVersionId: string;
  authenticationId: string;
}): Promise<WorkInstructionSourceVersionImageDeleteResponseDto> {
  const { data } = await api.delete<WorkInstructionSourceVersionImageDeleteResponseDto>(
    `${WORK_INSTRUCTION_BASE}/source-versions/${encoded(input.sourceVersionId)}/image`,
    { headers: editorAuthenticationHeaders(input.authenticationId) }
  );
  return data;
}

/** @deprecated Use the explicit version-scoped bulk name. */
export const deleteWorkInstructionSourceImage = deleteWorkInstructionSourceVersionImages;
