import type { InspectionPointStatus } from './types';

export function parseMeasurementNumber(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, '');
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function evaluateMeasurementValue(
  value: number | null,
  lower: number,
  upper: number
): InspectionPointStatus {
  if (value === null) return 'empty';
  const lo = Math.min(lower, upper);
  const hi = Math.max(lower, upper);
  if (value >= lo && value <= hi) return 'ok';
  return 'ng';
}

export function statusForPoint(testValue: string, lower: number, upper: number): InspectionPointStatus {
  return evaluateMeasurementValue(parseMeasurementNumber(testValue), lower, upper);
}
