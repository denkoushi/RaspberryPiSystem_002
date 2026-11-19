import fc from 'fast-check';
import { expect, it } from 'vitest';

import { createOverlayForRange, overlayDraftReducer } from './assemblyDocumentEditorDraft';

import type { AssemblyProcedureOverlayBBox } from '@raspi-system/shared-types';

const photoBox = { xRatio: 0.25, yRatio: 0.25, widthRatio: 0.25, heightRatio: 0.25 };
const patchBox = { xRatio: 0.3, yRatio: 0.3, widthRatio: 0.1, heightRatio: 0.08 };
const textBox = { xRatio: 0.32, yRatio: 0.32, widthRatio: 0.12, heightRatio: 0.05 };
const photo = { ...createOverlayForRange('IMAGE', 0, photoBox), id: 'photo', zIndex: 0 };
const patch = { ...createOverlayForRange('IMAGE', 0, patchBox), id: 'text-erase-patch', zIndex: 1, objectFit: 'fill' as const };
const text = { ...createOverlayForRange('TEXT', 0, textBox), id: 'rewrite', zIndex: 2 };
const elements = [photo, patch, text];

function expectBBoxClose(actual: AssemblyProcedureOverlayBBox, expected: AssemblyProcedureOverlayBBox) {
  expect(actual.xRatio).toBeCloseTo(expected.xRatio, 12);
  expect(actual.yRatio).toBeCloseTo(expected.yRatio, 12);
  expect(actual.widthRatio).toBeCloseTo(expected.widthRatio, 12);
  expect(actual.heightRatio).toBeCloseTo(expected.heightRatio, 12);
}

it('reverses an unclamped nudge for the photo and its attachments', () => {
  const delta = fc.integer({ min: -150, max: 150 }).map(value => value / 1000);
  fc.assert(fc.property(delta, delta, (dxRatio, dyRatio) => {
    const moved = overlayDraftReducer(elements, { type: 'nudge', id: photo.id, dxRatio, dyRatio });
    expect(moved[1].bbox.xRatio).toBeCloseTo(patchBox.xRatio + dxRatio, 12);
    expect(moved[2].bbox.yRatio).toBeCloseTo(textBox.yRatio + dyRatio, 12);
    const restored = overlayDraftReducer(moved, { type: 'nudge', id: photo.id, dxRatio: -dxRatio, dyRatio: -dyRatio });
    restored.forEach((element, index) => expectBBoxClose(element.bbox, elements[index].bbox));
  }));
});

it('preserves local coordinates and scales the page-relative font under an unclamped resize', () => {
  const scale = fc.integer({ min: 50, max: 200 }).map(value => value / 100);
  fc.assert(fc.property(scale, scale, (sx, sy) => {
    const resizedPhoto = { ...photo, bbox: {
      ...photoBox, widthRatio: photoBox.widthRatio * sx, heightRatio: photoBox.heightRatio * sy
    } };
    const [parent, ...attached] = overlayDraftReducer(elements, { type: 'update', element: resizedPhoto });
    const local = (box: AssemblyProcedureOverlayBBox, root: AssemblyProcedureOverlayBBox) => ({
      xRatio: (box.xRatio - root.xRatio) / root.widthRatio,
      yRatio: (box.yRatio - root.yRatio) / root.heightRatio,
      widthRatio: box.widthRatio / root.widthRatio,
      heightRatio: box.heightRatio / root.heightRatio
    });
    attached.forEach((element, index) => expectBBoxClose(local(element.bbox, parent.bbox), local(elements[index + 1].bbox, photoBox)));
    expect(attached[1]).toMatchObject({ style: { fontSizeRatio: expect.closeTo(0.025 * sx, 12) } });
  }));
});
