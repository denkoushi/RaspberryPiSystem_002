import {
  IMAGE_MARKER_NUDGE_STEP_RATIO,
  clampImageMarkerRatio,
  imageMarkerPositionPatch,
  nudgeImageMarkerPosition
} from '../../kiosk/image-canvas';

import type { InspectionDrawingPoint } from './types';
import type { ImageMarkerNudgeDirection } from '../../kiosk/image-canvas';

/** @deprecated 共通 image-canvas の固定値を互換公開する。 */
export const INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO = IMAGE_MARKER_NUDGE_STEP_RATIO;

/** @deprecated 共通 image-canvas 型を互換公開する。 */
export type InspectionDrawingNudgeDirection = ImageMarkerNudgeDirection;

/** @deprecated 共通 image-canvas の clamp を互換公開する。 */
export const clampInspectionDrawingRatio = clampImageMarkerRatio;

/** 測定点を移動する既存公開名。内部では汎用座標演算へ委譲する。 */
export function nudgeInspectionDrawingPoint(
  point: InspectionDrawingPoint,
  direction: InspectionDrawingNudgeDirection,
  stepRatio: number = INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO
): InspectionDrawingPoint {
  return nudgeImageMarkerPosition(point, direction, stepRatio);
}

/** onChange 用の clamp 済み座標 patch。 */
export function inspectionDrawingPointPositionPatch(
  point: InspectionDrawingPoint,
  direction: InspectionDrawingNudgeDirection,
  stepRatio: number = INSPECTION_DRAWING_POINT_NUDGE_STEP_RATIO
): Pick<InspectionDrawingPoint, 'xRatio' | 'yRatio'> {
  return imageMarkerPositionPatch(point, direction, stepRatio);
}
