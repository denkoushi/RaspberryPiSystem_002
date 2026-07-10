import type { InspectionDrawingPoint } from './types';

/** 指差し先端が描画可能か（両 tip が有限かつ 0–1） */
export function inspectionDrawingPointHasCalloutTip(
  point: Pick<InspectionDrawingPoint, 'calloutTipXRatio' | 'calloutTipYRatio'>
): boolean {
  const x = point.calloutTipXRatio;
  const y = point.calloutTipYRatio;
  return (
    typeof x === 'number' &&
    typeof y === 'number' &&
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    x <= 1 &&
    y >= 0 &&
    y <= 1
  );
}

export function clearInspectionDrawingCalloutTip(): Pick<
  InspectionDrawingPoint,
  'calloutTipXRatio' | 'calloutTipYRatio'
> {
  return { calloutTipXRatio: null, calloutTipYRatio: null };
}

export function setInspectionDrawingCalloutTip(
  xRatio: number,
  yRatio: number
): Pick<InspectionDrawingPoint, 'calloutTipXRatio' | 'calloutTipYRatio'> {
  return {
    calloutTipXRatio: Math.min(1, Math.max(0, xRatio)),
    calloutTipYRatio: Math.min(1, Math.max(0, yRatio))
  };
}
