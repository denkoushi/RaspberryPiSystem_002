import { describe, expect, it } from 'vitest';

import { createOverlayForRange, removeOverlayPage } from './assemblyDocumentEditorDraft';
import { historyReducer, type OverlayHistory } from './documentEditorHistory';

const bbox = { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.2 };
const elements = [0, 1, 2].map(pageIndex => ({ ...createOverlayForRange('TEXT', pageIndex, bbox), id: `page-${pageIndex}` }));

it('undoes and redoes one rotation for a photo, its patch and its text in a single step', () => {
  const photo = createOverlayForRange('IMAGE', 0, { xRatio: 0.25, yRatio: 0.25, widthRatio: 0.5, heightRatio: 0.5 });
  const patch = { ...createOverlayForRange('IMAGE', 0, { ...bbox, xRatio: 0.25, yRatio: 0.25 }), id: 'text-erase-patch', zIndex: 1 };
  const text = { ...createOverlayForRange('TEXT', 0, patch.bbox), zIndex: 2 };
  const present = [photo, patch, text];
  const rotated = historyReducer({ past: [], present, future: [], dragStart: null }, {
    type: 'rotateImage', direction: 'right', id: photo.id, pageAspect: 1,
    newAssetIds: new Map([[photo.id, 'new-photo'], [patch.id, 'new-patch']])
  });
  expect(rotated.past).toEqual([present]);
  expect(rotated.present).not.toEqual(present);
  const undone = historyReducer(rotated, { type: 'undo' });
  expect(undone.present).toBe(present);
  expect(historyReducer(undone, { type: 'redo' }).present).toBe(rotated.present);
});

describe('drag a photo with text-rewrite attachments', () => {
  it.each([
    ['keeps its own attachments while crossing a higher photo', 0, 1],
    ['leaves the other photo’s attachments in place while passing under its patch', 1, 0]
  ] as const)('%s and undoes the drag in one step', (_scenario, movingZ, stationaryZ) => {
    const photoBox = { ...bbox, xRatio: 0.0625, widthRatio: 0.25 };
    const patchBox = { ...bbox, xRatio: 0.125, widthRatio: 0.0625 };
    const movedPhoto = { ...createOverlayForRange('IMAGE', 0, photoBox), id: 'a', zIndex: movingZ };
    const movedPatch = { ...createOverlayForRange('IMAGE', 0, patchBox), id: 'text-erase-a', zIndex: 2 };
    const movedText = { ...createOverlayForRange('TEXT', 0, patchBox), id: 'text-a', zIndex: 3 };
    const stationaryPhoto = { ...movedPhoto, id: 'b', bbox: { ...photoBox, xRatio: 0.375 }, zIndex: stationaryZ };
    const stationaryPatch = { ...movedPatch, id: 'text-erase-b', bbox: { ...patchBox, xRatio: 0.5625 }, zIndex: 4 };
    const stationaryText = { ...movedText, id: 'text-b', bbox: stationaryPatch.bbox, zIndex: 5 };
    const stationaryGroup = [stationaryPhoto, stationaryPatch, stationaryText];
    const present = [movedPhoto, movedPatch, movedText, ...stationaryGroup];
    let state = historyReducer({ past: [], present, future: [], dragStart: null }, { type: 'beginDrag' });

    for (const xRatio of [0.375, 0.5, 0.75]) {
      state = historyReducer(state, { type: 'update', element: { ...movedPhoto, bbox: { ...photoBox, xRatio } } });
      const expectedBox = { ...patchBox, xRatio: xRatio + patchBox.xRatio - photoBox.xRatio };
      expect(state.present.slice(1, 3).map(element => element.bbox)).toEqual([expectedBox, expectedBox]);
      expect(state.present.slice(3)).toEqual(stationaryGroup);
    }

    const finished = historyReducer(state, { type: 'endDrag' });
    expect(finished.present).toBe(state.present);
    expect(finished.past).toEqual([present]);
    expect(historyReducer(finished, { type: 'undo' }).present).toBe(present);
  });
});

describe('delete a page from overlay history', () => {
  it('removes the page and shifts later indexes without mutating the input', () => {
    const result = removeOverlayPage(elements, 1);
    expect(result.map(element => [element.id, element.pageIndex])).toEqual([['page-0', 0], ['page-2', 1]]);
    expect(result[0]).toBe(elements[0]);
    expect(elements.map(element => element.pageIndex)).toEqual([0, 1, 2]);
  });
  it('rewrites past, present, future and the drag baseline so undo/redo cannot revive deleted overlays', () => {
    const initial: OverlayHistory = { past: [elements], present: elements.map(element => ({ ...element, zIndex: 1 })), future: [elements.map(element => ({ ...element, zIndex: 2 }))], dragStart: elements };
    const next = historyReducer(initial, { type: 'deletePage', pageIndex: 1 });
    for (const snapshot of [...next.past, next.present, ...next.future, next.dragStart!]) {
      expect(snapshot.map(element => [element.id, element.pageIndex])).toEqual([['page-0', 0], ['page-2', 1]]);
    }
    const ended = historyReducer(next, { type: 'endDrag' });
    const undone = historyReducer(ended, { type: 'undo' });
    const redone = historyReducer(undone, { type: 'redo' });
    expect(undone.present.some(element => element.id === 'page-1')).toBe(false);
    expect(redone.present.some(element => element.id === 'page-1')).toBe(false);
    expect(initial.present).toHaveLength(3);
  });
  it('does not create a deletion undo step', () => {
    const next = historyReducer({ past: [], present: elements, future: [], dragStart: null }, { type: 'deletePage', pageIndex: 0 });
    expect(next.past).toEqual([]);
    expect(historyReducer(next, { type: 'undo' })).toBe(next);
  });
  it('keeps elements moved off the deleted page through undo and redo', () => {
    const before = elements[0];
    const moved = { ...before, pageIndex: 1 };
    const edited = { ...before, zIndex: 2 };
    const next = historyReducer({ past: [[before], [edited]], present: [{ ...edited, pageIndex: 1 }], future: [[moved]], dragStart: [before] }, { type: 'deletePage', pageIndex: 0 });
    expect(next.present).toEqual([edited]);
    expect(next.past).toEqual([[before]]);
    expect(next.dragStart).toEqual([before]);
    expect(historyReducer(next, { type: 'undo' }).present).toEqual([before]);
    expect(historyReducer(historyReducer(next, { type: 'undo' }), { type: 'redo' }).present).toEqual([edited]);
  });

  it('retains the pre-split element on page k when the new page is deleted', () => {
    const before = elements[0];
    const next = historyReducer({ past: [[before]], present: [{ ...before, pageIndex: 1 }], future: [], dragStart: null }, { type: 'deletePage', pageIndex: 1 });
    expect(next.present).toEqual([]);
    expect(historyReducer(next, { type: 'undo' }).present).toEqual([before]);
  });

  it('compacts consecutive duplicate past and future states against the present', () => {
    const survivor = elements[0];
    const changed = { ...survivor, zIndex: 5 };
    const deleted = elements[1];
    const next = historyReducer({
      past: [[changed], [changed, deleted], [survivor, deleted]],
      present: [survivor, { ...deleted, zIndex: 4 }],
      future: [[survivor, deleted], [changed, deleted], [changed]], dragStart: null
    }, { type: 'deletePage', pageIndex: 1 });
    expect(next.past).toEqual([[changed]]);
    expect(next.future).toEqual([[changed]]);
    expect(historyReducer(next, { type: 'undo' }).present).toEqual([changed]);
    expect(historyReducer(next, { type: 'redo' }).present).toEqual([changed]);
  });

});

it('reorders past, present, future and drag snapshots before undo and redo', () => {
  const edited = elements.map(element => ({ ...element, zIndex: 1 }));
  const future = elements.map(element => ({ ...element, zIndex: 2 }));
  const initial: OverlayHistory = { past: [elements], present: edited, future: [future], dragStart: elements };
  const next = historyReducer(initial, { type: 'movePage', from: 2, to: 0 });
  for (const snapshot of [...next.past, next.present, ...next.future, next.dragStart!]) {
    expect(snapshot.map(element => element.pageIndex)).toEqual([1, 2, 0]);
  }
  const undone = historyReducer(next, { type: 'undo' });
  expect(undone.present).toEqual(next.past[0]);
  const redone = historyReducer(undone, { type: 'redo' });
  expect(redone.present).toEqual(next.present);
  expect(historyReducer(redone, { type: 'redo' }).present).toEqual(next.future[0]);
  expect(initial.present.map(element => element.pageIndex)).toEqual([0, 1, 2]);
});
