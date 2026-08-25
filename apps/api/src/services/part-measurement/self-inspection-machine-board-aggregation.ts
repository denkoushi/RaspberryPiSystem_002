import { normalizeMachineNameForCompare } from '../production-schedule/machine-name-compare.js';
import {
  resolveSelfInspectionMachineBoardOutcome,
  type SelfInspectionMachineBoardOutcomeInput,
  type SelfInspectionMachineBoardMeasurementOutcome,
  type SelfInspectionMachineBoardOutcomeStatus,
} from './self-inspection-machine-board-outcome.js';
import type {
  SelfInspectionMachineBoardCard,
  SelfInspectionMachineBoardResourceProgress,
} from './self-inspection-machine-board.types.js';

/** scan した日程行を純粋な集約関数へ渡すための境界型。 */
export type SelfInspectionMachineBoardAggregationRow = {
  scheduleRowId: string;
  fseiban: string;
  productNo: string;
  fhincd: string;
  fhinmei: string;
  machineName?: string | null;
  normalizedMachineName?: string | null;
  resourceCd: string;
  resourceDisplayName?: string | null;
  dueDate: Date | null;
  isScheduled: boolean;
  confirmedEntryCount?: number | null;
  completedEntryCount?: number | null;
  requiredEntryCount?: number | null;
  /** outcome は repository の詳細な入力、または既に解決した表示状態。 */
  outcome?: SelfInspectionMachineBoardOutcomeInput | SelfInspectionMachineBoardOutcomeStatus | null;
  pendingReviewCount?: number | null;
  directFailCount?: number | null;
  rejectedCount?: number | null;
  judgementResults?: Array<string | null | undefined>;
  reviewStatuses?: Array<string | null | undefined>;
  finalReviewStatuses?: Array<string | null | undefined>;
  measurementOutcomes?: SelfInspectionMachineBoardMeasurementOutcome[];
  /** active session board の順序保持用。カード表示契約へは露出しない。 */
  updatedAt?: Date;
  sessionId?: string;
};

export type { SelfInspectionMachineBoardCard } from './self-inspection-machine-board.types.js';

const OUTCOME_PRIORITY: Record<SelfInspectionMachineBoardOutcomeStatus, number> = {
  rejected: 0,
  pending: 1,
  in_progress: 2,
  pass: 3,
  not_started: 4,
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeResourceCd(value: string | null | undefined): string {
  return normalizeText(value).toUpperCase();
}

function finiteNonNegative(value: number | null | undefined, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value as number));
}

function outcomeInputForRow(
  row: SelfInspectionMachineBoardAggregationRow,
  confirmedEntryCount: number,
  requiredEntryCount: number
): SelfInspectionMachineBoardOutcomeInput {
  const outcome = row.outcome;
  if (outcome && typeof outcome === 'object') {
    return {
      ...outcome,
      confirmedEntryCount,
      completedEntryCount: confirmedEntryCount,
      requiredEntryCount,
    };
  }

  return {
    confirmedEntryCount,
    completedEntryCount: confirmedEntryCount,
    requiredEntryCount,
    pendingReviewCount: row.pendingReviewCount,
    directFailCount: row.directFailCount,
    rejectedCount: row.rejectedCount,
    judgementResults: row.judgementResults,
    reviewStatuses: row.reviewStatuses,
    finalReviewStatuses: row.finalReviewStatuses,
    measurementOutcomes: row.measurementOutcomes,
    legacyStatus: typeof outcome === 'string' ? outcome : null,
  };
}

function resolveResourceOutcome(
  rows: SelfInspectionMachineBoardAggregationRow[]
): SelfInspectionMachineBoardOutcomeStatus {
  let confirmedEntryCount = 0;
  let requiredEntryCount = 0;
  let directFailCount = 0;
  let rejectedCount = 0;
  let pendingReviewCount = 0;
  const judgementResults: Array<string | null | undefined> = [];
  const reviewStatuses: Array<string | null | undefined> = [];
  const finalReviewStatuses: Array<string | null | undefined> = [];
  const measurementOutcomes: SelfInspectionMachineBoardMeasurementOutcome[] = [];
  let hasAnyLotEntry = false;

  for (const row of rows) {
    const confirmed = finiteNonNegative(row.confirmedEntryCount ?? row.completedEntryCount, 0);
    const required = Math.max(1, finiteNonNegative(row.requiredEntryCount, 1));
    const rowInput = outcomeInputForRow(row, confirmed, required);
    confirmedEntryCount += confirmed;
    requiredEntryCount += required;
    directFailCount += finiteNonNegative(rowInput.directFailCount, 0);
    rejectedCount += finiteNonNegative(rowInput.rejectedCount, 0);
    pendingReviewCount += finiteNonNegative(rowInput.pendingReviewCount, 0);
    judgementResults.push(...(rowInput.judgementResults ?? []));
    reviewStatuses.push(...(rowInput.reviewStatuses ?? []));
    finalReviewStatuses.push(...(rowInput.finalReviewStatuses ?? []));
    measurementOutcomes.push(...(rowInput.measurementOutcomes ?? []));
    hasAnyLotEntry ||= rowInput.hasAnyLotEntry === true || confirmed > 0;
  }

  return resolveSelfInspectionMachineBoardOutcome({
    confirmedEntryCount,
    requiredEntryCount: Math.max(1, requiredEntryCount),
    // completedAt/legacyStatus belong to an individual session.  At resource
    // level the summed confirmed/required counts are authoritative; carrying
    // either field forward could mark a partially complete aggregate as pass.
    completedAt: null,
    hasAnyLotEntry,
    pendingReviewCount,
    directFailCount,
    rejectedCount,
    judgementResults,
    reviewStatuses,
    finalReviewStatuses,
    measurementOutcomes,
  });
}

function buildProgressLabel(completed: number, required: number): string {
  return `${completed}/${required}`;
}

/**
 * 内部カードキー。表示名ではなく正規化機種名を使い、同一部品の資源行をまとめる。
 * 区切りは既存の業務キーと同じ `::` とする。
 */
export function buildSelfInspectionMachineBoardCardKey(input: {
  fseiban: string;
  productNo: string;
  fhincd: string;
  machineName?: string | null;
  normalizedMachineName?: string | null;
}): string {
  const normalizedMachineName =
    normalizeText(input.normalizedMachineName) || normalizeMachineNameForCompare(input.machineName);
  return [
    normalizeText(input.fseiban),
    normalizeText(input.productNo),
    normalizeText(input.fhincd),
    normalizedMachineName,
  ].join('::');
}

export const buildSelfInspectionMachineBoardInternalCardKey = buildSelfInspectionMachineBoardCardKey;
export const buildMachineBoardCardKey = buildSelfInspectionMachineBoardCardKey;

/** 資源CDごとに CONFIRMED / required を合算する純粋関数。 */
export function aggregateSelfInspectionMachineBoardResources(
  rows: SelfInspectionMachineBoardAggregationRow[]
): SelfInspectionMachineBoardResourceProgress[] {
  type ResourceBucket = {
    resourceCd: string;
    rows: SelfInspectionMachineBoardAggregationRow[];
    confirmedEntryCount: number;
    requiredEntryCount: number;
    scheduleRowIds: string[];
    resourceDisplayNames: string[];
  };

  const buckets = new Map<string, ResourceBucket>();
  for (const row of rows) {
    const resourceCd = normalizeResourceCd(row.resourceCd);
    if (!resourceCd) {
      continue;
    }
    const confirmedEntryCount = finiteNonNegative(
      row.confirmedEntryCount ?? row.completedEntryCount,
      0
    );
    const requiredEntryCount = Math.max(1, finiteNonNegative(row.requiredEntryCount, 1));
    const bucket = buckets.get(resourceCd) ?? {
      resourceCd,
      rows: [],
      confirmedEntryCount: 0,
      requiredEntryCount: 0,
      scheduleRowIds: [],
      resourceDisplayNames: [],
    };
    bucket.rows.push(row);
    bucket.confirmedEntryCount += confirmedEntryCount;
    bucket.requiredEntryCount += requiredEntryCount;
    if (!bucket.scheduleRowIds.includes(row.scheduleRowId)) {
      bucket.scheduleRowIds.push(row.scheduleRowId);
    }
    const resourceDisplayName = normalizeText(row.resourceDisplayName);
    if (
      resourceDisplayName.length > 0 &&
      !bucket.resourceDisplayNames.includes(resourceDisplayName)
    ) {
      bucket.resourceDisplayNames.push(resourceDisplayName);
    }
    buckets.set(resourceCd, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => a.resourceCd.localeCompare(b.resourceCd))
    .map((bucket) => {
      const status = resolveResourceOutcome(bucket.rows);
      const resourceDisplayName = bucket.resourceDisplayNames.join(' / ');
      return {
        resourceCd: bucket.resourceCd,
        ...(resourceDisplayName ? { resourceDisplayName } : {}),
        confirmedEntryCount: bucket.confirmedEntryCount,
        requiredEntryCount: bucket.requiredEntryCount,
        completedEntryCount: bucket.confirmedEntryCount,
        progressLabel: buildProgressLabel(
          bucket.confirmedEntryCount,
          bucket.requiredEntryCount
        ),
        status,
        outcome: status,
        scheduleRowIds: bucket.scheduleRowIds,
      };
    });
}

export const aggregateMachineBoardResources = aggregateSelfInspectionMachineBoardResources;
export const aggregateSelfInspectionMachineBoardResourceProgress =
  aggregateSelfInspectionMachineBoardResources;

/** 内部カードキー単位に行をまとめ、資源進捗とカード状態を構成する純粋関数。 */
export function aggregateSelfInspectionMachineBoardCards(
  rows: SelfInspectionMachineBoardAggregationRow[]
): SelfInspectionMachineBoardCard[] {
  const groups = new Map<string, SelfInspectionMachineBoardAggregationRow[]>();
  for (const row of rows) {
    const cardKey = buildSelfInspectionMachineBoardCardKey(row);
    const group = groups.get(cardKey);
    if (group) {
      group.push(row);
    } else {
      groups.set(cardKey, [row]);
    }
  }

  return [...groups.entries()].map(([cardKey, group]) => {
    const first = group[0]!;
    const resources = aggregateSelfInspectionMachineBoardResources(group);
    const confirmedEntryCount = resources.reduce(
      (sum, resource) => sum + resource.confirmedEntryCount,
      0
    );
    const requiredEntryCount = resources.reduce(
      (sum, resource) => sum + resource.requiredEntryCount,
      0
    );
    const status = resolveResourceOutcome(group);
    const machineName = normalizeText(first.machineName);
    const normalizedMachineName =
      normalizeText(first.normalizedMachineName) || normalizeMachineNameForCompare(machineName);
    const dueDates = group
      .map((row) => row.dueDate)
      .filter((value): value is Date => value != null)
      .sort((a, b) => a.getTime() - b.getTime());
    const scheduleRowIds = [...new Set(group.map((row) => row.scheduleRowId))];

    return {
      scheduleRowId: scheduleRowIds[0] ?? '',
      scheduleRowIds,
      cardKey,
      fseiban: first.fseiban,
      productNo: first.productNo,
      fhincd: first.fhincd,
      fhinmei: first.fhinmei || first.fhincd,
      machineName,
      normalizedMachineName,
      status,
      outcome: status,
      completedEntryCount: confirmedEntryCount,
      confirmedEntryCount,
      requiredEntryCount,
      progressLabel: buildProgressLabel(confirmedEntryCount, requiredEntryCount),
      dueDate: dueDates[0] ?? null,
      isScheduled: group.some((row) => row.isScheduled),
      resources,
      resourceCds: resources.map((resource) => resource.resourceCd),
    };
  });
}

export const aggregateMachineBoardCards = aggregateSelfInspectionMachineBoardCards;
export const buildSelfInspectionMachineBoardCards = aggregateSelfInspectionMachineBoardCards;

export function compareSelfInspectionMachineBoardOutcomeStatus(
  a: SelfInspectionMachineBoardOutcomeStatus,
  b: SelfInspectionMachineBoardOutcomeStatus
): number {
  return OUTCOME_PRIORITY[a] - OUTCOME_PRIORITY[b];
}
