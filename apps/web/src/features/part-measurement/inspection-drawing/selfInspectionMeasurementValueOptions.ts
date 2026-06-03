import { toleranceBoundsFromPoint } from './markerNumbering';

import type { InspectionDrawingPoint } from './types';

export const SELF_INSPECTION_MEASUREMENT_VALUE_OPTION_MAX = 200;

export type MeasurementValueOptionResult =
  | { mode: 'free_only'; reason?: string }
  | { mode: 'dropdown_and_free'; options: string[]; stepLabel: string };

function decimalPlacesInRaw(raw: string): number {
  const trimmed = raw.trim().replace(/,/g, '');
  if (!trimmed) return 0;
  const dot = trimmed.indexOf('.');
  if (dot < 0) return 0;
  return trimmed.length - dot - 1;
}

function inferStepDecimalPlaces(point: InspectionDrawingPoint, lower: number, upper: number): number {
  let places = Math.max(
    decimalPlacesInRaw(point.lowerToleranceRaw),
    decimalPlacesInRaw(point.upperToleranceRaw)
  );
  if (places === 0) {
    places = Math.max(places, decimalPlacesInRaw(point.nominalRaw), point.decimalPlaces ?? 0);
  }
  if (places === 0) {
    const span = Math.abs(upper - lower);
    if (span > 0 && span < 1) {
      places = 2;
    } else {
      places = 1;
    }
  }
  return Math.min(6, Math.max(0, places));
}

function scaleFromDecimalPlaces(places: number): number {
  return 10 ** places;
}

function formatScaledValue(scaled: number, places: number): string {
  const n = scaled / scaleFromDecimalPlaces(places);
  if (places === 0) return String(n);
  return n.toFixed(places);
}

/** 合格範囲内の測定値候補（整数スケール・decimal-safe） */
export function buildSelfInspectionMeasurementValueOptions(
  point: InspectionDrawingPoint
): MeasurementValueOptionResult {
  const bounds = toleranceBoundsFromPoint(point);
  if ('error' in bounds) {
    return { mode: 'free_only', reason: bounds.error };
  }

  const lower = Math.min(bounds.lowerLimit, bounds.upperLimit);
  const upper = Math.max(bounds.lowerLimit, bounds.upperLimit);
  const places = inferStepDecimalPlaces(point, lower, upper);
  const scale = scaleFromDecimalPlaces(places);
  // 刻み格子のうち [lower, upper] に含まれる値だけ（round だと範囲外が混ざる）
  const start = Math.ceil(lower * scale - 1e-9);
  const end = Math.floor(upper * scale + 1e-9);
  if (start > end) {
    return {
      mode: 'free_only',
      reason: '刻みに合う候補がありません。直接入力してください。'
    };
  }
  const count = end - start + 1;

  if (count > SELF_INSPECTION_MEASUREMENT_VALUE_OPTION_MAX) {
    return {
      mode: 'free_only',
      reason: `候補が多すぎます（${count}件）。直接入力してください。`
    };
  }

  const options: string[] = [];
  for (let scaled = start; scaled <= end; scaled += 1) {
    options.push(formatScaledValue(scaled, places));
  }

  const step = 1 / scale;
  const stepLabel = places === 0 ? '1' : step.toFixed(places);

  return { mode: 'dropdown_and_free', options, stepLabel };
}
