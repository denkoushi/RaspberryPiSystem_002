/** 図面キャンバスの表示倍率（1 = ビューポートにフィット） */
export const INSPECTION_DRAWING_ZOOM_MIN = 0.5;
export const INSPECTION_DRAWING_ZOOM_MAX = 2.5;
export const INSPECTION_DRAWING_ZOOM_STEP = 0.25;
export const INSPECTION_DRAWING_ZOOM_DEFAULT = 1;

export function clampInspectionDrawingZoom(value: number): number {
  return Math.min(INSPECTION_DRAWING_ZOOM_MAX, Math.max(INSPECTION_DRAWING_ZOOM_MIN, value));
}

export function stepInspectionDrawingZoom(current: number, delta: number): number {
  return clampInspectionDrawingZoom(
    Math.round((current + delta) / INSPECTION_DRAWING_ZOOM_STEP) * INSPECTION_DRAWING_ZOOM_STEP
  );
}
