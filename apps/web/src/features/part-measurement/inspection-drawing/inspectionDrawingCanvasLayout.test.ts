import { describe, expect, it } from 'vitest';

import {
  computeZoomedCanvasLayout,
  pointerClientToImageRatios
} from './inspectionDrawingCanvasLayout';

describe('computeZoomedCanvasLayout', () => {
  it('at zoom 1 centers image in viewport like object-contain', () => {
    const layout = computeZoomedCanvasLayout(800, 600, 1600, 1200, 1);
    expect(layout).not.toBeNull();
    expect(layout!.contentWidth).toBe(800);
    expect(layout!.contentHeight).toBe(600);
    expect(layout!.image.width).toBe(800);
    expect(layout!.image.height).toBe(600);
    expect(layout!.image.offsetX).toBe(0);
    expect(layout!.image.offsetY).toBe(0);
  });

  it('at zoom 1.5 expands content for scrolling (regression: kiosk jitter report)', () => {
    const layout = computeZoomedCanvasLayout(800, 600, 1600, 1200, 1.5);
    expect(layout!.image.width).toBe(1200);
    expect(layout!.image.height).toBe(900);
    expect(layout!.contentWidth).toBe(1200);
    expect(layout!.contentHeight).toBe(900);
  });

  it('at zoom 2 expands content for scrolling without shrinking viewport', () => {
    const layout = computeZoomedCanvasLayout(800, 600, 1600, 1200, 2);
    expect(layout!.image.width).toBe(1600);
    expect(layout!.image.height).toBe(1200);
    expect(layout!.contentWidth).toBe(1600);
    expect(layout!.contentHeight).toBe(1200);
    expect(layout!.image.offsetX).toBe(0);
    expect(layout!.image.offsetY).toBe(0);
  });

  it('maps pointer on image center to ratio 0.5, 0.5', () => {
    const layout = computeZoomedCanvasLayout(800, 600, 1600, 1200, 1)!;
    const ratios = pointerClientToImageRatios(
      400,
      300,
      new DOMRect(0, 0, 800, 600),
      0,
      0,
      layout
    );
    expect(ratios).toEqual({ xRatio: 0.5, yRatio: 0.5 });
  });

  it('returns null for pointer outside image', () => {
    const layout = computeZoomedCanvasLayout(1000, 600, 1600, 1200, 1)!;
    expect(
      pointerClientToImageRatios(10, 10, new DOMRect(0, 0, 1000, 600), 0, 0, layout)
    ).toBeNull();
  });
});
