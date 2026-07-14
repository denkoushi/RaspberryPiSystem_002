import { describe, expect, it } from 'vitest';

import {
  areZoomedImageCanvasLayoutsEqual,
  computeZoomedImageCanvasLayout,
  pointerClientToZoomedImageRatios,
  shouldConfirmImageCanvasTap,
  stepImageCanvasZoom
} from './imageCanvasModel';

describe('domain-neutral image canvas model', () => {
  it('steps and clamps zoom between 0.5 and 2.5', () => {
    expect(stepImageCanvasZoom(1, 0.25)).toBe(1.25);
    expect(stepImageCanvasZoom(2.5, 0.25)).toBe(2.5);
    expect(stepImageCanvasZoom(0.5, -0.25)).toBe(0.5);
  });

  it('uses drawable dimensions instead of CSS transforms and preserves ratios with scroll', () => {
    const layout = computeZoomedImageCanvasLayout(800, 600, 1600, 900, 2);
    expect(layout).toMatchObject({ contentWidth: 1600, contentHeight: 900 });
    const ratios = pointerClientToZoomedImageRatios(
      400,
      300,
      { left: 0, top: 0 } as DOMRect,
      400,
      150,
      layout!
    );
    expect(ratios).toEqual({ xRatio: 0.5, yRatio: 0.5 });
  });

  it('treats equivalent ResizeObserver layouts as equal and 10px movement as a drag', () => {
    const layout = computeZoomedImageCanvasLayout(800, 600, 1600, 900, 1);
    expect(areZoomedImageCanvasLayoutsEqual(layout, structuredClone(layout))).toBe(true);
    expect(shouldConfirmImageCanvasTap(9.99)).toBe(true);
    expect(shouldConfirmImageCanvasTap(10)).toBe(false);
  });
});
