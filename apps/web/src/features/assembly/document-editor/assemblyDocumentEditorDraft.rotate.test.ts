import { describe, expect, it } from 'vitest';

import { createOverlayForRange, rotateImageOverlay } from './assemblyDocumentEditorDraft';

import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

const photoBox = { xRatio: 0.25, yRatio: 0.25, widthRatio: 0.5, heightRatio: 0.375 };
const patchBox = { xRatio: 0.5, yRatio: 0.3125, widthRatio: 0.125, heightRatio: 0.0625 };
const photo = { ...createOverlayForRange('IMAGE', 0, photoBox), id: 'photo', assetId: 'old-photo', objectFit: 'cover' as const };
const patch = { ...createOverlayForRange('IMAGE', 0, patchBox), id: 'text-erase-patch', assetId: 'old-patch', zIndex: 1 };
const text = { ...createOverlayForRange('TEXT', 0, { ...patchBox, xRatio: 0.515625 }), id: 'text', zIndex: 2 };
const newAssetIds = new Map([[photo.id, 'rotated-photo'], [patch.id, 'rotated-patch']]);

describe('rotateImageOverlay', () => {
  it.each([
    ['left', 0.25, 0.375],
    ['right', 0.625, 0.4375]
  ] as const)('rotates %s on a portrait page and centers rewrite text over its rotated patch', (direction, xRatio, yRatio) => {
    const unrelated = { ...text, id: 'ordinary', bbox: { ...text.bbox, xRatio: 0.25 } };
    const [rotatedPhoto, rotatedPatch, movedText, unchanged] = rotateImageOverlay([photo, patch, text, unrelated], photo.id, direction, newAssetIds, 0.5);
    expect(rotatedPhoto).toEqual({ ...photo, assetId: 'rotated-photo', bbox: { xRatio: 0.125, yRatio: 0.3125, widthRatio: 0.75, heightRatio: 0.25 } });
    expect(rotatedPatch).toEqual({ ...patch, assetId: 'rotated-patch', bbox: { xRatio, yRatio, widthRatio: 0.125, heightRatio: 0.0625 } });
    expect(movedText).toEqual({ ...text, bbox: { ...text.bbox, xRatio, yRatio } });
    expect(unchanged).toBe(unrelated);
  });

  it('shifts a rotated box off the edge without shrinking when it fits', () => {
    const atEdge = { ...photo, bbox: { ...photo.bbox, xRatio: 0 } };
    const [rotated] = rotateImageOverlay([atEdge], photo.id, 'right', newAssetIds, 0.5);
    expect(rotated.bbox).toEqual({ xRatio: 0, yRatio: 0.3125, widthRatio: 0.75, heightRatio: 0.25 });
  });

  it('shrinks a rotated box uniformly when it is too wide for the page', () => {
    const tooTall = { ...photo, bbox: { ...photo.bbox, yRatio: 0, heightRatio: 1 } };
    const [rotated] = rotateImageOverlay([tooTall], photo.id, 'right', newAssetIds, 0.5);
    expect(rotated.bbox).toEqual({ xRatio: 0, yRatio: 0.4375, widthRatio: 1, heightRatio: 0.125 });
  });

  it('keeps text centered on the patch at a page edge', () => {
    const edgePhoto = { ...photo, bbox: { xRatio: 0, yRatio: 0, widthRatio: 0.5, heightRatio: 0.5 } };
    const edgePatch = { ...patch, bbox: { xRatio: 0.375, yRatio: 0.375, widthRatio: 0.125, heightRatio: 0.125 } };
    const edgeText = { ...text, bbox: { ...edgePatch.bbox, xRatio: 0.3125, widthRatio: 0.25 } };
    const [, rotatedPatch, movedText] = rotateImageOverlay([edgePhoto, edgePatch, edgeText], photo.id, 'right', newAssetIds, 1);
    expect(movedText.bbox).toEqual(rotatedPatch.bbox);
    expect(movedText).toMatchObject({ style: edgeText.style });
  });

  it('returns to the original bounds after four unclamped right turns', () => {
    let elements: AssemblyProcedureOverlayElement[] = [photo];
    for (let turn = 0; turn < 4; turn += 1) {
      elements = rotateImageOverlay(elements, photo.id, 'right', newAssetIds, 0.5);
    }
    expect(elements[0].bbox).toEqual(photo.bbox);
  });

  it('keeps the entire group when a rotated asset is missing', () => {
    const elements = [photo, patch, text];
    expect(rotateImageOverlay(elements, photo.id, 'right', new Map([[photo.id, 'new']]), 1)).toBe(elements);
  });
});
