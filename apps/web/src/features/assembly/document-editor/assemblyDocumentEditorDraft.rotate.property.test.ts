import fc from 'fast-check';
import { expect, it } from 'vitest';

import { createOverlayForRange, rotateImageOverlay } from './assemblyDocumentEditorDraft';

it('keeps rotated boxes inside the page and preserves their rotated physical aspect ratio', () => {
  const side = fc.integer({ min: 1, max: 100 }).map(value => value / 100);
  fc.assert(fc.property(side, side, side, side, fc.integer({ min: 1, max: 30 }), (w, h, x, y, aspectStep) => {
    const pageAspect = aspectStep / 10;
    const photo = createOverlayForRange('IMAGE', 0, { xRatio: x * (1 - w), yRatio: y * (1 - h), widthRatio: w, heightRatio: h });
    const [rotated] = rotateImageOverlay([photo], photo.id, 'right', new Map([[photo.id, 'rotated']]), pageAspect);
    const { xRatio, yRatio, widthRatio, heightRatio } = rotated.bbox;
    expect(xRatio).toBeGreaterThanOrEqual(0);
    expect(yRatio).toBeGreaterThanOrEqual(0);
    expect(xRatio + widthRatio).toBeLessThanOrEqual(1);
    expect(yRatio + heightRatio).toBeLessThanOrEqual(1);
    expect(widthRatio * pageAspect / heightRatio).toBeCloseTo(h / (w * pageAspect), 10);
  }));
});
