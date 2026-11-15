import { describe, expect, it } from 'vitest';

import { centerMaterialBBox, snapOverlayBBox } from './overlaySnap';

const bbox = { xRatio: 0.103, yRatio: 0.202, widthRatio: 0.2, heightRatio: 0.2 };
const viewport = { width: 1000, height: 1000 };
const target = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.4, heightRatio: 0.4 };
describe('snapOverlayBBox', () => {
  it('aligns moving edges and centers to other parts and returns source-coordinate guides', () => {
    const result = snapOverlayBBox({ bbox, targets: [target], viewport });
    expect(result.bbox.xRatio).toBeCloseTo(0.1);
    expect(result.bbox.yRatio).toBeCloseTo(0.2);
    expect(result.guides).toEqual([{ axis: 'x', coordinate: 0.1 }, { axis: 'y', coordinate: 0.2 }]);
    expect(snapOverlayBBox({ bbox: { ...bbox, xRatio: 0.402, yRatio: 0.402 }, targets: [], viewport }).bbox.xRatio).toBeCloseTo(0.4);
  });
  it.each(['nw', 'ne', 'sw', 'se'] as const)('only snaps moving edges for %s', mode => {
    const result = snapOverlayBBox({ bbox, targets: [target], viewport, mode });
    const west = mode.includes('w'), north = mode.includes('n');
    expect(west ? result.bbox.xRatio + result.bbox.widthRatio : result.bbox.xRatio).toBeCloseTo(west ? 0.303 : 0.103);
    expect(north ? result.bbox.yRatio + result.bbox.heightRatio : result.bbox.yRatio).toBeCloseTo(north ? 0.402 : 0.202);
  });
  it('uses displayed pixels after crop and zoom, not source ratios', () => {
    expect(snapOverlayBBox({ bbox, targets: [target], viewport: { width: 2000, height: 2000 }, thresholdPx: 4 }).guides).toEqual([]);
    expect(snapOverlayBBox({ bbox, targets: [target], viewport, crop: { xRatio: 0, yRatio: 0, widthRatio: 0.2, heightRatio: 0.2 } }).guides).toEqual([]);
  });
  it('snaps page edges and keeps the final box within the page', () => {
    const result = snapOverlayBBox({ bbox: { ...bbox, xRatio: 0.798, yRatio: 0.003 }, targets: [], viewport });
    expect(result.bbox.xRatio).toBe(0.8);
    expect(result.bbox.yRatio).toBe(0);
  });
  it('keeps server dimensions, centers at the drop point and clamps at page boundaries', () => {
    expect(centerMaterialBBox({ widthRatio: 0.4, heightRatio: 0.3 }, { xRatio: 0.9, yRatio: 0.01, widthRatio: 0, heightRatio: 0 })).toEqual({ xRatio: 0.6, yRatio: 0, widthRatio: 0.4, heightRatio: 0.3 });
  });
});
