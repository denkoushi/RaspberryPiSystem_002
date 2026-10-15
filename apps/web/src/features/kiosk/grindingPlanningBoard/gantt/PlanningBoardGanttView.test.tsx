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
  it.each(['pointerUp', 'pointerCancel', 'lostPointerCapture'] as const)('pans with the middle button and stops on %s', (end) => {
    const values = props();
    render(<PlanningBoardGanttView {...values} />);
    const viewport = screen.getByLabelText('ガントの日付と工程');
    viewport.scrollLeft = 200;
    viewport.scrollTop = 100;
    const bar = screen.getByTestId('planning-gantt-bar-a');
    expect(fireEvent.pointerDown(bar, { pointerId: 9, button: 1, clientX: 100, clientY: 100 })).toBe(false);
    const cover = document.querySelector<HTMLElement>('[data-planning-gantt-pan-cover]')!;
    expect(cover).toHaveClass('fixed', 'inset-0', 'cursor-grabbing');
    expect(viewport.style.cursor).toBe('');
    fireEvent.pointerMove(cover, { pointerId: 10, clientX: 130, clientY: 120 });
    expect(viewport.scrollLeft).toBe(200);
    fireEvent.pointerMove(cover, { pointerId: 9, clientX: 130, clientY: 120 });
    expect(viewport.scrollLeft).toBe(170);
    expect(viewport.scrollTop).toBe(80);
    fireEvent[end](cover, { pointerId: 9, button: 1 });
    expect(document.querySelector('[data-planning-gantt-pan-cover]')).toBeNull();
    fireEvent.pointerMove(cover, { pointerId: 9, clientX: 150, clientY: 150 });
    expect(viewport.scrollLeft).toBe(170);
    expect(viewport.scrollTop).toBe(80);
    expect(fireEvent(viewport, new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }))).toBe(false);
    expect(values.onDueDrop).not.toHaveBeenCalled();
    expect(values.onToggleItem).not.toHaveBeenCalled();
  });
  it.each(['backward', 'forward'] as const)('shows one small header per category in %s resource view', (mode) => {
    const layout = buildPlanningBoardGanttLayout({ items: [item()], allocation: 'alternate', view: 'resource',
      seibanOrder: [], resources: ['100', '305', '584'], category: 'all', resourceCategories: { '100': 'cutting', '305': 'grinding', '584': 'grinding' },
      dailyHoursByResource: {}, today: '2026-10-14', scale: 14, mode });
    const { rerender } = render(<PlanningBoardGanttView {...props()} layout={layout} />);
    const headers = screen.getAllByTestId('planning-gantt-category-header');
    expect(headers.map((header) => header.textContent)).toEqual(['研削', '切削']);
    expect(headers[0]).toHaveClass('h-6', 'bg-slate-800', 'font-bold', 'text-[11px]');
    expect(headers[0]!.firstChild).toHaveClass('sticky', 'left-0');
    rerender(<PlanningBoardGanttView {...props()} />);
    expect(screen.queryByTestId('planning-gantt-category-header')).not.toBeInTheDocument();
  });
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
        dailyHoursByResource: {}, today: '2026-10-14', now: new Date('2026-10-14T09:00:00+09:00'), scale: 2 }) };
  }
  const chainItems = () => [item({ itemId: 'b', processOrder: '20', originalResourceCd: '306', requiredMinutes: 60 }),
    item({ processOrder: '2', requiredMinutes: 480 }), item({ itemId: 'c', fhincd: 'P2', requiredMinutes: 60 })];
  const tap = (bar: HTMLElement) => {
    fireEvent.pointerDown(bar, { clientX: 100, clientY: 20, button: 0 });
    fireEvent.pointerUp(bar, { clientX: 107, clientY: 20 });
    fireEvent.click(bar);
  };
  it('focuses a part across resource rows in process order, switches parts and toggles closed', () => {
    const values = forwardProps(chainItems());
    render(<PlanningBoardGanttView {...values} resourceNameMap={{ '306': ['306 ＮＣ研削盤'] }} selectedItemIds={new Set(['a', 'c'])} />);
    const a = screen.getByTestId('planning-gantt-bar-a');
    const b = screen.getByTestId('planning-gantt-bar-b');
    expect(a).toHaveClass('outline-emerald-300');
    expect(screen.getByTestId('planning-gantt-due-a')).toHaveTextContent('▲');
    tap(b);
    const strip = screen.getByRole('region', { name: '工程のつながり' });
    expect(strip).toHaveTextContent('26-1001 · P1 · 2工程');
    const steps = within(strip).getAllByRole('button');
    expect(steps[0]).toHaveTextContent('工順2 · 305');
    expect(steps[1]).toHaveTextContent('工順20 · 306 NC研削盤');
    expect(a).toHaveClass('outline-white');
    expect(a).not.toHaveClass('outline-emerald-300');
    expect(a).toHaveAttribute('aria-pressed', 'true');
    expect(b).toHaveClass('outline-white');
    expect(screen.getByTestId('planning-gantt-chain-badge-a')).toHaveTextContent(/^1$/);
    expect(screen.getByTestId('planning-gantt-chain-badge-b')).toHaveTextContent(/^2$/);
    expect(screen.getByTestId('planning-gantt-bar-a-segment-1')).toHaveClass('outline-white');
    expect(within(screen.getByTestId('planning-gantt-bar-a-segment-1')).queryByText(/^1$/)).not.toBeInTheDocument();
    expect(screen.getByTestId('planning-gantt-bar-c')).toHaveClass('opacity-30', 'outline-emerald-300');
    expect(values.onToggleItem).not.toHaveBeenCalled();
    tap(b);
    expect(screen.queryByTestId('planning-gantt-chain-strip')).not.toBeInTheDocument();
    tap(a);
    tap(screen.getByTestId('planning-gantt-bar-c'));
    expect(screen.getByTestId('planning-gantt-chain-strip')).toHaveTextContent('P2 · 1工程');
    expect(screen.queryByTestId('planning-gantt-chain-link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '工程のつながりを閉じる' }));
    expect(screen.queryByTestId('planning-gantt-chain-strip')).not.toBeInTheDocument();
  });
  it.each(['horizontal', 'vertical', 'diagonal', 'cancel', 'capture', 'unmount'] as const)('cancels long press on %s', (reason) => {
    vi.useFakeTimers();
    const values = forwardProps();
    const { unmount } = render(<PlanningBoardGanttView {...values} />);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.pointerDown(bar, { clientX: 100, clientY: 20, button: 0 });
    act(() => vi.advanceTimersByTime(499));
    if (reason === 'cancel') fireEvent.pointerCancel(bar);
    else if (reason === 'capture') fireEvent.lostPointerCapture(bar);
    else if (reason === 'unmount') unmount();
    else fireEvent.pointerMove(bar, { clientX: reason === 'vertical' ? 100 : reason === 'diagonal' ? 106 : 110, clientY: reason === 'horizontal' ? 20 : reason === 'diagonal' ? 26 : 30 });
    act(() => vi.advanceTimersByTime(501));
    fireEvent.pointerUp(bar, { clientX: 100, clientY: 20 });
    fireEvent.click(bar);
    expect(values.onToggleItem).not.toHaveBeenCalled();
    expect(screen.queryByTestId('planning-gantt-chain-strip')).not.toBeInTheDocument();
  });
  it('selects exactly at 500ms only once and preserves chain focus on long press', () => {
    vi.useFakeTimers();
    const values = forwardProps();
    render(<PlanningBoardGanttView {...values} selectedItemIds={new Set(['b'])} />);
    tap(screen.getByTestId('planning-gantt-bar-a'));
    const b = screen.getByTestId('planning-gantt-bar-b');
    fireEvent.pointerDown(b, { clientX: 100, button: 0 });
    act(() => vi.advanceTimersByTime(499));
    expect(values.onToggleItem).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(values.onToggleItem).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: 'b' }), false);
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.pointerUp(b, { clientX: 100 });
    fireEvent.click(b);
    expect(values.onToggleItem).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('planning-gantt-chain-strip')).toHaveTextContent('P1 · 1工程');
  });
  it('clears focus when the part disappears or the mode changes', () => {
    const values = forwardProps();
    const { rerender } = render(<PlanningBoardGanttView {...values} />);
    tap(screen.getByTestId('planning-gantt-bar-a'));
    rerender(<PlanningBoardGanttView {...forwardProps([item({ fhincd: 'P2' })])} />);
    expect(screen.queryByTestId('planning-gantt-chain-strip')).not.toBeInTheDocument();
    rerender(<PlanningBoardGanttView {...values} />);
    expect(screen.queryByTestId('planning-gantt-chain-strip')).not.toBeInTheDocument();
    tap(screen.getByTestId('planning-gantt-bar-a'));
    rerender(<PlanningBoardGanttView {...props()} />);
    expect(screen.queryByTestId('planning-gantt-chain-strip')).not.toBeInTheDocument();
  });
  it('measures segment endpoints, remeasures on scale/resize and scrolls to the current step', () => {
    const values = forwardProps(chainItems());
    const { rerender } = render(<PlanningBoardGanttView {...values} />);
    const viewport = screen.getByLabelText('ガントの日付と工程');
    const content = viewport.firstElementChild as HTMLElement;
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, right: left + width, bottom: top + height, width, height } as DOMRect);
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(rect(10, 50, 3000, 500));
    vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => rect(10, screen.queryByTestId('planning-gantt-chain-strip') ? 180 : 100, 1120, 500));
    const segments = values.layout.groups.flatMap(group => group.rows.flatMap(row => row.bars)).find(bar => bar.item.itemId === 'a')!.segments!;
    const last = screen.getByTestId(`planning-gantt-bar-a-segment-${segments.length - 1}`);
    vi.spyOn(last, 'getBoundingClientRect').mockReturnValue(rect(500, 100, 80, 70));
    const measureNext = vi.spyOn(screen.getByTestId('planning-gantt-bar-b'), 'getBoundingClientRect').mockReturnValue(rect(700, 300, 40, 70));
    tap(screen.getByTestId('planning-gantt-bar-a'));
    expect(viewport).toHaveStyle({ height: `${window.innerHeight - 190}px` });
    const path = screen.getByTestId('planning-gantt-chain-link');
    expect(path).toHaveAttribute('d', 'M 570 85 C 630 85, 630 285, 690 285');
    expect(path).toHaveAttribute('stroke-dasharray', '6 4');
    expect(path).toHaveAttribute('stroke-width', '2.5');
    expect(screen.getByTestId('planning-gantt-chain-links').querySelector('circle')).toHaveAttribute('cx', '690');
    const step = within(screen.getByTestId('planning-gantt-chain-strip')).getByRole('button', { name: /工順20/ });
    fireEvent.click(step);
    expect(step).toHaveAttribute('aria-current', 'step');
    expect(step).toHaveClass('ring-white');
    expect(viewport.scrollLeft).toBe(66);
    expect(viewport.scrollTop).toBe(84);
    const scrollTo = vi.fn();
    Object.defineProperty(viewport, 'scrollTo', { configurable: true, value: scrollTo });
    fireEvent.click(step);
    expect(scrollTo).toHaveBeenCalledWith({ left: 132, top: 168, behavior: 'smooth' });
    measureNext.mockReturnValue(rect(800, 300, 40, 70));
    rerender(<PlanningBoardGanttView {...values} scale={4} />);
    expect(path).toHaveAttribute('d', 'M 570 85 C 680 85, 680 285, 790 285');
    measureNext.mockReturnValue(rect(900, 300, 40, 70));
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 1000 });
    fireEvent(window, new Event('resize'));
    expect(path).toHaveAttribute('d', 'M 570 85 C 730 85, 730 285, 890 285');
    fireEvent.click(screen.getByRole('button', { name: '工程のつながりを閉じる' }));
    expect(viewport).toHaveStyle({ height: `${window.innerHeight - 110}px` });
  });
  it('shows only the process order and machine in each strip step, without times', () => {
    const values = forwardProps([item({ requiredMinutes: 480, originalDueDate: '2026-10-13' }), item({ itemId: 'b', processOrder: '20', requiredMinutesKnown: false })]);
    render(<PlanningBoardGanttView {...values} />);
    tap(screen.getByTestId('planning-gantt-bar-a'));
    const strip = screen.getByTestId('planning-gantt-chain-strip');
    expect(within(strip).getByRole('button', { name: /工順10/ })).toHaveTextContent(/^1工順10 · 305$/);
    expect(within(strip).getByRole('button', { name: /工順20/ })).not.toHaveTextContent(/所要不明|遅れ見込み|予定|〜/);
  });
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
  it('selects on long press with movement under 8px without a chain strip', () => {
    vi.useFakeTimers();
    const values = forwardProps();
    render(<PlanningBoardGanttView {...values} />);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.pointerDown(bar, { clientX: 100, button: 0 });
    act(() => vi.advanceTimersByTime(500));
    fireEvent.pointerUp(bar, { clientX: 107 });
    fireEvent.click(bar);
    expect(values.onResourceReorder).not.toHaveBeenCalled();
    expect(values.onToggleItem).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: 'a' }), true);
    expect(screen.queryByTestId('planning-gantt-chain-strip')).not.toBeInTheDocument();
    expect(screen.queryByText(/着手見込み/)).not.toBeInTheDocument();
    expect(screen.queryByText(/件 · 今日/)).not.toBeInTheDocument();
  });
  it.each([false, true])('restores previous selection %s once when a held bar becomes a drag', (selected) => {
    vi.useFakeTimers();
    const values = forwardProps();
    const { rerender } = render(<PlanningBoardGanttView {...values} selectedItemIds={new Set(selected ? ['a'] : [])} />);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    fireEvent.pointerDown(bar, { clientX: 100, clientY: 20, button: 0 });
    act(() => vi.advanceTimersByTime(500));
    expect(values.onToggleItem).toHaveBeenNthCalledWith(1, expect.objectContaining({ itemId: 'a' }), !selected);
    rerender(<PlanningBoardGanttView {...values} selectedItemIds={new Set(selected ? [] : ['a'])} />);
    fireEvent.pointerMove(bar, { clientX: 107, clientY: 40 });
    expect(values.onToggleItem).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('planning-gantt-insertion')).not.toBeInTheDocument();
    fireEvent.pointerMove(bar, { clientX: 108, clientY: 20 });
    expect(values.onToggleItem).toHaveBeenNthCalledWith(2, expect.objectContaining({ itemId: 'a' }), selected);
    fireEvent.pointerMove(bar, { clientX: 300, clientY: 20 });
    expect(screen.getByTestId('planning-gantt-insertion')).toBeInTheDocument();
    fireEvent.pointerUp(bar, { clientX: 300, clientY: 20 });
    fireEvent.click(bar);
    expect(values.onToggleItem).toHaveBeenCalledTimes(2);
    expect(values.onResourceReorder).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ itemId: 'a' }), expect.objectContaining({ itemId: 'b' }), 'after');
    expect(screen.queryByTestId('planning-gantt-chain-strip')).not.toBeInTheDocument();
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
  it('fits ten hours at the one-day scale, ticks every hour, and opens an hour before now but not before 8:00', () => {
    const tenHourDay = (1120 - 168) / (10 / 24);
    const at = (time: string) => ({ ...forwardProps(), scale: 1, layout: buildPlanningBoardGanttLayout({ items: [item()], mode: 'forward', allocation: 'alternate', view: 'resource',
      seibanOrder: [], resources: ['305'], dailyHoursByResource: {}, today: '2026-10-14', now: new Date(`2026-10-14T${time}:00+09:00`), scale: 1 }) });
    const { unmount } = render(<PlanningBoardGanttView {...at('13:20')} />);
    expect(screen.getByLabelText('ガントの日付と工程').scrollLeft).toBeCloseTo(tenHourDay * 12 / 24);
    expect(screen.getAllByText('13時').length).toBeGreaterThan(0);
    unmount();
    render(<PlanningBoardGanttView {...at('07:30')} />);
    expect(screen.getByLabelText('ガントの日付と工程').scrollLeft).toBeCloseTo(tenHourDay * 8 / 24);
  });
  it('returns to the home position when the clock reaches a new hour', () => {
    const tenHourDay = (1120 - 168) / (10 / 24);
    const at = (time: string) => ({ ...forwardProps(), scale: 1, layout: buildPlanningBoardGanttLayout({ items: [item()], mode: 'forward', allocation: 'alternate', view: 'resource',
      seibanOrder: [], resources: ['305'], dailyHoursByResource: {}, today: '2026-10-14', now: new Date(`2026-10-14T${time}:00+09:00`), scale: 1 }) });
    const { rerender } = render(<PlanningBoardGanttView {...at('13:20')} />);
    const viewport = screen.getByLabelText('ガントの日付と工程');
    fireEvent.click(screen.getByRole('button', { name: '2時間進む' }));
    expect(viewport.scrollLeft).toBeCloseTo(tenHourDay * 14 / 24);
    rerender(<PlanningBoardGanttView {...at('13:50')} />);
    expect(viewport.scrollLeft).toBeCloseTo(tenHourDay * 14 / 24);
    rerender(<PlanningBoardGanttView {...at('14:00')} />);
    expect(viewport.scrollLeft).toBeCloseTo(tenHourDay * 13 / 24);
  });
  it('moves two hours with the arrow buttons and returns to today on each scale press', () => {
    const values = forwardProps([item()]);
    const { rerender } = render(<PlanningBoardGanttView {...values} homeKey={0} />);
    const viewport = screen.getByLabelText('ガントの日付と工程');
    const twoHours = (1120 - 168) / 2 / 12;
    fireEvent.click(screen.getByRole('button', { name: '2時間進む' }));
    fireEvent.click(screen.getByRole('button', { name: '2時間進む' }));
    expect(viewport.scrollLeft).toBeCloseTo(twoHours * 2);
    fireEvent.click(screen.getByRole('button', { name: '2時間戻る' }));
    expect(viewport.scrollLeft).toBeCloseTo(twoHours);
    rerender(<PlanningBoardGanttView {...values} homeKey={0} />);
    expect(viewport.scrollLeft).toBeCloseTo(twoHours);
    rerender(<PlanningBoardGanttView {...values} homeKey={1} />);
    expect(viewport.scrollLeft).toBe(0);
  });
  it('reorders machine lanes immediately on movement, and remembers the order on this kiosk', () => {
    localStorage.clear();
    const values = { ...forwardProps(chainItems()), preferenceScope: 'site:grinding' };
    const { unmount } = render(<PlanningBoardGanttView {...values} />);
    const lanes = () => [...document.querySelectorAll<HTMLElement>('[data-gantt-lane]')].map((lane) => lane.dataset.resourceCode);
    expect(lanes()).toEqual(['305', '306']);
    const target = document.querySelector('[data-resource-code="306"]')!;
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [target]) });
    const handle = screen.getByRole('button', { name: '資源CD 305の行を並べ替え' });
    const source = handle.closest<HTMLElement>('[data-gantt-lane-label]')!;
    expect(source.closest('[data-gantt-lane]')).toHaveAttribute('data-resource-code', '305');
    source.style.outline = '1px solid blue';
    source.style.outlineOffset = '-1px';
    source.style.backgroundColor = 'red';
    expect(handle).toHaveClass('touch-none');
    fireEvent.pointerDown(handle, { pointerId: 3, button: 0, clientX: 40, clientY: 60 });
    expect(document.querySelector('[data-planning-board-pane-ghost]')).toBeNull();
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 40, clientY: 69 });
    expect(document.querySelector('[data-planning-board-pane-ghost]')).toBeNull();
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 40, clientY: 140 });
    expect(source).toHaveAttribute('data-planning-board-drag-source', 'true');
    expect([source.style.outline, source.style.outlineOffset, source.style.backgroundColor]).toEqual(['3px solid rgb(251 191 36)', '-3px', 'red']);
    expect(source.closest('[data-gantt-lane]')).not.toHaveAttribute('data-planning-board-drag-source');
    expect((target as HTMLElement).style.outline).toBe('');
    expect(document.querySelector('[data-planning-board-pane-line]')).not.toHaveClass('hidden');
    expect(document.querySelector('[data-planning-board-pane-ghost]')).toHaveClass('border-2', 'border-amber-400');
    fireEvent.pointerUp(handle, { pointerId: 3, clientX: 40, clientY: 140 });
    expect(document.querySelector('[data-planning-board-pane-line]')).toBeNull();
    expect(source).not.toHaveAttribute('data-planning-board-drag-source');
    expect(source.style.outline).toBe('1px solid blue');
    expect(source.style.outlineOffset).toBe('-1px');
    expect(source.style.backgroundColor).toBe('red');
    expect(document.querySelector('[data-planning-board-pane-ghost]')).toBeNull();
    expect(lanes()).toEqual(['306', '305']);
    expect(JSON.parse(localStorage.getItem('kiosk.planning-board.resource-panes:site:grinding') ?? '[]')).toEqual(['306', '305']);
    expect(values.onToggleItem).not.toHaveBeenCalled();
    unmount();
    render(<PlanningBoardGanttView {...values} />);
    expect(lanes()).toEqual(['306', '305']);
    fireEvent.keyDown(screen.getByRole('button', { name: '資源CD 305の行を並べ替え' }), { key: 'ArrowUp', altKey: true });
    expect(lanes()).toEqual(['305', '306']);
    Reflect.deleteProperty(document, 'elementsFromPoint');
    localStorage.clear();
  });
  it('frames the machine name as soon as it is held, without moving', () => {
    vi.useFakeTimers();
    render(<PlanningBoardGanttView {...forwardProps(chainItems())} />);
    const handle = screen.getByRole('button', { name: '資源CD 305の行を並べ替え' });
    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 40, clientY: 60 });
    expect(document.querySelector('[data-planning-board-pane-ghost]')).toBeNull();
    act(() => { vi.advanceTimersByTime(450); });
    expect(handle.closest('[data-gantt-lane-label]')).toHaveAttribute('data-planning-board-drag-source', 'true');
    expect(document.querySelector('[data-planning-board-pane-ghost]')).not.toBeNull();
    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 40, clientY: 60 });
    expect(document.querySelector('[data-planning-board-pane-ghost]')).toBeNull();
    expect(handle.closest('[data-gantt-lane-label]')).not.toHaveAttribute('data-planning-board-drag-source');
  });
  it('keeps 研削 lanes above 切削 lanes even when the saved order puts a 切削 lane first', () => {
    localStorage.setItem('kiosk.planning-board.resource-panes:site:all', JSON.stringify(['306', '305']));
    const items = chainItems();
    const values = { ...forwardProps(items), preferenceScope: 'site:all',
      layout: buildPlanningBoardGanttLayout({ items, mode: 'forward', allocation: 'alternate', view: 'resource', seibanOrder: [], resources: ['305', '306'],
        dailyHoursByResource: {}, today: '2026-10-14', now: new Date('2026-10-14T09:00:00+09:00'), scale: 2,
        category: 'all', resourceCategories: { 305: 'grinding', 306: 'cutting' } }) };
    render(<PlanningBoardGanttView {...values} />);
    expect([...document.querySelectorAll<HTMLElement>('[data-gantt-lane]')].map((lane) => lane.dataset.resourceCode)).toEqual(['305', '306']);
    expect(screen.getAllByTestId('planning-gantt-category-header').map((header) => header.textContent)).toEqual(['研削', '切削']);
    localStorage.clear();
  });
  it('does not start a lane drag from the 8H/10H/24H buttons or a short press', () => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const values = { ...forwardProps(chainItems()), preferenceScope: 'site:grinding' };
    render(<PlanningBoardGanttView {...values} />);
    const lanes = () => [...document.querySelectorAll<HTMLElement>('[data-gantt-lane]')].map((lane) => lane.dataset.resourceCode);
    const target = document.querySelector('[data-resource-code="306"]')!;
    Object.defineProperty(document, 'elementsFromPoint', { configurable: true, value: vi.fn(() => [target]) });
    const handle = screen.getByRole('button', { name: '資源CD 305の行を並べ替え' });
    fireEvent.pointerDown(handle, { pointerId: 4, button: 0, clientX: 40, clientY: 60 });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.pointerUp(handle, { pointerId: 4, clientX: 40, clientY: 60 });
    const hours = within(screen.getByRole('group', { name: '305の1日の稼働時間' })).getByRole('button', { name: '10H' });
    fireEvent.pointerDown(hours, { pointerId: 5, button: 0, clientX: 40, clientY: 60 });
    act(() => vi.advanceTimersByTime(450));
    fireEvent.pointerUp(hours, { pointerId: 5, clientX: 40, clientY: 140 });
    fireEvent.click(hours);
    expect(lanes()).toEqual(['305', '306']);
    expect(values.onCapacityChange).toHaveBeenCalledWith('305', 10);
    expect(localStorage.getItem('kiosk.planning-board.resource-panes:site:grinding')).toBeNull();
    Reflect.deleteProperty(document, 'elementsFromPoint');
  });
  it('shows completed-only guidance and starts the viewport at today', () => {
    const values = forwardProps([item({ isCompleted: true })]);
    render(<PlanningBoardGanttView {...values} />);
    expect(screen.getByText('完了は「納期から」で表示')).toBeInTheDocument();
    expect(screen.queryByTestId('planning-gantt-bar-a')).not.toBeInTheDocument();
    expect(screen.getByLabelText('ガントの日付と工程').scrollLeft).toBe(0);
  });
  it('shades only before and after the working day, not breaks, and wraps the name to two lines and details to three', () => {
    render(<PlanningBoardGanttView {...forwardProps([item({ requiredMinutes: 480 })])} />);
    const shades = Array.from(screen.getByTestId('planning-forward-lane-305').querySelectorAll('.bg-slate-950\\/55'));
    const days = new Set(shades.map(shade => shade.parentElement));
    expect(days.size).toBeGreaterThan(0);
    expect(shades).toHaveLength(days.size * 2);
    expect(shades.every(shade => !shade.className.includes('z-['))).toBe(true);
    const bar = screen.getByTestId('planning-gantt-bar-a');
    expect(bar).toHaveClass('top-[3px]', 'h-[70px]');
    expect(screen.getByTestId('planning-forward-lane-305')).toHaveClass('border-slate-600');
    expect(screen.getByTestId('planning-board-gantt').querySelector('.top-9.border-l')).toBeNull();
    expect(bar.querySelector('b')).toHaveClass('line-clamp-2');
    expect(bar.querySelector('small')).toHaveClass('line-clamp-3');
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
    const dayWidth = (1120 - 168) / 2;
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
    expect(cards[0]).toHaveTextContent('26-1001 · 10分 · 1個');
    expect(cards[7]).toHaveTextContent('26-1001 · 10分 · 1個');
    expect(cards[2]).toHaveClass('outline-amber-400', 'border-rose-400');
    expect(cards[0]).not.toHaveClass('outline-amber-400');
    expect(cards[2]).toHaveTextContent('P5');
    expect(cards[0]).not.toHaveTextContent('4.');
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
  it.each(['touch', 'pen'])('shows the chain on a %s tap without opening the popover or selecting', (pointerType) => {
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
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('planning-gantt-chain-strip')).toBeInTheDocument();
    expect(values.onToggleItem).not.toHaveBeenCalled();
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
    expect(screen.queryByRole('region', { name: /の次にやる順/ })).not.toBeInTheDocument();
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
