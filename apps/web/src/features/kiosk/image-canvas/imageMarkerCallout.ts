export type ImageMarkerCalloutTip = {
  calloutTipXRatio?: number | null;
  calloutTipYRatio?: number | null;
};

export function imageMarkerHasCalloutTip(marker: ImageMarkerCalloutTip): boolean {
  const x = marker.calloutTipXRatio;
  const y = marker.calloutTipYRatio;
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

export function clearImageMarkerCalloutTip(): Required<ImageMarkerCalloutTip> {
  return { calloutTipXRatio: null, calloutTipYRatio: null };
}

export function setImageMarkerCalloutTip(
  xRatio: number,
  yRatio: number
): Required<ImageMarkerCalloutTip> {
  return {
    calloutTipXRatio: Math.min(1, Math.max(0, xRatio)),
    calloutTipYRatio: Math.min(1, Math.max(0, yRatio))
  };
}
