import type { Prisma } from '@prisma/client';

import type { ProductionScheduleRow } from '../production-schedule-query.service.js';

function resolveSplitQuantityRatio(
  parentPlannedQuantity: number | null | undefined,
  splitQuantity: number
): number | null {
  if (
    parentPlannedQuantity == null ||
    !Number.isFinite(parentPlannedQuantity) ||
    parentPlannedQuantity <= 0 ||
    !Number.isFinite(splitQuantity) ||
    splitQuantity <= 0
  ) {
    return null;
  }
  return splitQuantity / parentPlannedQuantity;
}

function scaleRequiredMinutesValue(value: number | undefined, ratio: number): number | undefined {
  if (value == null || !Number.isFinite(value)) {
    return value;
  }
  return Math.max(0, Math.round(value * ratio));
}

function scaleRowDataFsigenshoyoryo(rowData: Prisma.JsonValue, ratio: number): Prisma.JsonValue {
  if (!rowData || typeof rowData !== 'object' || Array.isArray(rowData)) {
    return rowData;
  }

  const record = { ...(rowData as Record<string, unknown>) };
  const raw = record.FSIGENSHOYORYO;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    record.FSIGENSHOYORYO = String(Math.max(0, Math.round(raw * ratio)));
    return record as Prisma.JsonValue;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) {
        record.FSIGENSHOYORYO = String(Math.max(0, Math.round(parsed * ratio)));
      }
    }
  }
  return record as Prisma.JsonValue;
}

/** 分割片の数量比で所要時間フィールドを親行から配分する。 */
export function applySplitQuantityToProductionScheduleRowDisplayFields(
  parentRow: Pick<
    ProductionScheduleRow,
    'plannedQuantity' | 'machineRequiredMinutes' | 'laborRequiredMinutes' | 'rowData'
  >,
  splitQuantity: number
): Pick<
  ProductionScheduleRow,
  'plannedQuantity' | 'machineRequiredMinutes' | 'laborRequiredMinutes' | 'rowData'
> {
  const ratio = resolveSplitQuantityRatio(parentRow.plannedQuantity, splitQuantity);
  if (ratio == null) {
    return {
      plannedQuantity: splitQuantity,
      rowData: parentRow.rowData
    };
  }

  return {
    plannedQuantity: splitQuantity,
    machineRequiredMinutes: scaleRequiredMinutesValue(parentRow.machineRequiredMinutes, ratio),
    laborRequiredMinutes: scaleRequiredMinutesValue(parentRow.laborRequiredMinutes, ratio),
    rowData: scaleRowDataFsigenshoyoryo(parentRow.rowData, ratio)
  };
}
