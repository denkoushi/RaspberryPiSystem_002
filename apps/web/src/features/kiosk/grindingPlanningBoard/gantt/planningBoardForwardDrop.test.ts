import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { beginForwardDropCache, endForwardDropCache, findForwardDrop, forwardDropBoard, invalidateForwardDropCache } from './planningBoardForwardDrop';
import { usePlanningBoardDragPreview } from './usePlanningBoardSharedDrag';

import type { GanttBar } from './planningBoardGanttLayout';
import type { ForwardDragLane } from './planningBoardSingleResourceWindows';

type Rect = { left: number; top: number; right: number; bottom: number };

const bar = (itemId: string, resource: string, start: number, end: number) =>
  ({ item: { itemId, kind: 'row' }, resource, start, end }) as unknown as GanttBar;

let rects = new Map<Element, Rect>();
const place = (element: Element, rect: Rect) => {
  rects.set(element, rect);
  Object.defineProperty(element, 'getBoundingClientRect', { configurable: true, value: () => {
    const r = rects.get(element)!;
    return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON: () => r };
  } });
};
const div = (parent: Element, attributes: Record<string, string> = {}) => {
  const element = document.createElement('div');
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  parent.appendChild(element);
  return element;
};

describe('forward drop hit-test cache', () => {
  let board: HTMLElement;
  let viewport: HTMLElement;
  let laneA: HTMLElement;
  let laneB: HTMLElement;
  let overlay: HTMLElement;
  let scrollbar = 0;
  const source = bar('s', '305', 0, 1);
  const lanes: ForwardDragLane[] = [
    { resource: '306', bars: [bar('a', '306', 1, 2), bar('b', '306', 3, 4)] },
    { resource: '307', bars: [bar('c', '307', 1, 2)] }
  ];
  const allowed = new Set(['305', '306', '307']);

  beforeEach(() => {
    rects = new Map();
    document.body.innerHTML = '';
    board = div(document.body, { 'data-testid': 'planning-board-gantt' });
    viewport = div(board, { 'data-gantt-viewport': '' });
    place(viewport, { left: 0, top: 0, right: 400, bottom: 300 });
    // jsdom has no layout: the client area follows the mocked rectangle unless a test adds a scrollbar.
    scrollbar = 0;
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, get: () => rects.get(viewport)!.right - rects.get(viewport)!.left - scrollbar });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, get: () => rects.get(viewport)!.bottom - rects.get(viewport)!.top });
    laneA = div(viewport, { 'data-gantt-lane': '', 'data-resource-code': '306' });
    place(laneA, { left: 0, top: 0, right: 400, bottom: 100 });
    place(div(laneA, { 'data-gantt-track': '' }), { left: 50, top: 0, right: 400, bottom: 100 });
    laneB = div(viewport, { 'data-gantt-lane': '', 'data-resource-code': '307' });
    place(laneB, { left: 0, top: 100, right: 400, bottom: 500 });
    place(div(laneB, { 'data-gantt-track': '' }), { left: 50, top: 100, right: 400, bottom: 500 });
    overlay = div(document.body, { 'data-later-queue': '' });
    place(overlay, { left: 300, top: 0, right: 400, bottom: 60 });
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: (x: number, y: number) =>
      // Like a browser, a lane inside a scroll viewport is only hit where the viewport shows it.
      [overlay, laneA, laneB].filter((element) => [element, ...(element === overlay ? [] : [viewport])].every((target) => {
        const r = rects.get(target)!;
        return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
      })) });
  });
  afterEach(() => {
    endForwardDropCache();
    Reflect.deleteProperty(document, 'elementsFromPoint');
    document.body.innerHTML = '';
  });

  const drop = (x: number, y: number) => findForwardDrop(x, y, source, allowed, forwardDropBoard(viewport), lanes, 0, 100);

  it('matches the elementsFromPoint result for lanes, the overlay, a clipped lane and empty space', () => {
    const points: [number, number][] = [[60, 10], [140, 50], [260, 90], [350, 30], [60, 150], [200, 280], [200, 450], [450, 10], [-5, -5]];
    const expected = points.map(([x, y]) => drop(x, y));
    expect(expected.some((result) => result !== null)).toBe(true);
    beginForwardDropCache();
    expect(points.map(([x, y]) => drop(x, y))).toEqual(expected);
    // The overlay never takes a drop, and a lane is clipped to its scroll viewport (y 300..500 shows nothing).
    expect(drop(350, 30)).toBeNull();
    expect(drop(200, 450)).toBeNull();
  });

  it('measures geometry once per drag and refreshes it after a scroll', () => {
    beginForwardDropCache();
    const before = drop(60, 10);
    expect(before?.resource).toBe('306');
    // The lanes scroll up by 100px; without a scroll signal the cache keeps its old geometry.
    place(laneA, { left: 0, top: -100, right: 400, bottom: 0 });
    place(laneB, { left: 0, top: 0, right: 400, bottom: 400 });
    expect(drop(60, 10)?.resource).toBe('306');
    window.dispatchEvent(new Event('scroll'));
    expect(drop(60, 10)?.resource).toBe('307');
  });

  it('refreshes when a lane viewport scrolls, even without a scroll event reaching the window', () => {
    beginForwardDropCache();
    expect(drop(60, 10)?.resource).toBe('306');
    place(laneA, { left: 0, top: -100, right: 400, bottom: 0 });
    place(laneB, { left: 0, top: 0, right: 400, bottom: 400 });
    viewport.scrollTop = 100;
    expect(drop(60, 10)?.resource).toBe('307');
  });

  it('refreshes on an explicit invalidation and on a changed lane list', () => {
    beginForwardDropCache();
    expect(drop(60, 10)?.resource).toBe('306');
    place(laneA, { left: 0, top: -100, right: 400, bottom: 0 });
    place(laneB, { left: 0, top: 0, right: 400, bottom: 400 });
    invalidateForwardDropCache();
    expect(drop(60, 10)?.resource).toBe('307');
    place(laneA, { left: 0, top: 0, right: 400, bottom: 100 });
    place(laneB, { left: 0, top: 100, right: 400, bottom: 500 });
    expect(findForwardDrop(60, 10, source, allowed, forwardDropBoard(viewport), [...lanes], 0, 100)?.resource).toBe('306');
  });

  it('falls back to elementsFromPoint when layout reports no size', () => {
    [laneA, laneB, viewport, overlay].forEach((element) => place(element, { left: 0, top: 0, right: 0, bottom: 0 }));
    beginForwardDropCache();
    expect(drop(60, 10)).toBeNull();
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: () => [laneB] });
    expect(drop(60, 10)?.resource).toBe('307');
  });

  it('re-measures after a layout change reported by ResizeObserver, with no scroll or resize event', () => {
    const callbacks: (() => void)[] = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(callback: () => void) { callbacks.push(callback); } observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    try {
      beginForwardDropCache();
      expect(drop(60, 10)?.resource).toBe('306');
      place(laneA, { left: 0, top: -100, right: 400, bottom: 0 });
      place(laneB, { left: 0, top: 0, right: 400, bottom: 400 });
      expect(drop(60, 10)?.resource).toBe('306');
      expect(callbacks).toHaveLength(1);
      callbacks[0]!();
      expect(drop(60, 10)?.resource).toBe('307');
    } finally { globalThis.ResizeObserver = original; }
  });

  it('never drops on an overlay that appears after the cache was built', () => {
    beginForwardDropCache();
    expect(drop(60, 10)?.resource).toBe('306');
    const late = div(document.body, { 'data-forward-queue': '' });
    place(late, { left: 0, top: 0, right: 200, bottom: 50 });
    expect(drop(60, 10)).toBeNull();
    late.remove();
    expect(drop(60, 10)?.resource).toBe('306');
  });

  it('does not drop over a scrollbar of the lane viewport', () => {
    scrollbar = 15;
    beginForwardDropCache();
    expect(drop(60, 10)?.resource).toBe('306');
    expect(drop(395, 10)).toBeNull();
    expect(drop(390, 150)).toBeNull();
  });

  it('keeps the shared cache when an unused local drag hook unmounts mid-drag', () => {
    const owner = renderHook(() => usePlanningBoardDragPreview());
    const idle = renderHook(() => usePlanningBoardDragPreview());
    act(() => owner.result.current[1]({ bar: source, x: 60, y: 10, allowed, drop: null }));
    expect(drop(60, 10)?.resource).toBe('306');
    place(laneA, { left: 0, top: -100, right: 400, bottom: 0 });
    place(laneB, { left: 0, top: 0, right: 400, bottom: 400 });
    idle.unmount();
    // Still cached (stale on purpose): the idle hook must not have ended the drag's cache.
    expect(drop(60, 10)?.resource).toBe('306');
    owner.unmount();
    expect(drop(60, 10)?.resource).toBe('307');
  });
});
