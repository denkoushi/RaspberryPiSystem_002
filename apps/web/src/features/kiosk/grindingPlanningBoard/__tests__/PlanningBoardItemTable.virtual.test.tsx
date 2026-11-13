import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { productionFixture } from '../__perf__/fixture';
import { PlanningBoardFocusView } from '../PlanningBoardFocusView';
import { PlanningBoardItemTable } from '../PlanningBoardItemTable';
import { PlanningBoardResourceView } from '../PlanningBoardResourceView';
import { PlanningBoardSeibanPane } from '../PlanningBoardSeibanPane';

const items = productionFixture(120).items.map((item, index) => ({ ...item,
  originalResourceCd: '305', effectiveResourceCd: '305', fseiban: `s-${index}`, originalRank: index, alternateRank: index
}));
const base = { items, allocation: 'alternate' as const, selectedItemIds: new Set<string>(),
  onToggleItem: vi.fn(), onResourceClick: vi.fn(), tableLabel: '工程' };
let mediaListener: (() => void) | undefined;
let printMatches = false;

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function () {
    return (this as HTMLElement).hasAttribute('data-resource-scroll') ? 315 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const element = this as HTMLElement;
    return { top: 0, left: 0, bottom: 60, right: 400, width: 400,
      height: element.tagName === 'TR' ? 60 : 315, x: 0, y: 0, toJSON: () => ({}) };
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(10000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(315);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: function ({ top }: { top: number }) {
    this.scrollTop = top;
    // Real browsers deliver scroll events after the current layout effect.
    queueMicrotask(() => { if (this.isConnected) fireEvent.scroll(this); });
  } });
  vi.stubGlobal('matchMedia', () => ({ get matches() { return printMatches; },
    addEventListener: (_: string, listener: () => void) => { mediaListener = listener; }, removeEventListener: vi.fn() }));
});
afterEach(() => { printMatches = false; mediaListener = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const rowCount = () => document.querySelectorAll('[data-planning-board-item-id]').length;
const draw = (extra = {}) => <div data-resource-scroll><PlanningBoardItemTable {...base} virtualize {...extra} /></div>;

describe('planning board resource table virtualization', () => {
  it('renders a bounded set of measured table rows and keeps the default tables complete', () => {
    const view = render(draw());
    expect(rowCount()).toBeGreaterThanOrEqual(7);
    expect(rowCount()).toBeLessThan(items.length);
    expect(document.querySelector('tbody')?.children[0].tagName).toBe('TR');
    view.rerender(<PlanningBoardItemTable {...base} />);
    expect(rowCount()).toBe(items.length);
  });
  it('renders every row synchronously for print events and restores virtualization', () => {
    render(draw());
    fireEvent(window, new Event('beforeprint'));
    expect(rowCount()).toBe(items.length);
    fireEvent(window, new Event('afterprint'));
    expect(rowCount()).toBeLessThan(items.length);
    act(() => { printMatches = true; mediaListener?.(); });
    expect(rowCount()).toBe(items.length);
    act(() => { printMatches = false; mediaListener?.(); });
    expect(rowCount()).toBeLessThan(items.length);
  });
  it.each(['seiban', 'focus'])('keeps every row in the %s view', (mode) => {
    const props = { ...base, fseiban: 's', machineName: null, onToggleAll: vi.fn() };
    render(mode === 'focus'
      ? <PlanningBoardFocusView {...props} onBack={vi.fn()} />
      : <PlanningBoardSeibanPane {...props} isOpen isFocused={false} onToggleOpen={vi.fn()} onFocus={vi.fn()} />);
    expect(rowCount()).toBe(items.length);
  });
  it('scrolls to the first matching item on a new scan, without moving on refresh', async () => {
    const view = render(draw());
    expect(screen.queryByTestId(`planning-board-item-${items[90].itemId}`)).toBeNull();
    view.rerender(draw({ focusedSeiban: items[90].fseiban, scanFocusKey: 1 }));
    await act(async () => {});
    expect(screen.getByTestId(`planning-board-item-${items[90].itemId}`)).toBeInTheDocument();
    const scroll = document.querySelector<HTMLDivElement>('[data-resource-scroll]')!;
    expect(scroll.scrollTop).toBeGreaterThan(0);
    act(() => { scroll.scrollTop = 1000; fireEvent.scroll(scroll); });
    await act(async () => {});
    const beforeRefresh = scroll.scrollTop;
    view.rerender(draw({ focusedSeiban: items[90].fseiban, scanFocusKey: 1, items: [...items] }));
    expect(scroll.scrollTop).toBe(beforeRefresh);
  });
  it('keeps the captured drag source mounted across scrolling and releases it afterwards', () => {
    const view = render(draw({ draggedItemId: items[15].itemId }));
    const source = screen.getByTestId(`planning-board-item-${items[15].itemId}`);
    const scroll = document.querySelector<HTMLDivElement>('[data-resource-scroll]')!;
    act(() => { scroll.scrollTop = 4000; fireEvent.scroll(scroll); });
    expect(screen.getByTestId(`planning-board-item-${items[15].itemId}`)).toBe(source);
    view.rerender(draw());
    expect(source.isConnected).toBe(false);
  });
  it('reorders onto a newly rendered row while the captured source remains mounted', async () => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: MouseEventInit & { pointerId?: number }) {
        super(type, init); this.pointerId = init.pointerId ?? 0;
      }
    });
    const onResourceReorder = vi.fn();
    render(<PlanningBoardResourceView {...base} resources={['305']} resourceNameMap={{}}
      seibanOrder={items.map((item) => item.fseiban)} onResourceReorder={onResourceReorder} />);
    const pane = document.querySelector<HTMLElement>('[data-planning-board-resource-pane]')!;
    const scroll = pane.querySelector<HTMLDivElement>('[data-resource-scroll]')!;
    // Begin outside the seven rows retained for pane measurement.
    act(() => { scroll.scrollTop = 500; fireEvent.scroll(scroll); });
    const sourceRow = screen.getByTestId(`planning-board-item-${items[10].itemId}`);
    const button = within(sourceRow).getByRole('button', { name: '資源CD 305を変更' });
    const capture = vi.fn(); button.setPointerCapture = capture;
    fireEvent.pointerDown(button, { pointerId: 7, button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(pane, { pointerId: 7, clientX: 40, clientY: 10 });
    expect(capture).toHaveBeenCalledWith(7);
    act(() => { scroll.scrollTop = 4000; fireEvent.scroll(scroll); });
    await act(async () => {});
    expect(sourceRow.isConnected).toBe(true);
    const targetRow = [...pane.querySelectorAll<HTMLElement>('[data-planning-board-item-id]')].at(-1)!;
    const target = items.find((item) => item.itemId === targetRow.dataset.planningBoardItemId)!;
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [targetRow]) });
    fireEvent.pointerUp(button, { pointerId: 7, clientX: 40, clientY: 10 });
    expect(onResourceReorder).toHaveBeenCalledWith(items[10], target, 'before');
    expect(sourceRow.isConnected).toBe(false);
  });
  it('uses the first seven real row heights for pane height, also when scrolled', () => {
    render(<PlanningBoardResourceView {...base} resources={['305']} resourceNameMap={{}} seibanOrder={items.map((item) => item.fseiban)} />);
    const pane = document.querySelector<HTMLElement>('[data-planning-board-resource-pane]')!;
    expect(pane.style.height).toBe('466px'); // 7 * 60 + 46
    const scroll = pane.querySelector<HTMLDivElement>('[data-resource-scroll]')!;
    act(() => { scroll.scrollTop = 4000; fireEvent.scroll(scroll); });
    expect(pane.style.height).toBe('466px');
    expect([...pane.querySelectorAll('tbody tr[data-planning-board-item-id]')].slice(0, 7)
      .map((row) => row.getAttribute('data-index'))).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  });
});
