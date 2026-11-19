import fc from 'fast-check';
import { expect, it } from 'vitest';

import { createOverlayForRange, moveOverlayPage, shiftOverlayPages } from './assemblyDocumentEditorDraft';

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

it('reorders overlay pages exactly like removing and reinserting a page', () => {
  fc.assert(fc.property(fc.nat(50), fc.nat(50), (from, to) => {
    const bbox = { xRatio: 0, yRatio: 0, widthRatio: 0.5, heightRatio: 0.5 };
    const overlays = Array.from({ length: 51 }, (_, index) => createOverlayForRange('TEXT', index, bbox));
    const ordered = [...overlays];
    const [source] = ordered.splice(from, 1);
    ordered.splice(to, 0, source);
    const moved = moveOverlayPage(overlays, from, to);
    expect(moved.every(element => ordered[element.pageIndex].id === element.id)).toBe(true);
    expect(moveOverlayPage(moved, to, from)).toEqual(overlays);
  }));
});
