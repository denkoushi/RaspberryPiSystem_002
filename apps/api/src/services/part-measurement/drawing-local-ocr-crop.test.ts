import { describe, expect, it } from 'vitest';

import { listLocalOcrRects } from './drawing-local-ocr-crop.js';

describe('listLocalOcrRects', () => {
  it('returns a single centered ROI by default', () => {
    const rects = listLocalOcrRects({
      xRatio: 0.5,
      yRatio: 0.5,
      depthSearch: false,
      imageWidth: 1000,
      imageHeight: 800
    });
    expect(rects).toHaveLength(1);
    expect(rects[0]?.width).toBeGreaterThan(40);
  });

  it('adds annulus ROIs when depthSearch is enabled', () => {
    const rects = listLocalOcrRects({
      xRatio: 0.4,
      yRatio: 0.4,
      depthSearch: true,
      imageWidth: 1000,
      imageHeight: 800
    });
    expect(rects.length).toBeGreaterThan(1);
    expect(rects.length).toBeLessThanOrEqual(3);
  });
});
