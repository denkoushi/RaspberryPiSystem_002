import { describe, expect, it } from 'vitest';

import { createOverlayForRange, removeOverlayPage } from './assemblyDocumentEditorDraft';
import { historyReducer, type OverlayHistory } from './documentEditorHistory';

const bbox = { xRatio: 0.1, yRatio: 0.1, widthRatio: 0.2, heightRatio: 0.2 };
const elements = [0, 1, 2].map(pageIndex => ({ ...createOverlayForRange('TEXT', pageIndex, bbox), id: `page-${pageIndex}` }));

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
