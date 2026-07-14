import { areZoomedImageCanvasLayoutsEqual } from '../../kiosk/image-canvas';

import type { ZoomedCanvasLayout } from './inspectionDrawingCanvasLayout';

/**
 * ResizeObserver の連続発火で同じ寸法の layout へ再 setState しないための比較。
 */
export function areZoomedCanvasLayoutsEqual(
  a: ZoomedCanvasLayout | null,
  b: ZoomedCanvasLayout | null,
  epsilonPx = 0.5
): boolean {
  return areZoomedImageCanvasLayoutsEqual(a, b, epsilonPx);
}
