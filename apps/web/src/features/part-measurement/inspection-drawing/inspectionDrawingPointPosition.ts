import type { InspectionDrawingPoint } from './types';

/** 1 押しあたりの ratio 移動量（800x600 DEV 図面で約横 2px / 縦 1.5px 相当） */
export const INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO = 0.0025;

export type InspectionDrawingNudgeDirection = 'up' | 'down' | 'left' | 'right';

/**
 * 図面座標 ratio を 0..1 に収める。
 * 有限 number 以外（NaN / Infinity / 非 number）は 0 に丸める。
 */
export function clampInspectionDrawingRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

const NUDGE_DELTA: Record<
  InspectionDrawingNudgeDirection,
  { dx: number; dy: number }
> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 }
};

/**
 * 測定点を指定方向へ stepRatio だけ移動した新しい点を返す（元 point は mutate しない）。
 */
export function nudgeInspectionDrawingPoint(
  point: InspectionDrawingPoint,
  direction: InspectionDrawingNudgeDirection,
  stepRatio: number = INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO
): InspectionDrawingPoint {
  const { dx, dy } = NUDGE_DELTA[direction];
  return {
    ...point,
    xRatio: clampInspectionDrawingRatio(point.xRatio + dx * stepRatio),
    yRatio: clampInspectionDrawingRatio(point.yRatio + dy * stepRatio)
  };
}

/** onChange 用の clamp 済み座標 patch */
export function inspectionDrawingPointPositionPatch(
  point: InspectionDrawingPoint,
  direction: InspectionDrawingNudgeDirection,
  stepRatio: number = INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO
): Pick<InspectionDrawingPoint, 'xRatio' | 'yRatio'> {
  const next = nudgeInspectionDrawingPoint(point, direction, stepRatio);
  return { xRatio: next.xRatio, yRatio: next.yRatio };
}
