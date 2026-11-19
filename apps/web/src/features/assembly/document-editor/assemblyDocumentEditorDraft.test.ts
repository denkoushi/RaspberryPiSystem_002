import { describe, expect, it, vi } from 'vitest';

import {
  canPublishAssemblyProcedureDocument,
  convertOverlayShapeKind,
  createDuplicateOverlayAction,
  createOverlayForRange,
  findAttachedOverlayIds,
  lineEndpointsForDirection,
  moveOverlayPage,
  normalizeOverlayBBox,
  overlayDraftReducer,
  overlayDraftSnapshot,
  updateOverlayBBox
} from './assemblyDocumentEditorDraft';
import { historyReducer } from './documentEditorHistory';

import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

const bbox = { xRatio: 0.1, yRatio: 0.2, widthRatio: 0.2, heightRatio: 0.2 };

describe('lineEndpointsForDirection', () => {
  it.each([
    ['up', 0.375, 0.5, 0.375, 0.25],
    ['up-right', 0.125, 0.5, 0.625, 0.25],
    ['right', 0.125, 0.375, 0.625, 0.375],
    ['down-right', 0.125, 0.25, 0.625, 0.5],
    ['down', 0.375, 0.25, 0.375, 0.5],
    ['down-left', 0.625, 0.25, 0.125, 0.5],
    ['left', 0.625, 0.375, 0.125, 0.375],
    ['up-left', 0.625, 0.5, 0.125, 0.25]
  ] as const)('sets %s endpoints without changing the bbox', (direction, startX, startY, endX, endY) => {
    const bounds = Object.freeze({ xRatio: 0.125, yRatio: 0.25, widthRatio: 0.5, heightRatio: 0.25 });
    expect(lineEndpointsForDirection(bounds, direction)).toEqual({
      start: { xRatio: startX, yRatio: startY },
      end: { xRatio: endX, yRatio: endY }
    });
    expect(bounds).toEqual({ xRatio: 0.125, yRatio: 0.25, widthRatio: 0.5, heightRatio: 0.25 });
  });
});

describe('assembly document editor draft reducer', () => {
  it.each(['TEXT', 'IMAGE', 'SHAPE'] as const)('places a new %s above only its own page', kind => {
    const elements = [
      { ...createOverlayForRange('SHAPE', 0, bbox), zIndex: 8 },
      { ...createOverlayForRange('SHAPE', 0, bbox), zIndex: 3 },
      { ...createOverlayForRange('SHAPE', 1, bbox), zIndex: 100 }
    ];
    expect(createOverlayForRange(kind, 0, bbox, elements).zIndex).toBe(9);
    expect(createOverlayForRange(kind, 2, bbox, elements).zIndex).toBe(0);
    const createdWithoutContext = createOverlayForRange(kind, 0, bbox);
    expect(overlayDraftReducer(elements, { type: 'add', element: createdWithoutContext }).at(-1)?.zIndex).toBe(9);
    expect(elements.map(element => element.zIndex)).toEqual([8, 3, 100]);
  });

  it.each(['TEXT', 'IMAGE', 'SHAPE'] as const)('duplicates %s with independent properties and a page-local front z-index', kind => {
    const source = createOverlayForRange(kind, 2, bbox);
    const front = { ...createOverlayForRange('SHAPE', 0, bbox), zIndex: 7 };
    const initial = [source, front];
    const next = overlayDraftReducer(initial, createDuplicateOverlayAction(initial, source.id, 'copy', 0));
    const copy = next[2];
    expect(copy).toEqual({ ...source, id: 'copy', pageIndex: 0, zIndex: 8 });
    expect(next.slice(0, 2)).toEqual(initial);
    expect(copy.bbox).not.toBe(source.bbox);
    copy.bbox.xRatio = 0.4;
    expect(source.bbox.xRatio).toBe(0.1);
    if (copy.kind === 'TEXT' && source.kind === 'TEXT') {
      expect(copy.style).not.toBe(source.style);
      expect(copy.mask).not.toBe(source.mask);
    }
    if (copy.kind === 'IMAGE' && source.kind === 'IMAGE') expect(copy.assetId).toBe(source.assetId);
    expect(overlayDraftReducer(initial, createDuplicateOverlayAction(initial, 'missing', 'none', 0))).toBe(initial);
    expect(overlayDraftReducer([source], createDuplicateOverlayAction([source], source.id, 'empty', 1))[1].zIndex).toBe(0);
  });

  it('starts at zero on an empty page and handles negative existing z-indices', () => {
    const created = createOverlayForRange('SHAPE', 0, bbox);
    expect(overlayDraftReducer([], { type: 'add', element: created })[0].zIndex).toBe(0);
    expect(createOverlayForRange('SHAPE', 0, bbox, [{ ...created, zIndex: -3 }]).zIndex).toBe(-2);
  });

  it('defaults text and image ranges to a white mask', () => {
    expect(createOverlayForRange('TEXT', 0, bbox)).toMatchObject({
      kind: 'TEXT',
      mask: { enabled: true, color: '#ffffff' }
    });
    expect(createOverlayForRange('IMAGE', 0, bbox)).toMatchObject({
      kind: 'IMAGE',
      mask: { enabled: true, color: '#ffffff' }
    });
  });

  it('moves z-order within a page and clamps keyboard nudges', () => {
    const elements = [
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'back', zIndex: 0 },
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'front', zIndex: 1 },
      { ...createOverlayForRange('SHAPE', 1, bbox), id: 'other-page', zIndex: 0 }
    ];
    const raised = overlayDraftReducer(elements, { type: 'bringForward', id: 'back' });
    expect(raised.find((element) => element.id === 'back')?.zIndex).toBe(1);
    expect(raised.find((element) => element.id === 'front')?.zIndex).toBe(0);

    const nudged = overlayDraftReducer(
      [{ ...elements[0]!, bbox: { ...bbox, xRatio: 0.9, yRatio: 0.9 } }],
      { type: 'nudge', id: 'back', dxRatio: 0.2, dyRatio: 0.2 }
    );
    expect(nudged[0]?.bbox).toMatchObject({ xRatio: 0.8, yRatio: 0.8 });
  });

  it('allows a root draft to publish', () => {
    expect(canPublishAssemblyProcedureDocument({ status: 'draft', isRevisionHead: undefined }, false)).toBe(true);
    expect(canPublishAssemblyProcedureDocument({ status: 'draft', isRevisionHead: false }, false)).toBe(false);
    expect(canPublishAssemblyProcedureDocument({ status: 'draft', isRevisionHead: true }, true)).toBe(false);
  });

  it.each([
    ['bringForward', 'first', ['middle', 'first', 'last']],
    ['sendBackward', 'last', ['first', 'last', 'middle']],
    ['bringToFront', 'first', ['middle', 'last', 'first']],
    ['sendToBack', 'last', ['last', 'first', 'middle']]
  ] as const)('reorders equal z-indices with %s and leaves other pages unchanged', (type, id, order) => {
    const otherPage = { ...createOverlayForRange('SHAPE', 1, bbox), id: 'other-page', zIndex: 7 };
    const elements = [
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'first', zIndex: 5 },
      otherPage,
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'middle', zIndex: 5 },
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'last', zIndex: 5 }
    ];
    const reordered = overlayDraftReducer(elements, { type, id });
    const page = reordered.filter((element) => element.pageIndex === 0).sort((a, b) => a.zIndex - b.zIndex);
    expect(page.map((element) => element.id)).toEqual(order);
    expect(page.map((element) => element.zIndex)).toEqual([0, 1, 2]);
    expect(reordered.find((element) => element.id === otherPage.id)).toBe(otherPage);
    expect(elements.map((element) => element.zIndex)).toEqual([5, 7, 5, 5]);
  });

  it('sorts by z-index before moving and renumbers the whole page', () => {
    const elements = [
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'front', zIndex: 9 },
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'back', zIndex: 2 },
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'middle', zIndex: 5 }
    ];
    const reordered = overlayDraftReducer(elements, { type: 'bringForward', id: 'back' });
    expect(reordered.map((element) => [element.id, element.zIndex])).toEqual([
      ['front', 2], ['back', 1], ['middle', 0]
    ]);
  });

  it.each([
    ['bringForward', 'front'], ['bringToFront', 'front'],
    ['sendBackward', 'back'], ['sendToBack', 'back']
  ] as const)('keeps boundary order for %s', (type, id) => {
    const elements = [
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'back', zIndex: 0 },
      { ...createOverlayForRange('SHAPE', 0, bbox), id: 'front', zIndex: 1 }
    ];
    expect(overlayDraftReducer(elements, { type, id })).toEqual(elements);
    expect(overlayDraftReducer(elements, { type, id: 'missing' })).toBe(elements);
  });

  it('keeps bbox values inside the page with a positive minimum size', () => {
    expect(normalizeOverlayBBox({ xRatio: 0.9, yRatio: -1, widthRatio: 0.2, heightRatio: 2 })).toEqual({
      xRatio: 0.8,
      yRatio: 0,
      widthRatio: 0.2,
      heightRatio: 1
    });
  });

  it('preserves line endpoints in local coordinates when the bbox changes', () => {
    const line = {
      ...createOverlayForRange('SHAPE', 0, bbox),
      shape: 'LINE' as const,
      start: { xRatio: 0.1, yRatio: 0.3 },
      end: { xRatio: 0.3, yRatio: 0.4 }
    };
    const resized = updateOverlayBBox(line, { xRatio: 0.2, yRatio: 0.1, widthRatio: 0.4, heightRatio: 0.4 });
    expect(resized.bbox).toEqual({ xRatio: 0.2, yRatio: 0.1, widthRatio: 0.4, heightRatio: 0.4 });
    expect(resized.start?.xRatio).toBeCloseTo(0.2);
    expect(resized.start?.yRatio).toBeCloseTo(0.3);
    expect(resized.end?.xRatio).toBeCloseTo(0.6);
    expect(resized.end?.yRatio).toBeCloseTo(0.5);
  });

  it('creates endpoints for line variants and clears them for closed shapes', () => {
    const rectangle = createOverlayForRange('SHAPE', 0, bbox);
    const arrow = convertOverlayShapeKind(rectangle, 'ARROW');
    expect(arrow.start).toEqual({ xRatio: bbox.xRatio, yRatio: bbox.yRatio });
    expect(arrow.end).toEqual({ xRatio: bbox.xRatio + bbox.widthRatio, yRatio: bbox.yRatio + bbox.heightRatio });
    const ellipse = convertOverlayShapeKind(arrow, 'ELLIPSE');
    expect(ellipse.start).toBeUndefined();
    expect(ellipse.end).toBeUndefined();
  });
});

describe('photo text-rewrite attachments', () => {
  const photoBox = { xRatio: 0.125, yRatio: 0.125, widthRatio: 0.5, heightRatio: 0.5 };
  const patchBox = { xRatio: 0.25, yRatio: 0.25, widthRatio: 0.125, heightRatio: 0.125 };
  const photo = { ...createOverlayForRange('IMAGE', 0, photoBox), id: 'photo', assetId: 'photo-asset', zIndex: 1 };
  const patch = { ...createOverlayForRange('IMAGE', 0, patchBox), id: 'text-erase-patch', assetId: 'patch-asset', objectFit: 'fill' as const, zIndex: 2 };
  const text = { ...createOverlayForRange('TEXT', 0, patchBox), id: 'rewrite', zIndex: 3 };
  const ordinaryText = { ...text, id: 'ordinary', bbox: { ...patchBox, xRatio: 0.375 }, zIndex: 4 };
  const shape = { ...createOverlayForRange('SHAPE', 0, patchBox), id: 'shape', zIndex: 5 };
  const otherPage = { ...photo, id: 'other-page', pageIndex: 1, zIndex: 9 };
  const backgroundPatch = { ...patch, id: 'text-erase-background', bbox: { ...patchBox, xRatio: 0.75 } };
  const backgroundText = { ...text, id: 'background-text', bbox: backgroundPatch.bbox };
  const group = [photo, patch, text];

  const byId = (elements: AssemblyProcedureOverlayElement[], id: string) => elements.find(element => element.id === id);
  const zOrder = (elements: AssemblyProcedureOverlayElement[]) =>
    elements.filter(element => element.pageIndex === 0).sort((a, b) => a.zIndex - b.zIndex).map(element => element.id);

  it('uses the patch and text centers and requires attachments to be above their owners on the same page', () => {
    const elements = [
      { ...patch, id: 'text-erase-same-z', zIndex: photo.zIndex },
      { ...text, id: 'text-same-z', zIndex: patch.zIndex },
      ...group, ordinaryText, shape, otherPage, backgroundPatch, backgroundText,
      { ...patch, id: 'text-erase-other-page', pageIndex: 1 },
      { ...patch, id: 'text-erase-center-outside', bbox: { ...patchBox, xRatio: 0.5625, widthRatio: 0.25 } }
    ];
    expect(findAttachedOverlayIds(elements, photo.id)).toEqual([patch.id, text.id]);
    expect(findAttachedOverlayIds(elements, patch.id)).toEqual([]);
    expect(findAttachedOverlayIds(elements, text.id)).toEqual([]);
  });

  it('selects the highest eligible photo and the highest eligible patch independently', () => {
    const upperPhoto = { ...photo, id: 'upper-photo', zIndex: 3 };
    const upperPatch = { ...patch, id: 'text-erase-upper', zIndex: 4 };
    const elements = [photo, upperPhoto, patch, upperPatch, { ...text, zIndex: 5 }];
    expect(findAttachedOverlayIds(elements, photo.id)).toEqual([patch.id]);
    expect(findAttachedOverlayIds(elements, upperPhoto.id)).toEqual([upperPatch.id, text.id]);
  });

  it('uses array order to break z-index ties between overlapping photos, patches, and text', () => {
    const laterPhoto = { ...photo, id: 'later-photo' };
    const tiedPatch = { ...patch, zIndex: photo.zIndex };
    const tiedText = { ...text, zIndex: photo.zIndex };
    const elements = [photo, laterPhoto, tiedPatch, tiedText];
    expect(findAttachedOverlayIds(elements, photo.id)).toEqual([]);
    expect(findAttachedOverlayIds(elements, laterPhoto.id)).toEqual([patch.id, text.id]);
  });

  it('moves a saved photo group in one history entry while leaving independent overlays in place', () => {
    const elements = [...group, ordinaryText, shape, backgroundPatch, backgroundText];
    const initial = { present: elements, past: [], future: [], dragStart: null };
    const started = historyReducer(initial, { type: 'beginDrag' });
    const moved = historyReducer(started, { type: 'update', element: { ...photo, bbox: { ...photoBox, xRatio: 0.25, yRatio: 0.25 } } });
    const finished = historyReducer(moved, { type: 'endDrag' });
    expect(finished.present.slice(1, 3).map(element => element.bbox)).toEqual([
      { ...patchBox, xRatio: 0.375, yRatio: 0.375 },
      { ...patchBox, xRatio: 0.375, yRatio: 0.375 }
    ]);
    expect(finished.present.slice(3)).toEqual(elements.slice(3));
    expect(finished.past).toEqual([elements]);
    expect(historyReducer(finished, { type: 'undo' }).present).toBe(elements);
  });

  it('resizes both attachments and scales the text font by the horizontal factor', () => {
    const resized = overlayDraftReducer(group, {
      type: 'update',
      element: { ...photo, bbox: { ...photoBox, widthRatio: 0.75, heightRatio: 0.25 } }
    });
    const expected = { xRatio: 0.3125, yRatio: 0.1875, widthRatio: 0.1875, heightRatio: 0.0625 };
    expect(resized[1].bbox).toEqual(expected);
    expect(resized[2]).toMatchObject({ bbox: expected, style: { ...text.style, fontSizeRatio: expect.closeTo(0.0375) } });
  });

  it('nudges by the photo’s actual movement at the page edge and clamps extending text', () => {
    const edgePhoto = { ...photo, bbox: { ...photoBox, xRatio: 0.4375 } };
    const edgePatch = { ...patch, bbox: { ...patchBox, xRatio: 0.8125 } };
    const edgeText = { ...text, bbox: { ...patchBox, xRatio: 0.75, widthRatio: 0.25 } };
    const nudged = overlayDraftReducer([edgePhoto, edgePatch, edgeText], { type: 'nudge', id: photo.id, dxRatio: 0.25, dyRatio: 0 });
    expect(nudged.map(element => element.bbox.xRatio)).toEqual([0.5, 0.875, 0.75]);
  });

  it.each([patch, text])('keeps other elements in place when moving $id by itself', attachment => {
    const moved = { ...attachment, bbox: { ...attachment.bbox, xRatio: 0.75 } };
    const next = overlayDraftReducer(group, { type: 'update', element: moved });
    expect(next).toEqual(group.map(element => element.id === attachment.id ? moved : element));
  });

  it('deletes only the photo group, and deletes an individual patch on its own', () => {
    expect(overlayDraftReducer([...group, ordinaryText, shape, backgroundPatch, backgroundText], { type: 'remove', id: photo.id }))
      .toEqual([ordinaryText, shape, backgroundPatch, backgroundText]);
    expect(overlayDraftReducer(group, { type: 'remove', id: patch.id })).toEqual([photo, text]);
  });

  it('leaves ordinary text whose edge overlaps the patch in place when moving or deleting the photo', () => {
    const edgeText = { ...ordinaryText, bbox: { ...patchBox, xRatio: 0.34375 } };
    const elements = [...group, edgeText];
    const moved = overlayDraftReducer(elements, {
      type: 'update',
      element: { ...photo, bbox: { ...photoBox, xRatio: 0.25 } }
    });
    expect(byId(moved, patch.id)?.bbox.xRatio).toBe(0.375);
    expect(byId(moved, edgeText.id)).toBe(edgeText);
    expect(overlayDraftReducer(elements, { type: 'remove', id: photo.id })).toEqual([edgeText]);
  });

  it('carries rewritten text that grows below the patch', () => {
    const tallText = { ...text, bbox: { ...patchBox, heightRatio: 0.3 } };
    const below = { ...ordinaryText, bbox: { ...patchBox, yRatio: 0.38 } };
    const elements = [photo, patch, tallText, below];
    expect(findAttachedOverlayIds(elements, photo.id)).toEqual([patch.id, tallText.id]);
    const moved = overlayDraftReducer(elements, {
      type: 'update',
      element: { ...photo, bbox: { ...photoBox, xRatio: 0.25 } }
    });
    expect(byId(moved, tallText.id)?.bbox.xRatio).toBe(0.375);
    expect(byId(moved, below.id)).toBe(below);
  });

  it.each([0, 1])('duplicates a photo group to page %i with distinct ownership and consecutive z-indices', pageIndex => {
    const elements = [...group, otherPage];
    const action = createDuplicateOverlayAction(elements, photo.id, 'copied-photo', pageIndex);
    const next = overlayDraftReducer(elements, action);
    const [copiedPhoto, copiedPatch, copiedText] = next.slice(elements.length);
    expect(copiedPhoto).toMatchObject({ id: 'copied-photo', pageIndex, bbox: photoBox });
    expect(copiedPatch).toMatchObject({ id: expect.stringMatching(/^text-erase-/), pageIndex, bbox: patchBox, assetId: patch.assetId });
    expect(copiedText).toMatchObject({ pageIndex, bbox: patchBox, text: text.text });
    expect(new Set(next.map(element => element.id)).size).toBe(next.length);
    const firstZ = pageIndex === 0 ? text.zIndex + 1 : otherPage.zIndex + 1;
    expect([copiedPhoto.zIndex, copiedPatch.zIndex, copiedText.zIndex]).toEqual([firstZ, firstZ + 1, firstZ + 2]);
    expect(findAttachedOverlayIds(next, photo.id)).toEqual([patch.id, text.id]);
    expect(findAttachedOverlayIds(next, copiedPhoto.id)).toEqual([copiedPatch.id, copiedText.id]);
    expect(overlayDraftReducer(elements, action)).toEqual(next);
    const moved = overlayDraftReducer(next, { type: 'nudge', id: copiedPhoto.id, dxRatio: 0.125, dyRatio: 0 });
    expect(moved.slice(0, elements.length)).toEqual(elements);
    expect(byId(moved, copiedPatch.id)?.bbox.xRatio).toBe(0.375);
    expect(byId(moved, copiedText.id)?.bbox.xRatio).toBe(0.375);
  });

  it.each([
    ['bringForward', [photo, patch, text, shape, ordinaryText], ['ordinary', 'photo', 'text-erase-patch', 'rewrite', 'shape']],
    ['sendBackward', [{ ...shape, zIndex: 0 }, ...group, ordinaryText], ['photo', 'text-erase-patch', 'rewrite', 'shape', 'ordinary']],
    ['bringToFront', [...group, ordinaryText, shape], ['ordinary', 'shape', 'photo', 'text-erase-patch', 'rewrite']],
    ['sendToBack', [{ ...shape, zIndex: 0 }, ...group, ordinaryText], ['photo', 'text-erase-patch', 'rewrite', 'shape', 'ordinary']]
  ] as const)('keeps the photo group together with %s', (type, elements, expected) => {
    const next = overlayDraftReducer([...elements, otherPage], { type, id: photo.id });
    expect(zOrder(next)).toEqual(expected);
    expect(findAttachedOverlayIds(next, photo.id)).toEqual([patch.id, text.id]);
    expect(byId(next, otherPage.id)).toBe(otherPage);
  });

  it('crosses another overlapping photo and its attachments together', () => {
    const copied = overlayDraftReducer(group, createDuplicateOverlayAction(group, photo.id, 'copied-photo', 0));
    const [copiedPhoto, copiedPatch, copiedText] = copied.slice(group.length);
    const reordered = overlayDraftReducer(copied, { type: 'bringForward', id: photo.id });
    expect(zOrder(reordered)).toEqual([copiedPhoto.id, copiedPatch.id, copiedText.id, photo.id, patch.id, text.id]);
    expect(findAttachedOverlayIds(reordered, copiedPhoto.id)).toEqual([copiedPatch.id, copiedText.id]);
    expect(findAttachedOverlayIds(reordered, photo.id)).toEqual([patch.id, text.id]);
    expect(zOrder(overlayDraftReducer(reordered, { type: 'sendBackward', id: photo.id }))).toEqual(zOrder(copied));
  });

  it.each([
    ['bringForward', 0],
    ['sendBackward', 6],
    ['bringToFront', 0],
    ['sendToBack', 6]
  ] as const)('preserves the ownership of interleaved photo groups with %s', (type, targetZ) => {
    const target = { ...photo, id: 'photo-a', zIndex: targetZ };
    const firstPhoto = { ...photo, id: 'photo-c', zIndex: 1 };
    const secondPhoto = { ...photo, id: 'photo-b', bbox: { ...photoBox, xRatio: 0.375 }, zIndex: 2 };
    const firstPatch = { ...patch, zIndex: 3 };
    const secondPatch = { ...patch, id: 'text-erase-b', bbox: { ...patchBox, xRatio: 0.5 }, zIndex: 4 };
    const secondText = { ...text, bbox: secondPatch.bbox, zIndex: 5 };
    const others = [firstPhoto, secondPhoto, firstPatch, secondPatch, secondText];
    const elements = [target, ...others];
    const next = overlayDraftReducer(elements, { type, id: target.id });
    const otherIds = others.map(element => element.id);

    expect(zOrder(next)).toEqual(targetZ === 0 ? [...otherIds, target.id] : [target.id, ...otherIds]);
    for (const [owner, attached] of [[firstPhoto, [firstPatch.id]], [secondPhoto, [secondPatch.id, secondText.id]]] as const) {
      expect(findAttachedOverlayIds(elements, owner.id)).toEqual(attached);
      expect(findAttachedOverlayIds(next, owner.id)).toEqual(attached);
    }
  });

  it('moves forward by one group when the next two photo groups are contiguous', () => {
    const target = { ...photo, id: 'photo-a', zIndex: 0 };
    const nextPhoto = { ...photo, id: 'photo-c', zIndex: 4 };
    const nextPatch = { ...patch, id: 'text-erase-c', zIndex: 5 };
    const nextText = { ...text, id: 'rewrite-c', zIndex: 6 };
    const elements = [target, ...group, nextPhoto, nextPatch, nextText];
    const next = overlayDraftReducer(elements, { type: 'bringForward', id: target.id });

    expect(zOrder(next)).toEqual([photo.id, patch.id, text.id, target.id, nextPhoto.id, nextPatch.id, nextText.id]);
    for (const owner of [photo, nextPhoto]) {
      expect(findAttachedOverlayIds(next, owner.id)).toEqual(findAttachedOverlayIds(elements, owner.id));
    }
  });

  it('changes the patch’s own z-order independently', () => {
    expect(zOrder(overlayDraftReducer(group, { type: 'sendBackward', id: patch.id }))).toEqual([patch.id, photo.id, text.id]);
  });

  it('uses the old relative bbox instead of an attachment’s applyLayout proposal', () => {
    const proposedPhoto = { ...photo, bbox: { ...photoBox, xRatio: 0.25 } };
    const proposedText = { ...text, bbox: backgroundPatch.bbox, style: { fontSizeRatio: 0.01 } };
    const next = overlayDraftReducer(group, { type: 'applyLayout', pageIndex: 0, elements: [proposedPhoto, backgroundPatch, proposedText] });
    const expected = { ...patchBox, xRatio: 0.375 };
    expect(byId(next, patch.id)?.bbox).toEqual(expected);
    expect(byId(next, text.id)).toMatchObject({ bbox: expected, style: { fontSizeRatio: text.style.fontSizeRatio } });
    expect(byId(next, backgroundPatch.id)).toEqual(backgroundPatch);
  });

  it('moves attached overlays to the photo’s split destination even if omitted or assigned to the other page', () => {
    const proposedPhoto = { ...photo, bbox: { ...photoBox, yRatio: 0.25 } };
    const next = overlayDraftReducer(group, { type: 'splitLayout', pageIndex: 0, elements: [text], nextPageElements: [proposedPhoto] });
    const expected = { ...patchBox, yRatio: 0.375 };
    expect(next).toHaveLength(group.length);
    expect(byId(next, patch.id)).toMatchObject({ pageIndex: 1, bbox: expected });
    expect(byId(next, text.id)).toMatchObject({ pageIndex: 1, bbox: expected });
    expect(findAttachedOverlayIds(next, photo.id)).toEqual([patch.id, text.id]);
  });

  it('keeps attachments on the original page when the split does not move the photo', () => {
    const next = overlayDraftReducer(group, { type: 'splitLayout', pageIndex: 0, elements: [photo], nextPageElements: [patch, text] });
    expect(next).toEqual(group);
  });
});


describe('overlayDraftSnapshot', () => {
  it('retains the sorted JSON format and serializes only changed immutable elements', () => {
    const a = { ...createOverlayForRange('TEXT', 0, bbox), id: 'a' };
    const b = { ...createOverlayForRange('SHAPE', 1, bbox), id: 'b' };
    const elements = [b, a];
    const expected = JSON.stringify([a, b]);
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      const first = overlayDraftSnapshot(elements);
      const firstCalls = stringify.mock.calls.length;
      const repeated = overlayDraftSnapshot(elements);
      const repeatedCalls = stringify.mock.calls.length;
      const reordered = overlayDraftSnapshot([a, b]);
      const reorderedCalls = stringify.mock.calls.length;
      const changed = { ...a, text: '編集\nした文章' };
      const next = overlayDraftSnapshot([b, changed]);
      const changedCalls = stringify.mock.calls.length;
      expect(first).toBe(expected);
      expect(repeated).toBe(first);
      expect(reordered).toBe(first);
      expect(firstCalls).toBe(2);
      expect(repeatedCalls).toBe(firstCalls);
      expect(reorderedCalls).toBe(firstCalls);
      expect(changedCalls).toBe(firstCalls + 1);
      expect(next).toBe(JSON.stringify([changed, b]));
      expect(overlayDraftSnapshot(elements)).toBe(first);
    } finally { stringify.mockRestore(); }
  });
});

describe('moveOverlayPage', () => {
  it.each([
    [0, 2, [2, 0, 1, 3]],
    [2, 0, [1, 2, 0, 3]],
    [1, 1, [0, 1, 2, 3]]
  ] as const)('maps overlay indexes when moving page %i to %i', (from, to, expected) => {
    const overlays = [0, 1, 2, 3].map(pageIndex => createOverlayForRange('TEXT', pageIndex, bbox));
    const result = moveOverlayPage(overlays, from, to);
    expect(result.map(element => element.pageIndex)).toEqual(expected);
    expect(result.map(element => element.id)).toEqual(overlays.map(element => element.id));
    expect(result[3]).toBe(overlays[3]);
    expect(overlays.map(element => element.pageIndex)).toEqual([0, 1, 2, 3]);
  });
});
