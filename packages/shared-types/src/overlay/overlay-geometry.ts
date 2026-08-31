/** Minimum crop size accepted by overlay/image-region contracts. */
export const OVERLAY_CROP_MIN_RATIO = 0.02;

/** Default amount used when nudging a crop edge. */
export const OVERLAY_CROP_NUDGE_RATIO = 0.0025;

export type OverlayPoint = {
  xRatio: number;
  yRatio: number;
};

export type OverlayCropRect = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type OverlayLine = {
  start: OverlayPoint;
  end: OverlayPoint;
};

const RATIO_EPSILON = 1e-9;

export function clampOverlayRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeOverlayCropRect(
  start: OverlayPoint,
  end: OverlayPoint,
  minimumRatio = OVERLAY_CROP_MIN_RATIO
): OverlayCropRect {
  const minimum = Math.min(1, Math.max(0, minimumRatio));
  const left = clampOverlayRatio(Math.min(start.xRatio, end.xRatio));
  const top = clampOverlayRatio(Math.min(start.yRatio, end.yRatio));
  const right = clampOverlayRatio(Math.max(start.xRatio, end.xRatio));
  const bottom = clampOverlayRatio(Math.max(start.yRatio, end.yRatio));
  const widthRatio = Math.min(1, Math.max(minimum, right - left));
  const heightRatio = Math.min(1, Math.max(minimum, bottom - top));
  return {
    xRatio: Math.min(left, 1 - widthRatio),
    yRatio: Math.min(top, 1 - heightRatio),
    widthRatio,
    heightRatio
  };
}

export function isValidOverlayCropRect(
  crop: OverlayCropRect,
  minimumRatio = OVERLAY_CROP_MIN_RATIO
): boolean {
  const values = [crop.xRatio, crop.yRatio, crop.widthRatio, crop.heightRatio];
  return (
    values.every(Number.isFinite) &&
    crop.xRatio >= 0 &&
    crop.yRatio >= 0 &&
    crop.widthRatio + RATIO_EPSILON >= minimumRatio &&
    crop.heightRatio + RATIO_EPSILON >= minimumRatio &&
    crop.xRatio + crop.widthRatio <= 1 + RATIO_EPSILON &&
    crop.yRatio + crop.heightRatio <= 1 + RATIO_EPSILON
  );
}

export function isOverlayPointInCrop(
  point: OverlayPoint,
  crop: OverlayCropRect
): boolean {
  return (
    point.xRatio + RATIO_EPSILON >= crop.xRatio &&
    point.yRatio + RATIO_EPSILON >= crop.yRatio &&
    point.xRatio <= crop.xRatio + crop.widthRatio + RATIO_EPSILON &&
    point.yRatio <= crop.yRatio + crop.heightRatio + RATIO_EPSILON
  );
}

export function sourcePointToOverlayCropPoint(
  point: OverlayPoint,
  crop: OverlayCropRect
): OverlayPoint {
  return {
    xRatio: (point.xRatio - crop.xRatio) / crop.widthRatio,
    yRatio: (point.yRatio - crop.yRatio) / crop.heightRatio
  };
}

export function cropPointToOverlaySourcePoint(
  point: OverlayPoint,
  crop: OverlayCropRect
): OverlayPoint {
  return {
    xRatio: crop.xRatio + point.xRatio * crop.widthRatio,
    yRatio: crop.yRatio + point.yRatio * crop.heightRatio
  };
}

/**
 * Clips a source-page line to a crop rectangle and converts the surviving
 * segment into crop-local ratios. Returns null when the line misses the crop.
 */
export function clipOverlayLineToCrop(
  line: OverlayLine,
  crop: OverlayCropRect
): OverlayLine | null {
  const dx = line.end.xRatio - line.start.xRatio;
  const dy = line.end.yRatio - line.start.yRatio;
  const p = [-dx, dx, -dy, dy];
  const q = [
    line.start.xRatio - crop.xRatio,
    crop.xRatio + crop.widthRatio - line.start.xRatio,
    line.start.yRatio - crop.yRatio,
    crop.yRatio + crop.heightRatio - line.start.yRatio
  ];
  let entering = 0;
  let leaving = 1;
  for (let index = 0; index < p.length; index += 1) {
    if (Math.abs(p[index]) <= RATIO_EPSILON) {
      if (q[index] < 0) return null;
      continue;
    }
    const ratio = q[index] / p[index];
    if (p[index] < 0) entering = Math.max(entering, ratio);
    else leaving = Math.min(leaving, ratio);
    if (entering - leaving > RATIO_EPSILON) return null;
  }
  const localStart = sourcePointToOverlayCropPoint(
    {
      xRatio: line.start.xRatio + entering * dx,
      yRatio: line.start.yRatio + entering * dy
    },
    crop
  );
  const localEnd = sourcePointToOverlayCropPoint(
    {
      xRatio: line.start.xRatio + leaving * dx,
      yRatio: line.start.yRatio + leaving * dy
    },
    crop
  );
  return {
    start: {
      xRatio: clampOverlayRatio(localStart.xRatio),
      yRatio: clampOverlayRatio(localStart.yRatio)
    },
    end: {
      xRatio: clampOverlayRatio(localEnd.xRatio),
      yRatio: clampOverlayRatio(localEnd.yRatio)
    }
  };
}
