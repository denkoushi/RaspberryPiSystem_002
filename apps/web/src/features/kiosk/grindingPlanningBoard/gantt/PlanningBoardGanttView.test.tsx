import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPlanningBoardGanttLayout } from './planningBoardGanttLayout';
import { PlanningBoardGanttView } from './PlanningBoardGanttView';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
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
  afterEach(() => vi.unstubAllGlobals());
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
