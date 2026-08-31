import {
  dedupeAndSortWorkInstructionTargets,
  normalizeWorkInstructionPartNumber
} from '../../lib/workInstructionRules';
import { api } from '../http';

export type WorkInstructionImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface WorkInstructionGroupSummary {
  partNumber: string;
  shootingTarget: string;
  rowCount: number;
  stepCount: number;
  latestModified: string;
}

interface WorkInstructionStepFields {
  id: string;
  step: number;
  text: string;
  imageName: string | null;
  imageAssetId: string | null;
  imageUrl: string | null;
  imageMimeType: WorkInstructionImageMimeType | null;
  imageSha256: string | null;
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
