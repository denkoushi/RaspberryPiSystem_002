import fc from 'fast-check';
import { expect, it } from 'vitest';

import { createOverlayForRange, shiftOverlayPages } from './assemblyDocumentEditorDraft';

it('keeps overlays on their original pages when an inserted range is removed', () => {
  fc.assert(fc.property(
    fc.array(fc.nat(50)), fc.integer({ min: -1, max: 50 }), fc.integer({ min: 1, max: 50 }),
    (indexes, afterPageIndex, pageCount) => {
      const bbox = { xRatio: 0, yRatio: 0, widthRatio: 0.5, heightRatio: 0.5 };
      const overlays = indexes.map(pageIndex => createOverlayForRange('TEXT', pageIndex, bbox));
      const shifted = shiftOverlayPages(overlays, afterPageIndex, pageCount);
      expect(shifted).toHaveLength(overlays.length);
      expect(shifted.filter(element => element.pageIndex > afterPageIndex && element.pageIndex <= afterPageIndex + pageCount)).toEqual([]);
      expect(shiftOverlayPages(shifted, afterPageIndex + pageCount, -pageCount)).toEqual(overlays);
    }
  ));
});
