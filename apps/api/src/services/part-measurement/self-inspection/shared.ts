import { Prisma } from '@prisma/client';
import type {
  PartMeasurementProcessGroup,
  SelfInspectionMeasurementReviewStatus,
  SelfInspectionMode
} from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { resolveProductionSchedulePlannedQuantity } from '../../production-schedule/self-inspection-schedule-eligibility.js';
import { partMeasurementTemplateFullInclude } from '../part-measurement-template-include.js';
import {
  isSessionCompletionReady,
  listRequiredEntrySlots,
  tryResolveExpectedEntryCount,
  type SelfInspectionTemplateConfig,
  SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT
} from '../self-inspection-config.js';


export type SelfInspectionTemplate = Prisma.PartMeasurementTemplateGetPayload<{
  include: typeof partMeasurementTemplateFullInclude;
}>;

export function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

export function isBlankValue(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
}

export function countDecimalPlacesString(raw: string): number {
  const s = raw.trim();
  const i = s.indexOf('.');
  if (i < 0) return 0;
  return s.length - i - 1;
}

export function assertDecimalPlacesWithinLimit(decimalValue: Prisma.Decimal, decimalPlaces: number): void {
  const quantized = decimalValue.toDecimalPlaces(decimalPlaces, Prisma.Decimal.ROUND_HALF_UP);
  if (!decimalValue.equals(quantized)) {
    throw new ApiError(400, `小数桁数は最大${decimalPlaces}桁です`);
  }
}

export function isValueWithinTolerance(
  item: {
    lowerLimit: Prisma.Decimal | null;
    upperLimit: Prisma.Decimal | null;
    depthMode?: 'MEASURED' | 'THROUGH' | string | null;
  },
  decimalValue: Prisma.Decimal
): boolean {
  if (String(item.depthMode ?? 'MEASURED').toUpperCase() === 'THROUGH') {
    return true;
  }
  if (item.lowerLimit == null || item.upperLimit == null) {
    return false;
  }
  const lower = item.lowerLimit;
  const upper = item.upperLimit;
  const lo = lower.lessThanOrEqualTo(upper) ? lower : upper;
  const hi = lower.lessThanOrEqualTo(upper) ? upper : lower;
  return decimalValue.greaterThanOrEqualTo(lo) && decimalValue.lessThanOrEqualTo(hi);
}

export function parseDecimal(value: string | number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return new Prisma.Decimal(String(value));
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new Prisma.Decimal(trimmed);
  } catch {
    return null;
  }
}

export function hasInspectionDrawingTemplate(template: SelfInspectionTemplate): boolean {
  if (!template.isActive || !template.visualTemplate?.drawingImageRelativePath?.trim()) return false;
  return template.items.length > 0 && template.items.every((item) => {
    return item.markerXRatio != null && item.markerYRatio != null && item.lowerLimit != null && item.upperLimit != null;
  });
}

export function serializeProcessGroup(processGroup: PartMeasurementProcessGroup): 'cutting' | 'grinding' {
  return processGroup === 'GRINDING' ? 'grinding' : 'cutting';
}

export function templateConfigFromTemplate(template: {
  selfInspectionMode: SelfInspectionMode;
  selfInspectionFixedCount?: number | null;
  selfInspectionSampleSize?: number | null;
}): SelfInspectionTemplateConfig {
  return {
    selfInspectionMode: template.selfInspectionMode,
    selfInspectionFixedCount: template.selfInspectionFixedCount ?? null,
    selfInspectionSampleSize: template.selfInspectionSampleSize ?? null
  };
}

export function buildSessionBusinessKey(input: {
  productNo: string;
  processGroup: PartMeasurementProcessGroup;
  resourceCd: string;
  scheduleRowId: string;
}): string {
  return [
    normalizeText(input.productNo),
    input.processGroup,
    normalizeText(input.resourceCd),
    normalizeText(input.scheduleRowId)
  ].join('::');
}

export type SessionForEntryCountPolicy = {
  expectedEntryCount: number;
  plannedQuantity: number;
  template: SelfInspectionTemplateConfig;
};

export function isMisalignedLegacyFullSelfInspectionSession(session: SessionForEntryCountPolicy): boolean {
  if (session.template.selfInspectionMode !== 'FULL') {
    return false;
  }
  const planned = resolveProductionSchedulePlannedQuantity(session.plannedQuantity);
  if (planned == null) {
    return false;
  }
  return session.expectedEntryCount < planned;
}

/** 旧形式で指示数が上限超・必要件数が食い違うセッション（再作成が必要） */
export function resolveLegacyFullSelfInspectionBlockedReason(
  session: SessionForEntryCountPolicy
): string | null {
  if (!isMisalignedLegacyFullSelfInspectionSession(session)) {
    return null;
  }
  const planned = resolveProductionSchedulePlannedQuantity(session.plannedQuantity);
  if (planned != null && planned > SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT) {
    return (
      `このセッションは旧形式のため、指示数 ${planned} 件の全数検査を完了できません。` +
      '生産日程から自主検査をやり直し、新しいセッションを作成してください。'
    );
  }
  return null;
}

/** 入力件の上限・完了判定の必要件数（修復後は expected と一致） */
export function resolveRequiredEntryCountForCompletion(session: SessionForEntryCountPolicy): number {
  if (session.template.selfInspectionMode !== 'FULL') {
    return session.expectedEntryCount;
  }
  const planned = resolveProductionSchedulePlannedQuantity(session.plannedQuantity);
  if (planned == null) {
    return session.expectedEntryCount;
  }
  return Math.max(session.expectedEntryCount, planned);
}

export function enrichSessionEntryCountFields<
  T extends SessionForEntryCountPolicy & { completedEntryCount?: number }
>(session: T) {
  const requiredEntryCount = resolveRequiredEntryCountForCompletion(session);
  return {
    requiredEntryCount,
    entryCountBlockedReason: resolveLegacyFullSelfInspectionBlockedReason(session)
  };
}

export function assertEntryUnmodifiedSince(ifUnmodifiedSince: string, entryUpdatedAt: Date): void {
  const clientAt = new Date(ifUnmodifiedSince);
  if (Number.isNaN(clientAt.getTime())) {
    throw new ApiError(400, 'ifUnmodifiedSince の形式が不正です');
  }
  if (clientAt.getTime() !== entryUpdatedAt.getTime()) {
    throw new ApiError(409, '他端末で更新されています。再読み込みしてください。');
  }
}

export function resolveExpectedEntryCount(template: SelfInspectionTemplateConfig, plannedQuantity: number): number {
  const count = tryResolveExpectedEntryCount(template, plannedQuantity);
  if (count != null) {
    return count;
  }
  throw new ApiError(400, '自主検査の必要件数を決定できません');
}

export type SelfInspectionStatusDto = 'not_started' | 'in_progress' | 'review_pending' | 'completed';

export type SelfInspectionInspectorMeasurementState =
  | 'not_required'
  | 'pending'
  | 'in_progress'
  | 'complete';

export type SelfInspectionMeasurementPayloadValue = {
  templateItemId: string;
  value: string | number | null;
  outOfToleranceAcknowledged?: boolean;
};

export type ExistingMeasurementReviewValue = {
  templateItemId: string;
  value: Prisma.Decimal | null;
  reviewStatus: SelfInspectionMeasurementReviewStatus;
  outOfToleranceAcknowledgedAt: Date | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  approvedByUsername: string | null;
  approvalComment: string | null;
};

export type NormalizedMeasurementValue = {
  templateItemId: string;
  value: Prisma.Decimal;
  reviewStatus: SelfInspectionMeasurementReviewStatus;
  outOfToleranceAcknowledgedAt: Date | null;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  approvedByUsername: string | null;
  approvalComment: string | null;
};

export type InspectorEntryValueCompletionSource = {
  entryIndex: number;
  values: Array<{
    templateItemId: string;
    inspectorValue: Prisma.Decimal | null;
  }>;
};

export function buildInspectorMeasurementCompletion(input: {
  inspectorRemeasurementRequiredAt?: Date | null;
  recordApproval?: unknown | null;
  completedAt?: Date | null;
  template: SelfInspectionTemplateConfig & { itemIds?: string[] };
  plannedQuantity: number;
  inspectorEntries?: InspectorEntryValueCompletionSource[];
}): {
  state: SelfInspectionInspectorMeasurementState;
  requiredEntryCount: number;
  completedRequiredEntryCount: number;
  missingRequiredEntryCount: number;
  incompleteValueEntryCount: number;
} {
  const requiredSlots = listRequiredEntrySlots(input.template, input.plannedQuantity);
  const requiredItemIds = input.template.itemIds ?? [];
  if (!input.inspectorRemeasurementRequiredAt || input.recordApproval || input.completedAt) {
    return {
      state: 'not_required',
      requiredEntryCount: requiredSlots.length,
      completedRequiredEntryCount: 0,
      missingRequiredEntryCount: 0,
      incompleteValueEntryCount: 0
    };
  }

  const entriesByIndex = new Map(
    (input.inspectorEntries ?? []).map((entry) => [entry.entryIndex, entry])
  );
  let completedRequiredEntryCount = 0;
  let missingRequiredEntryCount = 0;
  let incompleteValueEntryCount = 0;

  for (const slot of requiredSlots) {
    const entry = entriesByIndex.get(slot.entryIndex);
    if (!entry) {
      missingRequiredEntryCount += 1;
      continue;
    }
    completedRequiredEntryCount += 1;
    const valuesByItemId = new Map(entry.values.map((value) => [value.templateItemId, value]));
    const hasMissingValue = requiredItemIds.some((itemId) => {
      const value = valuesByItemId.get(itemId);
      return value?.inspectorValue == null;
    });
    if (hasMissingValue) {
      incompleteValueEntryCount += 1;
    }
  }

  const state =
    missingRequiredEntryCount === 0 &&
    incompleteValueEntryCount === 0 &&
    requiredSlots.length > 0
      ? 'complete'
      : completedRequiredEntryCount > 0
        ? 'in_progress'
        : 'pending';

  return {
    state,
    requiredEntryCount: requiredSlots.length,
    completedRequiredEntryCount,
    missingRequiredEntryCount,
    incompleteValueEntryCount
  };
}

export function resolveStatus(input: {
  completedEntryCount: number;
  completedAt: Date | null;
  pendingReviewCount?: number;
  entryIndices?: number[];
  completionPolicy?: SessionForEntryCountPolicy;
}): SelfInspectionStatusDto {
  const {
    completedEntryCount,
    completedAt,
    pendingReviewCount = 0,
    entryIndices,
    completionPolicy
  } = input;
  if (completedAt) return 'completed';
  if (completedEntryCount <= 0) return 'not_started';
  if (pendingReviewCount > 0 && entryIndices && completionPolicy) {
    const templateConfig = templateConfigFromTemplate(completionPolicy.template);
    if (isSessionCompletionReady(templateConfig, completionPolicy.plannedQuantity, entryIndices)) {
      return 'review_pending';
    }
  }
  return 'in_progress';
}

export function sessionForEntryCountPolicy(session: {
  expectedEntryCount: number;
  plannedQuantity: number;
  template: {
    selfInspectionMode: SelfInspectionMode;
    selfInspectionFixedCount?: number | null;
    selfInspectionSampleSize?: number | null;
  };
}): SessionForEntryCountPolicy {
  return {
    expectedEntryCount: session.expectedEntryCount,
    plannedQuantity: session.plannedQuantity,
    template: templateConfigFromTemplate(session.template)
  };
}
