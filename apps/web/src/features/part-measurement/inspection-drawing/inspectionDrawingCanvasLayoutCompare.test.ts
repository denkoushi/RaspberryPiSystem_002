import { describe, expect, it } from 'vitest';

import { computeZoomedCanvasLayout } from './inspectionDrawingCanvasLayout';
import { areZoomedCanvasLayoutsEqual } from './inspectionDrawingCanvasLayoutCompare';

describe('areZoomedCanvasLayoutsEqual', () => {
  const layout800x600 = computeZoomedCanvasLayout(800, 600, 1600, 1200, 1.5)!;

  it('returns true for identical layouts', () => {
    const other = computeZoomedCanvasLayout(800, 600, 1600, 1200, 1.5)!;
    expect(areZoomedCanvasLayoutsEqual(layout800x600, other)).toBe(true);
  });

  it('returns false when zoom differs', () => {
    const at125 = computeZoomedCanvasLayout(800, 600, 1600, 1200, 1.25)!;
    expect(areZoomedCanvasLayoutsEqual(layout800x600, at125)).toBe(false);
  });

  it('returns false when one side is null', () => {
    expect(areZoomedCanvasLayoutsEqual(layout800x600, null)).toBe(false);
    expect(areZoomedCanvasLayoutsEqual(null, null)).toBe(true);
  });

  it('treats sub-pixel differences within epsilon as equal', () => {
    const tweaked = {
      ...layout800x600,
      contentWidth: layout800x600.contentWidth + 0.3,
      image: {
        ...layout800x600.image,
        width: layout800x600.image.width + 0.2
      }
    };
    expect(areZoomedCanvasLayoutsEqual(layout800x600, tweaked, 0.5)).toBe(true);
    expect(areZoomedCanvasLayoutsEqual(layout800x600, tweaked, 0.1)).toBe(false);
  });
});
