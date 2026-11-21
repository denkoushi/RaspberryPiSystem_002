import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { measurePairs, PlanningBoardPieceLinks } from './PlanningBoardPieceLinks';

import type { GanttBar, GanttLayout } from './planningBoardGanttLayout';

const ROW_HEIGHT = 100;

/** Rows of one resource; every part has two pieces, `span` rows apart, so each link crosses rows. */
function buildPane(rowCount: number, span: number) {
  const content = document.createElement('div');
  const rowElements = new Map<string, HTMLDivElement>();
  for (let i = 0; i < rowCount; i++) {
    const row = document.createElement('div');
    row.dataset.ganttWindowRow = `r${i}`;
    row.dataset.top = String(i * ROW_HEIGHT);
    row.appendChild(Object.assign(document.createElement('div'), { }));
    row.firstElementChild!.setAttribute('data-gantt-track', '');
    content.appendChild(row);
    rowElements.set(`r${i}`, row);
  }
  const bars: GanttBar[] = [];
  const barLocations = new Map<string, { first: { rowKey: string; bar: GanttBar; start: number }; last: { rowKey: string; bar: GanttBar; start: number } }>();
  const add = (id: string, part: string, row: number, start: number) => {
    const bar = { item: { itemId: id, pieceId: id, kind: 'piece' }, partKey: part, resource: 'M1', start, end: start + 2, unknown: false,
      segments: [{ start, end: start + 2 }] } as unknown as GanttBar;
    bars.push(bar);
    barLocations.set(id, { first: { rowKey: `r${row}`, bar, start: 0 }, last: { rowKey: `r${row}`, bar, start: 0 } });
  };
  for (let i = 0; i + span < rowCount; i++) {
    add(`a${i}`, `part${i}`, i, 1);
    add(`b${i}`, `part${i}`, i + span, 3);
  }
  const layout = { groups: [], start: 0, end: 10, today: 0, overlapCount: 0, mode: 'forward' } as GanttLayout;
  return {
    bars, barLocations, layout, rowElements: { current: rowElements }, barRows: new Map<string, string>(), content: { current: content },
    labelWidth: 0, dayWidth: 50, viewportWidth: 1000, viewportHeight: null, pieceLayer: { current: document.createElement('div') }, viewport: null
  };
}

let calls = 0;
beforeEach(() => {
  calls = 0;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    calls++;
    const top = Number((this as HTMLElement).dataset?.top ?? 0);
    const isTrack = this.hasAttribute('data-gantt-track');
    const rect = { left: 0, top, right: isTrack ? 500 : 700, bottom: top + ROW_HEIGHT, width: 700, height: ROW_HEIGHT, x: 0, y: top };
    return { ...rect, toJSON: () => rect } as DOMRect;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('measurePairs', () => {
  it('reads each element rectangle once, so calls grow linearly with rows and bars', () => {
    const counts = [20, 80].map((rows) => {
      const pane = buildPane(rows, 5);
      calls = 0;
      const pairs = measurePairs([pane]);
      expect(pairs.length).toBe(rows - 5);
      return { rows, bars: pane.bars.length, calls };
    });
    for (const { rows, bars, calls: n } of counts) expect(n).toBeLessThanOrEqual(2 * (rows + bars) + 5);
  });

  it('keeps the lane geometry of the row-by-row measurement', () => {
    const pane = buildPane(10, 2);
    const pair = measurePairs([pane]).find(p => p.from.id === 'a7')!;
    // Rows r7..r9 are crossed; r9 is the pane's last row and may spill 28px below.
    expect(pair.lane!.rows.map(r => [r.left, r.right, r.minY, r.maxY])).toEqual([
      [0, 500, 701, 799], [0, 500, 801, 899], [0, 500, 901, 1028]
    ]);
    expect(pair.lane!.rows[0]!.barBottom - pair.lane!.rows[0]!.barTop).toBe(70);
  });
});

describe('PlanningBoardPieceLinks resize observer', () => {
  it('does not measure again on the first notification, only on a size change', () => {
    let notify: ResizeObserverCallback = () => {};
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { notify = callback; }
      observe(element: Element) { observed.push(element); }
      unobserve() {}
      disconnect() {}
    });
    const pane = buildPane(6, 2);
    const contentCalls = vi.spyOn(pane.content.current!, 'getBoundingClientRect');
    render(<PlanningBoardPieceLinks panes={[pane]} />);
    expect(observed.length).toBeGreaterThan(1);
    const measured = () => contentCalls.mock.calls.length;
    // jsdom lays nothing out, so the size seen at observe() is 0x0.
    const entry = (target: Element, width: number, height: number) =>
      ({ target, borderBoxSize: [{ inlineSize: width, blockSize: height }] }) as unknown as ResizeObserverEntry;
    const before = measured();

    act(() => notify(observed.map(target => entry(target, 0, 0)), {} as ResizeObserver));
    expect(measured()).toBe(before);

    act(() => notify([entry(observed[1]!, 0, 0)], {} as ResizeObserver));
    expect(measured()).toBe(before);

    act(() => notify([entry(observed[1]!, 700, 140)], {} as ResizeObserver));
    expect(measured()).toBeGreaterThan(before);
  });

  it('measures again when the first notification already reports a changed size', () => {
    let notify: ResizeObserverCallback = () => {};
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { notify = callback; }
      observe(element: Element) { observed.push(element); }
      unobserve() {}
      disconnect() {}
    });
    const pane = buildPane(6, 2);
    const contentCalls = vi.spyOn(pane.content.current!, 'getBoundingClientRect');
    render(<PlanningBoardPieceLinks panes={[pane]} />);
    const before = contentCalls.mock.calls.length;
    act(() => notify([{ target: observed[1]!, borderBoxSize: [{ inlineSize: 700, blockSize: 140 }] } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    expect(contentCalls.mock.calls.length).toBeGreaterThan(before);
  });
});
