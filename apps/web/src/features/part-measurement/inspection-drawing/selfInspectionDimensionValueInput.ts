import { toleranceBoundsFromPoint } from './markerNumbering';

import type { InspectionDrawingPoint } from './types';

export const SELF_INSPECTION_DIMENSION_MEASUREMENT_LABELS = [
  '外径',
  '内径',
  '全長',
  '全幅',
  '幅',
  '高さ',
  '穴径',
  'ピッチ',
  '深さ'
] as const;

const DIMENSION_LABEL_SET = new Set<string>(SELF_INSPECTION_DIMENSION_MEASUREMENT_LABELS);

export type SelfInspectionMeasurementValueInputKind =
  | 'dimension_hundredths'
  | 'standard_options';

export type SelfInspectionDimensionTenthsOptionsResult =
  | { mode: 'free_only'; reason?: string }
  | { mode: 'dropdown_and_free'; options: string[]; stepLabel: '0.1' };

function normalizeMeasurementLabel(label: string): string {
  return label.trim();
}

function formatTenthsValue(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

function scaleToleranceHundredths(value: number, direction: 'lower' | 'upper'): number {
  const scaled = value * 100;
  return direction === 'lower'
    ? Math.ceil(scaled - 1e-9)
    : Math.floor(scaled + 1e-9);
}

export function resolveSelfInspectionMeasurementValueInputKind(
  point: InspectionDrawingPoint
): SelfInspectionMeasurementValueInputKind {
  return DIMENSION_LABEL_SET.has(normalizeMeasurementLabel(point.name))
    ? 'dimension_hundredths'
    : 'standard_options';
}

export function buildSelfInspectionDimensionTenthsOptions(
  point: InspectionDrawingPoint
): SelfInspectionDimensionTenthsOptionsResult {
  const bounds = toleranceBoundsFromPoint(point);
  if ('error' in bounds) {
    return { mode: 'free_only', reason: bounds.error };
  }

  const lower = Math.min(bounds.lowerLimit, bounds.upperLimit);
  const upper = Math.max(bounds.lowerLimit, bounds.upperLimit);
  const lowerHundredths = scaleToleranceHundredths(lower, 'lower');
  const upperHundredths = scaleToleranceHundredths(upper, 'upper');
  if (lowerHundredths > upperHundredths) {
    return {
      mode: 'free_only',
      reason: '刻みに合う候補がありません。直接入力してください。'
    };
  }

  const startTenths = Math.floor(lowerHundredths / 10);
  const endTenths = Math.floor(upperHundredths / 10);
  const options: string[] = [];
  for (let tenths = startTenths; tenths <= endTenths; tenths += 1) {
    options.push(formatTenthsValue(tenths));
  }

  return { mode: 'dropdown_and_free', options, stepLabel: '0.1' };
}

export function formatDimensionTenthsProvisionalValue(baseTenthsValue: string): string {
  return `${baseTenthsValue.trim()}※`;
}

export function applyHundredthsDigitToDimensionValue(
  baseOrCurrentValue: string,
  digit: number
): string | null {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) return null;
  const raw = baseOrCurrentValue.trim().replace(/※$/, '');
  const match = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?$/);
  if (!match) return null;
  const sign = match[1] ?? '';
  const integerPart = match[2] ?? '0';
  const fractionalPart = match[3] ?? '';
  const tenthsDigit = fractionalPart[0] ?? '0';
  return `${sign}${integerPart}.${tenthsDigit}${digit}`;
}
