import {
  dedupeAndSortWorkInstructionTargets,
  normalizeWorkInstructionPartNumber
} from '../../lib/workInstructionRules';
import { api } from '../http';

import type { OverlayElement } from '@raspi-system/shared-types';

export type WorkInstructionImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * WorkInstruction keeps the source image immutable and renders these elements
 * on top of the published image. The renderer consumes only the neutral
 * overlay contract; source/migration fields are optional editor metadata.
 */
export type WorkInstructionOverlayElement = OverlayElement & {
  stepKey?: string;
  sourceStep?: number | null;
  migratedFromStep?: number;
  baseStepFingerprint?: string;
  targetStepFingerprint?: string | null;
  migrationState?: 'MIGRATED' | 'NEEDS_REVIEW' | 'UNASSIGNED' | 'SKIPPED' | 'migrated' | 'needs_review' | 'unassigned' | 'skipped';
};

export type WorkInstructionOverlayAsset = {
  assetId: string;
  storageKey?: string;
  contentType?: string;
  byteSize?: number;
  sha256?: string;
  url?: string;
  relativeUrl?: string;
};

export interface WorkInstructionGroupSummary {
  partNumber: string;
  shootingTarget: string;
  rowCount: number;
  stepCount: number;
  latestModified: string;
}

export type WorkInstructionPartCandidate = {
  partNumber: string;
  partName: string | null;
  shootingTargets: string[];
};

export type WorkInstructionPartCandidatePage = {
  matchedPrefix: string | null;
  candidates: WorkInstructionPartCandidate[];
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type WorkInstructionPartAlias = {
  scannedPartNumber: string;
  canonicalPartNumber: string;
  partName: string | null;
  shootingTargets: string[];
  selectionCount: number;
  createdAt: string;
  lastSelectedAt: string;
};

interface WorkInstructionStepFields {
  id: string;
  step: number;
  operation: string | null;
  text: string;
  /** Imported source text is immutable; these fields are revision-owned projections. */
  memo?: string | null;
  effectiveMemo?: string | null;
  memoOverride?: string | null;
  imageName: string | null;
  imageAssetId: string | null;
  imageUrl: string | null;
  imageMimeType: WorkInstructionImageMimeType | null;
  imageSha256: string | null;
  overlays?: WorkInstructionOverlayElement[];
  overlayAssets?: Record<string, WorkInstructionOverlayAsset>;
}

export interface WorkInstructionStep extends WorkInstructionStepFields {
  rowId: string;
  source: {
    system: string;
    list: string;
    itemId: number;
  };
}

type WorkInstructionJsonValue =
  | string
  | number
  | boolean
  | null
  | WorkInstructionJsonValue[]
  | { [key: string]: WorkInstructionJsonValue };

interface WorkInstructionRow {
  id: string;
  source: {
    system: string;
    list: string;
    itemId: number;
    modified: string;
  };
  partNumber: string | null;
  shootingTarget: string | null;
  contentHash: string;
  rawManifest: WorkInstructionJsonValue;
  steps: WorkInstructionStepFields[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkInstructionGroup {
  partNumber: string;
  shootingTarget: string;
  rows: WorkInstructionRow[];
  steps: WorkInstructionStep[];
  /** True when an imported source version is waiting for manager migration. */
  updateAvailable?: boolean;
  latestModified?: string | null;
  publishedRevisionNumber?: number | null;
  overlayAssets?: Record<string, WorkInstructionOverlayAsset>;
}

interface WorkInstructionGroupListResponse {
  groups: WorkInstructionGroupSummary[];
  limit: number;
  offset: number;
}

const WORK_INSTRUCTION_GROUP_PAGE_SIZE = 100;

function normalizeWorkInstructionTarget(value: string): string {
  return value.normalize('NFKC').trim().toUpperCase();
}

/**
 * Reads all group-summary pages for one scanned part and keeps one summary per
 * shooting target for the chip row.
 */
export async function getWorkInstructionGroupsByPartNumber(
  partNumber: string
): Promise<WorkInstructionGroupSummary[]> {
  const normalizedPartNumber = normalizeWorkInstructionPartNumber(partNumber);
  if (!normalizedPartNumber) return [];

  const summariesByTarget = new Map<string, WorkInstructionGroupSummary>();
  let offset = 0;
  let pageHasMore = true;

  while (pageHasMore) {
    const { data } = await api.get<WorkInstructionGroupListResponse>('/work-instructions/groups', {
      params: {
        partNumber: normalizedPartNumber,
        limit: WORK_INSTRUCTION_GROUP_PAGE_SIZE,
        offset
      }
    });

    for (const summary of data.groups) {
      if (!summariesByTarget.has(summary.shootingTarget)) {
        summariesByTarget.set(summary.shootingTarget, summary);
      }
    }

    pageHasMore = data.groups.length === WORK_INSTRUCTION_GROUP_PAGE_SIZE;
    if (pageHasMore) offset += WORK_INSTRUCTION_GROUP_PAGE_SIZE;
  }

  return dedupeAndSortWorkInstructionTargets([...summariesByTarget.keys()])
    .map((target) => summariesByTarget.get(target))
    .filter((summary): summary is WorkInstructionGroupSummary => summary !== undefined);
}

export async function getWorkInstructionPartCandidates(
  params: { prefix: string; fallback?: boolean; limit?: number; offset?: number },
  signal?: AbortSignal
): Promise<WorkInstructionPartCandidatePage> {
  const normalizedPrefix = normalizeWorkInstructionPartNumber(params.prefix);
  if (!normalizedPrefix || Array.from(normalizedPrefix).length < 2) {
    return { matchedPrefix: null, candidates: [], limit: params.limit ?? 20, offset: params.offset ?? 0, hasMore: false };
  }
  const { data } = await api.get<WorkInstructionPartCandidatePage>('/work-instructions/part-candidates', {
    params: {
      prefix: normalizedPrefix,
      fallback: params.fallback ?? false,
      limit: params.limit ?? 20,
      offset: params.offset ?? 0
    },
    signal
  });
  return data;
}

export async function getWorkInstructionPartAlias(
  partNumber: string,
  signal?: AbortSignal
): Promise<WorkInstructionPartAlias | null> {
  const normalized = normalizeWorkInstructionPartNumber(partNumber);
  if (!normalized) return null;
  const { data } = await api.get<{ alias: WorkInstructionPartAlias | null }>('/work-instructions/part-alias', {
    params: { partNumber: normalized },
    signal
  });
  return data.alias;
}

export async function putWorkInstructionPartAlias(input: {
  scannedPartNumber: string;
  canonicalPartNumber: string;
}): Promise<WorkInstructionPartAlias> {
  const { data } = await api.put<{ alias: WorkInstructionPartAlias }>('/work-instructions/part-alias', {
    scannedPartNumber: normalizeWorkInstructionPartNumber(input.scannedPartNumber),
    canonicalPartNumber: normalizeWorkInstructionPartNumber(input.canonicalPartNumber)
  });
  return data.alias;
}

/** Reads one selected group; the backend calls the shooting-target query `resource`. */
export async function getWorkInstructionGroup(
  partNumber: string,
  shootingTarget: string
): Promise<WorkInstructionGroup> {
  const { data } = await api.get<WorkInstructionGroup>('/work-instructions/group', {
    params: {
      partNumber: normalizeWorkInstructionPartNumber(partNumber),
      resource: normalizeWorkInstructionTarget(shootingTarget)
    }
  });
  return data;
}
