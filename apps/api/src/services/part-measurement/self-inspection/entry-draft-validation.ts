import { Prisma } from '@prisma/client';

import { ApiError } from '../../../lib/errors.js';
import {
  assertDecimalPlacesWithinLimit,
  countDecimalPlacesString,
  isBlankValue,
  isValueWithinTolerance,
  parseDecimal,
  type SelfInspectionMeasurementPayloadValue,
  type SelfInspectionTemplate
} from './shared.js';

export type NormalizedDraftMeasurementValue = {
  templateItemId: string;
  value: Prisma.Decimal | null;
  reviewStatus: 'NOT_REQUIRED';
  outOfToleranceAcknowledgedAt: Date | null;
  approvedAt: null;
  approvedByUserId: null;
  approvedByUsername: null;
  approvalComment: null;
};

/**
 * 下書き用: 部分送信・空欄可。不正な数値は 400。
 * 全測定点必須・公差外確認は要求しない。
 */
export function validateDraftMeasurementPayload(
  template: SelfInspectionTemplate,
  values: SelfInspectionMeasurementPayloadValue[] = []
): NormalizedDraftMeasurementValue[] {
  const expectedIds = new Set(template.items.map((item) => item.id));
  const seen = new Set<string>();
  const normalized: NormalizedDraftMeasurementValue[] = [];

  for (const value of values) {
    if (!expectedIds.has(value.templateItemId) || seen.has(value.templateItemId)) {
      throw new ApiError(400, '測定点の指定が不正です');
    }
    seen.add(value.templateItemId);
    const item = template.items.find((row) => row.id === value.templateItemId);
    if (!item) {
      throw new ApiError(400, '測定点の指定が不正です');
    }

    if (isBlankValue(value.value)) {
      normalized.push({
        templateItemId: value.templateItemId,
        value: null,
        reviewStatus: 'NOT_REQUIRED',
        outOfToleranceAcknowledgedAt: null,
        approvedAt: null,
        approvedByUserId: null,
        approvedByUsername: null,
        approvalComment: null
      });
      continue;
    }

    const decimalValue = parseDecimal(value.value);
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

    normalized.push({
      templateItemId: value.templateItemId,
      value: decimalValue,
      reviewStatus: 'NOT_REQUIRED',
      outOfToleranceAcknowledgedAt:
        !isValueWithinTolerance(item, decimalValue) && value.outOfToleranceAcknowledged === true
          ? new Date()
          : null,
      approvedAt: null,
      approvedByUserId: null,
      approvedByUsername: null,
      approvalComment: null
    });
  }

  return normalized;
}
