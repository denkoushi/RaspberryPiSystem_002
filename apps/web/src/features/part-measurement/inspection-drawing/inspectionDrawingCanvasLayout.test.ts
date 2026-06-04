import { describe, expect, it } from 'vitest';

import {
  computeScrollToCenterMarker,
  computeZoomedCanvasLayout,
  pointerClientToImageRatios,
  zoomedLayoutMatchesCanvasZoom
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

  it('zoomedLayoutMatchesCanvasZoom is false for stale layout at different zoom', () => {
    const atOne = computeZoomedCanvasLayout(800, 600, 1600, 1200, 1)!;
    expect(zoomedLayoutMatchesCanvasZoom(atOne, 800, 600, 1600, 1200, 1.5)).toBe(false);
    const atOneFive = computeZoomedCanvasLayout(800, 600, 1600, 1200, 1.5)!;
    expect(zoomedLayoutMatchesCanvasZoom(atOneFive, 800, 600, 1600, 1200, 1.5)).toBe(true);
  });

  describe('guided self-inspection zoom 2.0 (regression)', () => {
    const guidedZoom = 2;

    it('at zoom 2.0 expands content for guided centering', () => {
      const layout = computeZoomedCanvasLayout(800, 600, 1600, 1200, guidedZoom);
      expect(layout!.image.width).toBe(1600);
      expect(layout!.image.height).toBe(1200);
      expect(layout!.contentWidth).toBe(1600);
      expect(layout!.contentHeight).toBe(1200);
    });

    it('zoomedLayoutMatchesCanvasZoom at 2.0', () => {
      const atTwo = computeZoomedCanvasLayout(800, 600, 1600, 1200, guidedZoom)!;
      expect(zoomedLayoutMatchesCanvasZoom(atTwo, 800, 600, 1600, 1200, guidedZoom)).toBe(true);
      expect(zoomedLayoutMatchesCanvasZoom(atTwo, 800, 600, 1600, 1200, 1.5)).toBe(false);
    });

    it('computeScrollToCenterMarker centers marker at viewport middle at 2.0', () => {
      const layout = computeZoomedCanvasLayout(800, 600, 1600, 1200, guidedZoom)!;
      const scroll = computeScrollToCenterMarker({
        layout,
        xRatio: 0.5,
        yRatio: 0.5,
        viewportWidth: 800,
        viewportHeight: 600
      });
      expect(scroll.scrollLeft).toBe(400);
      expect(scroll.scrollTop).toBe(300);
    });
  });

  it('computeScrollToCenterMarker centers marker at viewport middle', () => {
    const layout = computeZoomedCanvasLayout(800, 600, 1600, 1200, 1.5)!;
    const scroll = computeScrollToCenterMarker({
      layout,
      xRatio: 0.5,
      yRatio: 0.5,
      viewportWidth: 800,
      viewportHeight: 600
    });
    expect(scroll.scrollLeft).toBe(200);
    expect(scroll.scrollTop).toBe(150);
  });

  it('computeScrollToCenterMarker clamps when image smaller than viewport', () => {
    const layout = computeZoomedCanvasLayout(1000, 800, 400, 300, 1)!;
    const scroll = computeScrollToCenterMarker({
      layout,
      xRatio: 0.5,
      yRatio: 0.5,
      viewportWidth: 1000,
      viewportHeight: 800
    });
    expect(scroll.scrollLeft).toBe(0);
    expect(scroll.scrollTop).toBe(0);
  });

  it('returns null for pointer outside image', () => {
    const layout = computeZoomedCanvasLayout(1000, 600, 1600, 1200, 1)!;
    expect(
      pointerClientToImageRatios(10, 10, new DOMRect(0, 0, 1000, 600), 0, 0, layout)
    ).toBeNull();
  });
});
