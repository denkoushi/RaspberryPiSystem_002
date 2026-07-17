import { Prisma } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import { prisma } from '../../../lib/prisma.js';
import { resolveProductionSchedulePlannedQuantity } from '../../production-schedule/self-inspection-schedule-eligibility.js';
import { partMeasurementTemplateFullInclude } from '../part-measurement-template-include.js';
import { SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT } from '../self-inspection-config.js';
import {
  isSelfInspectionLotEntryRegistrationCompleteForPolicy,
  type SelfInspectionRegistrationRequirementPolicy
} from '../self-inspection-registration-policy.service.js';
import { confirmedWhere } from './entry-persistence-status.js';
import {
  assertDecimalPlacesWithinLimit,
  countDecimalPlacesString,
  isBlankValue,
  isMisalignedLegacyFullSelfInspectionSession,
  isValueWithinTolerance,
  parseDecimal,
  resolveLegacyFullSelfInspectionBlockedReason,
  type ExistingMeasurementReviewValue,
  type NormalizedMeasurementValue,
  type SelfInspectionMeasurementPayloadValue,
  type SelfInspectionTemplate,
  type SessionForEntryCountPolicy
} from './shared.js';


export async function loadSessionForMutation(
  db: Prisma.TransactionClient | typeof prisma,
  sessionId: string
) {
  let session = await db.selfInspectionSession.findUnique({
    where: { id: sessionId },
    include: {
      template: { include: partMeasurementTemplateFullInclude },
      entries: {
        select: { id: true, entryIndex: true }
      }
    }
  });
  if (!session) {
    throw new ApiError(404, '自主検査セッションが見つかりません');
  }
  if (session.completedAt) {
    throw new ApiError(409, '完了済みの自主検査は編集できません');
  }
  if (isMisalignedLegacyFullSelfInspectionSession(session)) {
    const planned = resolveProductionSchedulePlannedQuantity(session.plannedQuantity);
    if (planned != null && planned <= SELF_INSPECTION_MAX_EXPECTED_ENTRY_COUNT) {
      session = await db.selfInspectionSession.update({
        where: { id: sessionId },
        data: { expectedEntryCount: planned },
        include: {
          template: { include: partMeasurementTemplateFullInclude },
          entries: {
            select: { id: true, entryIndex: true }
          }
        }
      });
    }
  }
  return session;
}

export function assertSessionEntryCountWritable(session: SessionForEntryCountPolicy): void {
  const blocked = resolveLegacyFullSelfInspectionBlockedReason(session);
  if (blocked) {
    throw new ApiError(409, blocked);
  }
}

export async function lockSessionRow(db: Prisma.TransactionClient, sessionId: string) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM "SelfInspectionSession" WHERE id = ${sessionId} FOR UPDATE
  `;
  if (rows.length === 0) {
    throw new ApiError(404, '自主検査セッションが見つかりません');
  }
}

export function validateMeasurementPayload(
  template: SelfInspectionTemplate,
  values: SelfInspectionMeasurementPayloadValue[],
  existingValues: ExistingMeasurementReviewValue[] = []
): NormalizedMeasurementValue[] {
  if (values.length !== template.items.length) {
    throw new ApiError(400, '全測定点の値を送信してください');
  }
  const expectedIds = new Set(template.items.map((item) => item.id));
  const seen = new Set<string>();
  const existingByItemId = new Map(existingValues.map((value) => [value.templateItemId, value]));
  const acknowledgedAt = new Date();
  const normalized: NormalizedMeasurementValue[] = values.map((value) => {
    if (!expectedIds.has(value.templateItemId) || seen.has(value.templateItemId)) {
      throw new ApiError(400, '測定点の指定が不正です');
    }
    seen.add(value.templateItemId);
    const item = template.items.find((row) => row.id === value.templateItemId);
    if (!item) {
      throw new ApiError(400, '測定点の指定が不正です');
    }
    const decimalValue = parseDecimal(value.value);
    if (!isBlankValue(value.value) && decimalValue == null) {
      throw new ApiError(400, '測定値は数値で入力してください');
    }
    if (decimalValue == null) {
      throw new ApiError(400, '測定値は数値で入力してください');
    }
    if (!item.allowNegative && decimalValue.lessThan(0)) {
      throw new ApiError(400, '負の値は入力できません');
    }
    if (typeof value.value === 'string') {
      const places = countDecimalPlacesString(value.value);
      if (places > item.decimalPlaces) {
        throw new ApiError(400, `小数桁数は最大${item.decimalPlaces}桁です`);
      }
    }
    assertDecimalPlacesWithinLimit(decimalValue, item.decimalPlaces);
    const existingValue = existingByItemId.get(value.templateItemId);
    const existingSameValue =
      existingValue?.value != null && existingValue.value.equals(decimalValue);
    if (isValueWithinTolerance(item, decimalValue)) {
      return {
        templateItemId: value.templateItemId,
        value: decimalValue,
        reviewStatus: 'NOT_REQUIRED',
        outOfToleranceAcknowledgedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        approvedByUsername: null,
        approvalComment: null
      };
    }
    if (existingSameValue && existingValue.reviewStatus !== 'NOT_REQUIRED') {
      return {
        templateItemId: value.templateItemId,
        value: decimalValue,
        reviewStatus: existingValue.reviewStatus,
        outOfToleranceAcknowledgedAt: existingValue.outOfToleranceAcknowledgedAt,
        approvedAt: existingValue.approvedAt,
        approvedByUserId: existingValue.approvedByUserId,
        approvedByUsername: existingValue.approvedByUsername,
        approvalComment: existingValue.approvalComment
      };
    }
    if (value.outOfToleranceAcknowledged !== true) {
      throw new ApiError(400, '公差外の測定値は確認が必要です');
    }
    return {
      templateItemId: value.templateItemId,
      value: decimalValue,
      reviewStatus: 'PENDING',
      outOfToleranceAcknowledgedAt: acknowledgedAt,
      approvedAt: null,
      approvedByUserId: null,
      approvedByUsername: null,
      approvalComment: null
    };
  });
  return normalized;
}

export async function assertAllEntriesReviewReady(
  db: Prisma.TransactionClient,
  sessionId: string,
  template: SelfInspectionTemplate
) {
  const entries = await db.selfInspectionLotEntry.findMany({
    where: { sessionId, ...confirmedWhere },
    include: { values: true }
  });
  for (const entry of entries) {
    const valuesByItem = new Map(entry.values.map((value) => [value.templateItemId, value]));
    for (const item of template.items) {
      const stored = valuesByItem.get(item.id);
      if (stored?.value == null) {
        throw new ApiError(409, '測定値が未登録のため完了できません');
      }
      if (!isValueWithinTolerance(item, stored.value) && stored.reviewStatus !== 'APPROVED') {
        throw new ApiError(409, '公差外の測定値が未承認のため完了できません');
      }
    }
  }
}

export async function assertAllEntriesHaveRegistration(
  db: Prisma.TransactionClient,
  sessionId: string,
  registrationPolicy: SelfInspectionRegistrationRequirementPolicy
) {
  const entries = await db.selfInspectionLotEntry.findMany({
    where: { sessionId, ...confirmedWhere },
    select: {
      entryIndex: true,
      createdByEmployeeId: true,
      measuringInstrumentId: true,
      _count: { select: { instrumentUsages: true } }
    }
  });
  for (const entry of entries) {
    if (
      !isSelfInspectionLotEntryRegistrationCompleteForPolicy(
        { ...entry, measuringInstrumentUsageCount: entry._count.instrumentUsages },
        registrationPolicy
      )
    ) {
      const missing = entry.createdByEmployeeId
        ? '計測機器の使用前点検'
        : registrationPolicy.requireMeasuringInstrumentTag
          ? '測定者または計測機器の使用前点検'
          : '測定者';
      throw new ApiError(
        409,
        `入力件 ${entry.entryIndex + 1} の${missing}が未登録のため完了できません`
      );
    }
  }
}

export async function assertAllInspectorEntriesHaveRegistration(
  db: Prisma.TransactionClient,
  sessionId: string,
  registrationPolicy: SelfInspectionRegistrationRequirementPolicy
) {
  const entries = await db.selfInspectionInspectorEntry.findMany({
    where: { sessionId },
    orderBy: { entryIndex: 'asc' },
    select: {
      entryIndex: true,
      inspectorEmployeeId: true,
      measuringInstrumentId: true,
      _count: { select: { instrumentUsages: true } }
    }
  });
  for (const entry of entries) {
    if (
      !isSelfInspectionLotEntryRegistrationCompleteForPolicy(
        {
          createdByEmployeeId: entry.inspectorEmployeeId,
          measuringInstrumentId: entry.measuringInstrumentId,
          measuringInstrumentUsageCount: entry._count.instrumentUsages
        },
        registrationPolicy
      )
    ) {
      const missing = entry.inspectorEmployeeId
        ? '計測機器の使用前点検'
        : registrationPolicy.requireMeasuringInstrumentTag
          ? '検査員または計測機器の使用前点検'
          : '検査員';
      throw new ApiError(
        409,
        `検査員入力件 ${entry.entryIndex + 1} の${missing}が未登録のため完了できません`
      );
    }
  }
}

export async function assertInspectorRemeasurementNotStarted(
  db: Prisma.TransactionClient,
  sessionId: string
): Promise<void> {
  const inspectorEntryCount = await db.selfInspectionInspectorEntry.count({
    where: { sessionId }
  });
  if (inspectorEntryCount > 0) {
    throw new ApiError(409, '検査員の再測定が開始済みのためオペレータ測定値は変更できません');
  }
}

export function assertLotEntryValuesMatchPayload(
  existing: Prisma.SelfInspectionLotEntryGetPayload<{ include: { values: true } }>,
  normalized: NormalizedMeasurementValue[]
) {
  if (existing.values.length !== normalized.length) {
    throw new ApiError(409, '他端末で既に登録された入力と競合しています');
  }
  const existingByItem = new Map(
    existing.values.map((value) => [value.templateItemId, value.value])
  );
  for (const value of normalized) {
    const existingValue = existingByItem.get(value.templateItemId);
    if (existingValue == null) {
      throw new ApiError(409, '他端末で既に登録された入力と競合しています');
    }
    if (!existingValue.equals(value.value)) {
      throw new ApiError(409, '他端末で既に登録された測定値と競合しています');
    }
  }
}
