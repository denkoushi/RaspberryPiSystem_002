import { isInspectionDrawingThroughDepthMode } from '@raspi-system/shared-types';

import { isLegacyAbsoluteOnlyPoint } from './markerNumbering';

import type { InspectionDrawingPoint } from './types';

export function formatSignedToleranceOffsetRaw(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '-';
  if (/^[+-]/.test(trimmed)) return trimmed;

  const parsed = Number(trimmed.replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? `+${trimmed}` : trimmed;
}

export function formatToleranceOffsetRangeRaw(lowerRaw: string, upperRaw: string): string {
  return `${formatSignedToleranceOffsetRaw(lowerRaw)}〜${formatSignedToleranceOffsetRaw(upperRaw)}`;
}

export function formatInspectionDrawingToleranceDisplay(
  point: InspectionDrawingPoint,
  options: { includeLegacyReason?: boolean } = {}
): string {
  if (isInspectionDrawingThroughDepthMode(point.depthMode)) {
    return '通し';
  }
  if (isLegacyAbsoluteOnlyPoint(point) && point.legacyAbsoluteBounds) {
    const { lowerLimit, upperLimit } = point.legacyAbsoluteBounds;
    const reason = options.includeLegacyReason ? '（基準値未設定）' : '';
    return `合格範囲 ${lowerLimit}〜${upperLimit}${reason}`;
  }

  const nominal = point.nominalRaw.trim();
  const lower = point.lowerToleranceRaw.trim();
  const upper = point.upperToleranceRaw.trim();
  if (!nominal && !lower && !upper) return '-';
  return `基準 ${nominal || '-'} / ${formatToleranceOffsetRangeRaw(lower, upper)}`;
}
