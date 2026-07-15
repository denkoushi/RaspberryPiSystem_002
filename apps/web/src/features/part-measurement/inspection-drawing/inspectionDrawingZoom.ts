import {
  IMAGE_CANVAS_ZOOM_DEFAULT,
  IMAGE_CANVAS_ZOOM_MAX,
  IMAGE_CANVAS_ZOOM_MIN,
  IMAGE_CANVAS_ZOOM_STEP,
  clampImageCanvasZoom,
  stepImageCanvasZoom
} from '../../kiosk/image-canvas';

export const INSPECTION_DRAWING_ZOOM_MIN = IMAGE_CANVAS_ZOOM_MIN;
export const INSPECTION_DRAWING_ZOOM_MAX = IMAGE_CANVAS_ZOOM_MAX;
export const INSPECTION_DRAWING_ZOOM_STEP = IMAGE_CANVAS_ZOOM_STEP;
export const INSPECTION_DRAWING_ZOOM_DEFAULT = IMAGE_CANVAS_ZOOM_DEFAULT;
export const clampInspectionDrawingZoom = clampImageCanvasZoom;
export const stepInspectionDrawingZoom = stepImageCanvasZoom;

/** fit 基準（{@link INSPECTION_DRAWING_ZOOM_DEFAULT}）から step 数ぶん進めた表示倍率（clamp 済み） */
export function resolveInspectionDrawingZoomFromDefaultSteps(steps: number): number {
  const safeSteps = Math.max(0, Math.floor(steps));
  return stepInspectionDrawingZoom(
    INSPECTION_DRAWING_ZOOM_DEFAULT,
    safeSteps * INSPECTION_DRAWING_ZOOM_STEP
  );
}
