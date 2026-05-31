import type { ZoomedCanvasLayout } from './inspectionDrawingCanvasLayout';

function near(a: number, b: number, epsilonPx: number): boolean {
  return Math.abs(a - b) <= epsilonPx;
}

/**
 * ResizeObserver の連続発火で同じ寸法の layout へ再 setState しないための比較。
 */
export function areZoomedCanvasLayoutsEqual(
  a: ZoomedCanvasLayout | null,
  b: ZoomedCanvasLayout | null,
  epsilonPx = 0.5
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    near(a.contentWidth, b.contentWidth, epsilonPx) &&
    near(a.contentHeight, b.contentHeight, epsilonPx) &&
    near(a.image.width, b.image.width, epsilonPx) &&
    near(a.image.height, b.image.height, epsilonPx) &&
    near(a.image.offsetX, b.image.offsetX, epsilonPx) &&
    near(a.image.offsetY, b.image.offsetY, epsilonPx)
  );
}
