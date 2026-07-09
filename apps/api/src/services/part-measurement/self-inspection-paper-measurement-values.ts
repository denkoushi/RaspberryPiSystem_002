import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';

type TemplateItemForPaperValue = {
  id: string;
  allowNegative: boolean;
  decimalPlaces: number;
  lowerLimit: Prisma.Decimal | null;
  upperLimit: Prisma.Decimal | null;
};

export type SelfInspectionPaperConfirmedValueInput = {
  entryIndex: number;
  templateItemId: string;
  value: string | number | null;
  overwriteExisting?: boolean;
};

export type SelfInspectionPaperConfirmedValue = {
  entryIndex: number;
  templateItemId: string;
  value: Prisma.Decimal;
  overwriteExisting: boolean;
};

export function validateSelfInspectionPaperConfirmedValues(
  templateItems: TemplateItemForPaperValue[],
  rawValues: SelfInspectionPaperConfirmedValueInput[]
): SelfInspectionPaperConfirmedValue[] {
  if (rawValues.length === 0) {
    throw new ApiError(400, '確認済み測定値が必要です');
  }
  const itemById = new Map(templateItems.map((item) => [item.id, item]));
  const seen = new Set<string>();

  return rawValues.map((raw) => {
    const entryIndex = Math.floor(raw.entryIndex);
    if (!Number.isInteger(entryIndex) || entryIndex < 0) {
      throw new ApiError(400, '入力件番号が範囲外です');
    }
    const item = itemById.get(raw.templateItemId);
    if (!item) {
      throw new ApiError(400, '測定点の指定が不正です');
    }
    const duplicateKey = `${entryIndex}:${raw.templateItemId}`;
    if (seen.has(duplicateKey)) {
      throw new ApiError(400, '同じ入力件・測定点が重複しています');
    }
    seen.add(duplicateKey);

    const decimalValue = parseDecimal(raw.value);
    if (decimalValue == null) {
      throw new ApiError(400, '測定値は数値で入力してください');
    }
    if (!item.allowNegative && decimalValue.lessThan(0)) {
      throw new ApiError(400, '負の値は入力できません');
    }
    if (typeof raw.value === 'string' && countDecimalPlacesString(raw.value) > item.decimalPlaces) {
      throw new ApiError(400, `小数桁数は最大${item.decimalPlaces}桁です`);
    }
    assertDecimalPlacesWithinLimit(decimalValue, item.decimalPlaces);
    if (!isValueWithinTolerance(item, decimalValue)) {
      throw new ApiError(400, '公差外の測定値は保存できません');
    }

    return {
      entryIndex,
      templateItemId: raw.templateItemId,
      value: decimalValue,
      overwriteExisting: raw.overwriteExisting === true
    };
  });
}

function parseDecimal(value: string | number | null | undefined): Prisma.Decimal | null {
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

function countDecimalPlacesString(raw: string): number {
  const s = raw.trim();
  const index = s.indexOf('.');
  if (index < 0) return 0;
  return s.length - index - 1;
}

function assertDecimalPlacesWithinLimit(decimalValue: Prisma.Decimal, decimalPlaces: number): void {
  const quantized = decimalValue.toDecimalPlaces(decimalPlaces, Prisma.Decimal.ROUND_HALF_UP);
  if (!decimalValue.equals(quantized)) {
    throw new ApiError(400, `小数桁数は最大${decimalPlaces}桁です`);
  }
}

function isValueWithinTolerance(
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
