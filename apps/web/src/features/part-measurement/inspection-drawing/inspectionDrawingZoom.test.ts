import { describe, expect, it } from 'vitest';

import {
  clampInspectionDrawingZoom,
  INSPECTION_DRAWING_ZOOM_DEFAULT,
  INSPECTION_DRAWING_ZOOM_MAX,
  INSPECTION_DRAWING_ZOOM_MIN,
  INSPECTION_DRAWING_ZOOM_STEP,
  resolveInspectionDrawingZoomFromDefaultSteps,
  stepInspectionDrawingZoom
} from './inspectionDrawingZoom';

describe('inspectionDrawingZoom', () => {
  it('clamps to min and max', () => {
    expect(clampInspectionDrawingZoom(0.1)).toBe(INSPECTION_DRAWING_ZOOM_MIN);
    expect(clampInspectionDrawingZoom(9)).toBe(INSPECTION_DRAWING_ZOOM_MAX);
  });

  it('steps in 0.25 increments', () => {
    expect(stepInspectionDrawingZoom(1, 0.25)).toBe(1.25);
    expect(stepInspectionDrawingZoom(1, -0.25)).toBe(0.75);
  });

  it('resolveInspectionDrawingZoomFromDefaultSteps advances from default by step count', () => {
    expect(resolveInspectionDrawingZoomFromDefaultSteps(0)).toBe(INSPECTION_DRAWING_ZOOM_DEFAULT);
    expect(resolveInspectionDrawingZoomFromDefaultSteps(2)).toBe(
      INSPECTION_DRAWING_ZOOM_DEFAULT + 2 * INSPECTION_DRAWING_ZOOM_STEP
    );
    expect(resolveInspectionDrawingZoomFromDefaultSteps(2)).toBe(1.5);
  });
});
