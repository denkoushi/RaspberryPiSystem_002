import {
  clearImageMarkerCalloutTip,
  imageMarkerHasCalloutTip,
  setImageMarkerCalloutTip
} from '../../kiosk/image-canvas';

import type { InspectionDrawingCalloutDim, InspectionDrawingPoint } from './types';

/** 指差し先端が描画可能か（両 tip が有限かつ 0–1） */
export function inspectionDrawingPointHasCalloutTip(
  point: Pick<InspectionDrawingPoint, 'calloutTipXRatio' | 'calloutTipYRatio'>
): boolean {
  return imageMarkerHasCalloutTip(point);
}

export function clearInspectionDrawingCalloutTip(): Pick<
  InspectionDrawingPoint,
  'calloutTipXRatio' | 'calloutTipYRatio' | 'calloutDims'
> {
  return { ...clearImageMarkerCalloutTip(), calloutDims: [] };
}

export function removeInspectionDrawingCalloutDim(
  dims: readonly InspectionDrawingCalloutDim[] | undefined,
  dir: InspectionDrawingCalloutDim['dir']
): InspectionDrawingCalloutDim[] {
  return (dims ?? []).filter((dim) => dim.dir !== dir);
}

export function setInspectionDrawingCalloutTip(
  xRatio: number,
  yRatio: number
): Pick<InspectionDrawingPoint, 'calloutTipXRatio' | 'calloutTipYRatio'> {
  return setImageMarkerCalloutTip(xRatio, yRatio);
}
