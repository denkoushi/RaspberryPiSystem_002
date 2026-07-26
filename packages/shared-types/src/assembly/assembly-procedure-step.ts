export const ASSEMBLY_PROCEDURE_STEP_MAX_COUNT = 300;
export const ASSEMBLY_PROCEDURE_STEP_TITLE_MAX_LENGTH = 120;
export const ASSEMBLY_PROCEDURE_STEP_INSTRUCTION_MAX_LENGTH = 1_000;
export const ASSEMBLY_PROCEDURE_CROP_MIN_RATIO = 0.02;
export const ASSEMBLY_PROCEDURE_CROP_NUDGE_RATIO = 0.0025;

export const ASSEMBLY_PROCEDURE_STEP_VIEW_MODES = ['FULL_PAGE', 'CROP'] as const;
export type AssemblyProcedureStepViewMode =
  (typeof ASSEMBLY_PROCEDURE_STEP_VIEW_MODES)[number];

export const ASSEMBLY_PROCEDURE_STEP_EMPHASES = [
  'NORMAL',
  'IMPORTANT',
  'CAUTION'
] as const;
export type AssemblyProcedureStepEmphasis =
  (typeof ASSEMBLY_PROCEDURE_STEP_EMPHASES)[number];

export type AssemblyProcedurePoint = {
  xRatio: number;
  yRatio: number;
};

export type AssemblyProcedureCropRect = {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
};

export type AssemblyProcedureLine = {
  start: AssemblyProcedurePoint;
  end: AssemblyProcedurePoint;
};

const RATIO_EPSILON = 1e-9;

export function clampAssemblyProcedureRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizeAssemblyProcedureCropRect(
  start: AssemblyProcedurePoint,
  end: AssemblyProcedurePoint,
  minimumRatio = ASSEMBLY_PROCEDURE_CROP_MIN_RATIO
): AssemblyProcedureCropRect {
  const minimum = Math.min(1, Math.max(0, minimumRatio));
  const left = clampAssemblyProcedureRatio(Math.min(start.xRatio, end.xRatio));
  const top = clampAssemblyProcedureRatio(Math.min(start.yRatio, end.yRatio));
  const right = clampAssemblyProcedureRatio(Math.max(start.xRatio, end.xRatio));
  const bottom = clampAssemblyProcedureRatio(Math.max(start.yRatio, end.yRatio));
  const widthRatio = Math.min(1, Math.max(minimum, right - left));
  const heightRatio = Math.min(1, Math.max(minimum, bottom - top));
  return {
    xRatio: Math.min(left, 1 - widthRatio),
    yRatio: Math.min(top, 1 - heightRatio),
    widthRatio,
    heightRatio
  };
}

export function isValidAssemblyProcedureCropRect(
  crop: AssemblyProcedureCropRect,
  minimumRatio = ASSEMBLY_PROCEDURE_CROP_MIN_RATIO
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

export function isAssemblyProcedurePointInCrop(
  point: AssemblyProcedurePoint,
  crop: AssemblyProcedureCropRect
): boolean {
  return (
    point.xRatio + RATIO_EPSILON >= crop.xRatio &&
    point.yRatio + RATIO_EPSILON >= crop.yRatio &&
    point.xRatio <= crop.xRatio + crop.widthRatio + RATIO_EPSILON &&
    point.yRatio <= crop.yRatio + crop.heightRatio + RATIO_EPSILON
  );
}

export function sourcePointToAssemblyProcedureCropPoint(
  point: AssemblyProcedurePoint,
  crop: AssemblyProcedureCropRect
): AssemblyProcedurePoint {
  return {
    xRatio: (point.xRatio - crop.xRatio) / crop.widthRatio,
    yRatio: (point.yRatio - crop.yRatio) / crop.heightRatio
  };
}

export function cropPointToAssemblyProcedureSourcePoint(
  point: AssemblyProcedurePoint,
  crop: AssemblyProcedureCropRect
): AssemblyProcedurePoint {
  return {
    xRatio: crop.xRatio + point.xRatio * crop.widthRatio,
    yRatio: crop.yRatio + point.yRatio * crop.heightRatio
  };
}

/**
 * Clips a source-page line to a crop rectangle and converts the surviving
 * segment into crop-local ratios. Returns null when the line misses the crop.
 */
export function clipAssemblyProcedureLineToCrop(
  line: AssemblyProcedureLine,
  crop: AssemblyProcedureCropRect
): AssemblyProcedureLine | null {
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
  const localStart = sourcePointToAssemblyProcedureCropPoint(
      {
        xRatio: line.start.xRatio + entering * dx,
        yRatio: line.start.yRatio + entering * dy
      },
      crop
    );
  const localEnd = sourcePointToAssemblyProcedureCropPoint(
      {
        xRatio: line.start.xRatio + leaving * dx,
        yRatio: line.start.yRatio + leaving * dy
      },
      crop
    );
  return {
    start: {
      xRatio: clampAssemblyProcedureRatio(localStart.xRatio),
      yRatio: clampAssemblyProcedureRatio(localStart.yRatio)
    },
    end: {
      xRatio: clampAssemblyProcedureRatio(localEnd.xRatio),
      yRatio: clampAssemblyProcedureRatio(localEnd.yRatio)
    }
  };
}
