import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: MouseEventInit & { pointerId?: number; pointerType?: string } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}
const item = (overrides: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId: 'a', kind: 'row', itemRevision: 'r1', version: 1, sourceRowId: 'a',
  fseiban: '26-1001', fhincd: 'P1', fhinmei: '部品', machineName: '機種', productNo: '1', processOrder: '10',
  originalResourceCd: '305', effectiveResourceCd: null, originalDueDate: '2026-10-16', effectiveDueDate: null,
  originalRank: null, alternateRank: null, plannedQuantity: 1, requiredMinutes: 480, requiredMinutesKnown: true,
  isCompleted: false, progress: { completed: 0, total: 1, quantityKnown: true }, ...overrides
});
function props(items: GrindingPlanningBoardItem[] = [item()]) {
  return {
    layout: buildPlanningBoardGanttLayout({ items, allocation: 'alternate', view: 'resource', seibanOrder: [], resources: ['305'],
      dailyHoursByResource: {}, today: '2026-10-14', scale: 14 }),
    scale: 14, dailyHoursByResource: {}, resourceNameMap: {}, capacityPending: false, capacityError: false,
    onCapacityChange: vi.fn(), onToggleItem: vi.fn(), onDueDrop: vi.fn(), disabled: false, dragDisabled: false,
    selectedItemIds: new Set<string>(), resourceView: true
  };
}
describe('PlanningBoardGanttView', () => {
  beforeEach(() => vi.stubGlobal('PointerEvent', TestPointerEvent));
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  it('ドラッグはRAFで表示し、今日で止まり、指を離して納期を確定する', async () => {
    const values = props();
    render(<PlanningBoardGanttView {...values} />);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    const capture = vi.fn();
    Object.defineProperty(bar, 'setPointerCapture', { value: capture });
    fireEvent.pointerDown(bar, { clientX: 500, clientY: 20, button: 0 });
    expect(capture).toHaveBeenCalledWith(1);
    fireEvent.pointerMove(bar, { clientX: 100, clientY: 20 });
    expect(values.onDueDrop).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('納期 10/14')).toBeVisible());
    fireEvent.pointerUp(bar, { clientX: 100, clientY: 20 });
    expect(values.onDueDrop).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'a' }), '2026-10-14');
    fireEvent.click(bar);
    expect(values.onToggleItem).not.toHaveBeenCalled();
  });
  it('元割当・操作禁止では移動を保存せず、完了アイテムは選べない', () => {
    const values = props([item(), item({ itemId: 'b', isCompleted: true })]);
    render(<PlanningBoardGanttView {...values} dragDisabled />);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.pointerDown(bar, { clientX: 100, button: 0 });
    fireEvent.pointerUp(bar, { clientX: 500 });
    expect(values.onDueDrop).not.toHaveBeenCalled();
    const completed = screen.getByTestId('planning-gantt-bar-b');
    expect(completed).toBeDisabled();
    fireEvent.click(completed);
    expect(values.onToggleItem).not.toHaveBeenCalled();
  });
  it('固定幅の所要不明と納期なしを表示する', () => {
    const values = props([item({ requiredMinutesKnown: false }), item({ itemId: 'b', originalDueDate: null })]);
    const { rerender } = render(<PlanningBoardGanttView {...values} />);
    expect(screen.getByText(/所要不明/)).toHaveStyle({ width: '72px' });
    expect(screen.getByText('納期なし')).toBeInTheDocument();
    expect(screen.queryByTestId('planning-gantt-bar-b')).not.toBeInTheDocument();
    rerender(<PlanningBoardGanttView {...values} scale={56} />);
    expect(screen.getByText(/所要不明/)).toHaveStyle({ width: '72px' });
  });
  it('選択した部品の他工程を白枠にし、無関係な工程を薄くする', () => {
    const values = props([item(), item({ itemId: 'b', processOrder: '20' }), item({ itemId: 'c', fhincd: 'P2' })]);
    render(<PlanningBoardGanttView {...values} selectedItemIds={new Set(['a'])} />);
    expect(screen.getByTestId('planning-gantt-bar-a').firstElementChild).toHaveClass('outline-emerald-300');
    expect(screen.getByTestId('planning-gantt-bar-b').firstElementChild).toHaveClass('outline-white');
    expect(screen.getByTestId('planning-gantt-bar-c').firstElementChild).toHaveClass('opacity-30');
  });
  it('資源の稼働時間を8/10/24Hで選び、保存中は再操作を止める', () => {
    const values = props();
    const { rerender } = render(<PlanningBoardGanttView {...values} />);
    const group = screen.getByRole('group', { name: '305の1日の稼働時間' });
    expect(within(group).getByRole('button', { name: '8H' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(group).getByRole('button', { name: '10H' }));
    expect(values.onCapacityChange).toHaveBeenCalledWith('305', 10);
    rerender(<PlanningBoardGanttView {...values} capacityPending />);
    expect(within(group).getByRole('button', { name: '24H' })).toBeDisabled();
  });
});

describe('forward PlanningBoardGanttView', () => {
  beforeEach(() => vi.stubGlobal('PointerEvent', TestPointerEvent));
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
  function forwardProps(items = [item({ requiredMinutes: 60, alternateRank: 1 }), item({ itemId: 'b', fhincd: 'P2', requiredMinutes: 60, alternateRank: 2 })]) {
    return { ...props(items), scale: 2, onResourceReorder: vi.fn(),
      layout: buildPlanningBoardGanttLayout({ items, mode: 'forward', allocation: 'alternate', view: 'resource', seibanOrder: [], resources: ['305'],
        dailyHoursByResource: {}, today: '2026-10-14', now: new Date('2026-10-14T10:00:00+09:00'), scale: 2 }) };
  }
  it.each([['a', 'b', 300, 'after'], ['b', 'a', 0, 'before']] as const)('drags %s %s %i %s with a white insertion marker', (source, target, destination, placement) => {
    const values = forwardProps();
    render(<PlanningBoardGanttView {...values} />);
    const bar = screen.getByTestId(`planning-gantt-bar-${source}`);
    fireEvent.pointerDown(bar, { clientX: 100, button: 0 });
    fireEvent.pointerMove(bar, { clientX: destination });
    expect(screen.getByTestId('planning-gantt-insertion')).toHaveClass('bg-white');
    fireEvent.pointerUp(bar, { clientX: destination });
    expect(values.onResourceReorder).toHaveBeenCalledWith(expect.objectContaining({ itemId: source }), expect.objectContaining({ itemId: target }), placement);
    expect(values.onDueDrop).not.toHaveBeenCalled();
    fireEvent.click(bar);
    expect(values.onToggleItem).not.toHaveBeenCalled();
  });
  it('treats movement under 8px as a tap and displays planned details', () => {
    const values = forwardProps();
    render(<PlanningBoardGanttView {...values} />);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.pointerDown(bar, { clientX: 100, button: 0 });
    fireEvent.pointerUp(bar, { clientX: 107 });
    fireEvent.click(bar);
    expect(values.onResourceReorder).not.toHaveBeenCalled();
    expect(values.onToggleItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'a' }), true);
    expect(screen.getByText(/着手見込み 10\/14 10:00/)).toBeInTheDocument();
    expect(screen.getByText(/終了見込み 10\/14 11:00/)).toBeInTheDocument();
    expect(screen.getByText('2件 · 今日 2.0h')).toBeInTheDocument();
  });
  it('blocks reorder when disabled or across special-due bands', () => {
    const values = forwardProps();
    const { rerender } = render(<PlanningBoardGanttView {...values} dragDisabled />);
    const dragBar = () => {
      const bar = screen.getByTestId('planning-gantt-bar-a');
      fireEvent.pointerDown(bar, { clientX: 100, button: 0 }); fireEvent.pointerUp(bar, { clientX: 300 });
    };
    dragBar();
    expect(values.onResourceReorder).not.toHaveBeenCalled();
    const special = forwardProps([item({ specialDue: { kind: 'today', expiresAt: '2026-10-14T15:00:00Z' }, requiredMinutes: 60 }), item({ itemId: 'b', fhincd: 'P2', requiredMinutes: 60 })]);
    rerender(<PlanningBoardGanttView {...special} />);
    dragBar();
    expect(special.onResourceReorder).not.toHaveBeenCalled();
  });
  it('shows completed-only guidance and starts the viewport at today', () => {
    const values = forwardProps([item({ isCompleted: true })]);
    render(<PlanningBoardGanttView {...values} />);
    expect(screen.getByText('完了は「納期から」で表示')).toBeInTheDocument();
    expect(screen.queryByTestId('planning-gantt-bar-a')).not.toBeInTheDocument();
    expect(screen.getByLabelText('ガントの日付と工程').scrollLeft).toBe(0);
  });
  it('uses two lines at scale 1 and 2 and minutes at other scales, keeping process order only in the accessible label', () => {
    const values = forwardProps([item({ requiredMinutes: 480, processOrder: '987' })]);
    const { rerender } = render(<PlanningBoardGanttView {...values} />);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    expect(bar).toHaveTextContent('部品26-1001 · P1 · 1個 · 機種');
    expect(bar).not.toHaveTextContent('987');
    expect(bar).toHaveAccessibleName(/工順987/);
    rerender(<PlanningBoardGanttView {...values} scale={1} />);
    expect(bar).toHaveTextContent('部品26-1001 · P1 · 1個 · 機種');
    rerender(<PlanningBoardGanttView {...values} scale={4} />);
    expect(bar).toHaveTextContent('部品480分');
    expect(bar).not.toHaveTextContent('P1');
    rerender(<PlanningBoardGanttView {...values} scale={56} />);
    expect(bar).toBeEmptyDOMElement();
  });
  it('omits missing details and keeps the dashed unknown marker without process order', () => {
    const values = forwardProps([item({ requiredMinutes: 480, plannedQuantity: null, machineName: null }),
      item({ itemId: 'b', fhincd: 'P2', requiredMinutesKnown: false })]);
    render(<PlanningBoardGanttView {...values} />);
    expect(screen.getByTestId('planning-gantt-bar-a')).toHaveTextContent('部品26-1001 · P1');
    expect(screen.getByTestId('planning-gantt-bar-a')).not.toHaveTextContent('個');
    expect(screen.getByTestId('planning-gantt-bar-b')).toHaveTextContent(/^所要不明$/);
    expect(screen.getByTestId('planning-gantt-bar-b')).toHaveClass('border-dashed');
  });
  it('subtracts 2px from every segment without changing time positions and keeps tiny bars visible', () => {
    const values = forwardProps([item({ requiredMinutes: 600 }), item({ itemId: 'b', fhincd: 'P2', requiredMinutes: 1 })]);
    render(<PlanningBoardGanttView {...values} />);
    const bars = values.layout.groups[0]!.rows[0]!.bars;
    const dayWidth = (1120 - 320) / 2;
    bars[0]!.segments!.forEach((segment, index) => {
      const element = screen.getByTestId(`planning-gantt-bar-a${index ? `-segment-${index}` : ''}`);
      expect(parseFloat(element.style.width)).toBeCloseTo(Math.max(2, (segment.end - segment.start) * dayWidth - 2));
      expect(parseFloat(element.style.left)).toBeCloseTo((segment.start - values.layout.start) * dayWidth);
    });
    expect(screen.getByTestId('planning-gantt-bar-b')).toHaveStyle({ width: '2px' });
  });
  it('opens the eight-card window two before the hovered job with queue positions and amber highlight', () => {
    const values = forwardProps(Array.from({ length: 12 }, (_, i) => item({ itemId: `job-${i}`, fhincd: `P${i}`,
      fhinmei: `部品${i}`, requiredMinutes: 10, alternateRank: i + 1, originalDueDate: '2026-10-13' })));
    render(<PlanningBoardGanttView {...values} resourceNameMap={{ '305': ['研削盤'] }} />);
    fireEvent.pointerEnter(screen.getByTestId('planning-gantt-bar-job-5'), { pointerType: 'mouse' });
    const popover = screen.getByRole('region', { name: '305 研削盤 の次にやる順' });
    const cards = within(popover).getAllByTestId(/planning-forward-queue-card-/);
    expect(cards).toHaveLength(8);
    expect(cards[0]).toHaveTextContent('4. 10分');
    expect(cards[7]).toHaveTextContent('11. 10分');
    expect(cards[2]).toHaveClass('outline-amber-400', 'border-rose-400');
    expect(cards[0]).not.toHaveClass('outline-amber-400');
    expect(cards[2]).toHaveTextContent('26-1001 · P5 · 1個');
    expect(cards[2]).not.toHaveTextContent('〜');
    expect(cards[2]).toHaveTextContent('機種');
    expect(popover).not.toHaveTextContent('遅れ見込み');
    expect(popover.parentElement).toBe(document.body);
  });
  it('clamps the fixed popover inside the viewport near the bottom-right corner', () => {
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.getAttribute('role') === 'region'
        ? { width: 330, height: 160 } as DOMRect
        : { left: window.innerWidth - 10, bottom: window.innerHeight - 5 } as DOMRect;
    });
    try {
      render(<PlanningBoardGanttView {...forwardProps()} />);
      fireEvent.pointerEnter(screen.getByTestId('planning-gantt-bar-a'));
      expect(screen.getByRole('region', { name: /の次にやる順/ })).toHaveStyle({ left: `${window.innerWidth - 338}px`, top: `${window.innerHeight - 168}px` });
    } finally { measure.mockRestore(); }
  });
  it('waits 300ms after leaving and cancels hiding on entering the popover', () => {
    vi.useFakeTimers();
    render(<PlanningBoardGanttView {...forwardProps()} />);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.pointerEnter(bar);
    fireEvent.pointerLeave(bar);
    act(() => vi.advanceTimersByTime(299));
    expect(screen.getByRole('region', { name: /の次にやる順/ })).toBeInTheDocument();
    fireEvent.pointerEnter(screen.getByRole('region', { name: /の次にやる順/ }));
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole('region', { name: /の次にやる順/ })).toBeInTheDocument();
    fireEvent.pointerLeave(screen.getByRole('region', { name: /の次にやる順/ }));
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
    fireEvent.pointerEnter(bar);
    fireEvent.pointerLeave(bar);
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
  });
  it.each(['touch', 'pen'])('opens on a %s tap while preserving selection and detail, and closes outside', (pointerType) => {
    vi.useFakeTimers();
    const values = forwardProps();
    render(<PlanningBoardGanttView {...values} />);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.pointerEnter(bar, { pointerType });
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
    fireEvent.pointerDown(bar, { pointerType, clientX: 100, button: 0 });
    fireEvent.pointerUp(bar, { pointerType, clientX: 107 });
    fireEvent.pointerLeave(bar, { pointerType });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.click(bar);
    expect(screen.getByRole('region', { name: /の次にやる順/ })).toBeInTheDocument();
    expect(values.onToggleItem).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'a' }), true);
    expect(screen.getByText(/着手見込み/)).toBeInTheDocument();
    fireEvent.pointerDown(document.body, { pointerType });
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
  });
  it('closes on Escape, viewport scroll, bar drag, scale, data and mode changes', () => {
    const values = forwardProps();
    const { rerender } = render(<PlanningBoardGanttView {...values} />);
    const open = () => fireEvent.pointerEnter(screen.getByTestId('planning-gantt-bar-a'));
    open(); fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
    open(); fireEvent.scroll(screen.getByLabelText('ガントの日付と工程'));
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
    open();
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.pointerDown(bar, { clientX: 100, button: 0 });
    fireEvent.pointerMove(bar, { clientX: 108 });
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
    fireEvent.pointerCancel(bar);
    open(); rerender(<PlanningBoardGanttView {...values} scale={4} />);
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
    open(); rerender(<PlanningBoardGanttView {...forwardProps()} scale={4} />);
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
    open(); rerender(<PlanningBoardGanttView {...props()} />);
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
  });
  function dragQueue(source: string, destination: number) {
    const cards = screen.getAllByTestId(/planning-forward-queue-card-/);
    cards.forEach((card, index) => vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({ left: index * 156, width: 150 } as DOMRect));
    const card = screen.getByTestId(`planning-forward-queue-card-${source}`);
    fireEvent.pointerDown(card, { clientX: source === 'a' ? 50 : 200, button: 0 });
    fireEvent.pointerMove(card, { clientX: destination });
    return card;
  }
  it.each([['a', 'b', 350, 'after'], ['b', 'a', 0, 'before']] as const)('reorders card %s relative to %s %i %s', (source, target, destination, placement) => {
    const values = forwardProps();
    render(<PlanningBoardGanttView {...values} />);
    fireEvent.pointerEnter(screen.getByTestId('planning-gantt-bar-a'));
    const card = dragQueue(source, destination);
    const marker = screen.getByTestId('planning-forward-queue-insertion');
    expect(marker).toHaveClass('bg-white', placement === 'before' ? '-left-1.5' : '-right-1');
    fireEvent.pointerUp(card, { clientX: destination });
    expect(values.onResourceReorder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: source }), expect.objectContaining({ itemId: target }), placement);
    expect(values.onToggleItem).not.toHaveBeenCalled();
  });
  it.each(['dragDisabled', 'disabled', 'resourceView', 'specialDue', 'threshold', 'cancel'] as const)('blocks queue reorder for %s', (guard) => {
    const values = forwardProps(guard === 'specialDue' ? [item({ specialDue: { kind: 'today', expiresAt: '2026-10-14T15:00:00Z' } }), item({ itemId: 'b', fhincd: 'P2' })] : undefined);
    render(<PlanningBoardGanttView {...values} disabled={guard === 'disabled'} dragDisabled={guard === 'dragDisabled'} resourceView={guard !== 'resourceView'} />);
    fireEvent.pointerEnter(screen.getByTestId('planning-gantt-bar-a'));
    const destination = guard === 'threshold' ? 57 : 350;
    const card = dragQueue('a', destination);
    if (guard === 'cancel') fireEvent.pointerCancel(card);
    else expect(screen.queryByTestId('planning-forward-queue-insertion')).not.toBeInTheDocument();
    fireEvent.pointerUp(card, { clientX: destination });
    expect(values.onResourceReorder).not.toHaveBeenCalled();
  });

});
