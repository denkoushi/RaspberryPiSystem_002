import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningBoardToolbar } from './PlanningBoardToolbar';

import type { PlanningBoardToolbarProps } from './PlanningBoardToolbar';

const props = (): PlanningBoardToolbarProps => ({
  ganttEnabled: true, onToggleGantt: vi.fn(), ganttMode: 'forward', onGanttModeChange: vi.fn(), lateCount: 2, onNextLate: vi.fn(),
  onProposeOrder: vi.fn(), onSortDue: vi.fn(), onUndoOrder: vi.fn(), canUndoOrder: true,
  categories: { grinding: true, cutting: false }, view: 'resource', status: 'incomplete', allocation: 'alternate', selectedCount: 0, registeredCount: 3,
  onOpenDrawer: vi.fn(), onCategoriesChange: vi.fn(), onViewChange: vi.fn(), onStatusChange: vi.fn(), onAllocationChange: vi.fn(), onOpenDueEditor: vi.fn()
});
describe('PlanningBoardToolbar forward controls', () => {
  it.each([false, true])('keeps the icon-only scan control outside the Gantt group with gantt=%s', (ganttEnabled) => {
    render(<PlanningBoardToolbar {...props()} ganttEnabled={ganttEnabled} onOrderScan={() => null} />);
    const scan = screen.getByRole('button', { name: '移動票で製番を探す' });
    expect(scan).toHaveClass('h-[46px]', 'w-[46px]');
    expect(scan).toHaveTextContent('');
    expect(scan.querySelector('svg')).toBeInTheDocument();
    const gantt = screen.getByRole('button', { name: 'ガント', exact: true });
    expect(gantt.parentElement).not.toContainElement(scan);
    if (ganttEnabled) expect(scan.previousElementSibling?.lastElementChild).toBe(screen.getByRole('button', { name: '製番ごとに色分け' }));
  });
  it.each([false, true])('shows the large-screen toggle at the far right with gantt=%s', (ganttEnabled) => {
    const onToggleLargeScreen = vi.fn();
    const values = { ...props(), ganttEnabled, onToggleLargeScreen };
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    const toggle = screen.getByRole('button', { name: '50インチ表示' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveClass('ml-auto', 'h-[46px]', 'w-[46px]');
    expect(toggle.parentElement?.lastElementChild).toBe(toggle);
    fireEvent.click(toggle);
    expect(onToggleLargeScreen).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} largeScreen />);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveClass('bg-sky-400');
  });
  it('opens other scales, chooses one, and reflects the hidden selection', () => {
    const onGanttScaleChange = vi.fn();
    const values = { ...props(), ganttScale: 1 as const, onGanttScaleChange };
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    const trigger = screen.getByRole('button', { name: '他の幅' });
    expect(trigger).toHaveTextContent('⋯');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: '1日' })).toBeVisible();
    expect(screen.getByRole('button', { name: '2日' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '1週' })).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('group', { name: '他の幅' })).toBeVisible();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '1週' }));
    expect(onGanttScaleChange).toHaveBeenCalledWith(7);
    expect(screen.queryByRole('group', { name: '他の幅' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    rerender(<PlanningBoardToolbar {...values} ganttScale={7} />);
    expect(trigger).toHaveTextContent('1週 ▾');
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(trigger).toHaveClass('bg-sky-400');
    fireEvent.click(trigger);
    fireEvent.pointerDown(screen.getByRole('button', { name: '4日' }));
    expect(screen.getByRole('group', { name: '他の幅' })).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
  it('shows the color toggle state and invokes its callback', () => {
    const onToggleColorBySeiban = vi.fn();
    const values = { ...props(), onToggleColorBySeiban };
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    const toggle = screen.getByRole('button', { name: '製番ごとに色分け' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onToggleColorBySeiban).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} colorBySeiban />);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveClass('bg-sky-400');
  });
  it('toggles categories independently and keeps at least one pressed', () => {
    const values = props();
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    fireEvent.click(screen.getByRole('button', { name: '研削' }));
    expect(values.onCategoriesChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    expect(values.onCategoriesChange).toHaveBeenLastCalledWith({ grinding: true, cutting: true });
    rerender(<PlanningBoardToolbar {...values} categories={{ grinding: true, cutting: true }} />);
    expect(screen.getByRole('button', { name: '研削' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '切削' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '研削' }));
    expect(values.onCategoriesChange).toHaveBeenLastCalledWith({ grinding: false, cutting: true });
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    expect(values.onCategoriesChange).toHaveBeenLastCalledWith({ grinding: true, cutting: false });
    vi.mocked(values.onCategoriesChange).mockClear();
    rerender(<PlanningBoardToolbar {...values} categories={{ grinding: false, cutting: true }} />);
    fireEvent.click(screen.getByRole('button', { name: '切削' }));
    expect(values.onCategoriesChange).not.toHaveBeenCalled();
    rerender(<PlanningBoardToolbar {...values} scopeDisabled />);
    expect(screen.getByRole('button', { name: '研削' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '切削' })).toBeDisabled();
  });
  it('toggles mode and navigates late work', () => {
    const values = props();
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    expect(screen.getByRole('button', { name: '今日から' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '納期から' }));
    expect(values.onGanttModeChange).toHaveBeenCalledWith('backward');
    fireEvent.click(screen.getByRole('button', { name: '遅れ 2' }));
    expect(values.onNextLate).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)
      .filter((label) => ['固定', '並べ替え', '納期順に並べる', '↶ 戻す'].includes(label!)))
      .toEqual(['固定', '並べ替え', '納期順に並べる', '↶ 戻す']);
    fireEvent.click(screen.getByRole('button', { name: '並べ替え' }));
    expect(values.onProposeOrder).toHaveBeenCalledOnce();
    expect(values.onSortDue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '納期順に並べる' }));
    fireEvent.click(screen.getByRole('button', { name: '↶ 戻す' }));
    expect(values.onSortDue).toHaveBeenCalledOnce();
    expect(values.onUndoOrder).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} lateCount={0} />);
    expect(screen.getByRole('button', { name: '遅れなし' })).toBeInTheDocument();
  });
  it.each([{ allocation: 'original' as const }, { orderDisabled: true }])('disables writes: %j', (changes) => {
    render(<PlanningBoardToolbar {...props()} {...changes} />);
    expect(screen.getByRole('button', { name: '並べ替え' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '納期順に並べる' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled();
  });
  it.each([{ ganttEnabled: false }, { ganttMode: 'backward' as const }, { view: 'seiban' as const }])('hides pin and proposal outside forward resource view: %j', (changes) => {
    render(<PlanningBoardToolbar {...props()} {...changes} />);
    expect(screen.queryByRole('button', { name: '固定' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '並べ替え' })).not.toBeInTheDocument();
  });
  it('keeps the original due-sort availability outside resource view', () => {
    const values = props();
    const { rerender } = render(<PlanningBoardToolbar {...values} view="seiban" />);
    expect(screen.getByRole('button', { name: '納期順に並べる' })).toBeEnabled();
    rerender(<PlanningBoardToolbar {...values} ganttMode="backward" />);
    expect(screen.getByRole('button', { name: '納期順に並べる' })).toBeDisabled();
  });
  it('shows comparison and blocks pending preview actions', () => {
    const values = props();
    const onApplyOrder = vi.fn(); const onCancelOrder = vi.fn();
    const preview = { before: { lateCount: 3, waitMinutes: 125 }, after: { lateCount: 1, waitMinutes: 30 } };
    const { rerender } = render(<PlanningBoardToolbar {...values} orderPreview={preview} onApplyOrder={onApplyOrder} onCancelOrder={onCancelOrder} />);
    expect(screen.getByRole('status')).toHaveTextContent('遅れ 3 → 1 件');
    expect(screen.getByRole('status')).toHaveTextContent('待ち 2時間05分 → 0時間30分');
    expect(screen.queryByRole('button', { name: '並べ替え' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '納期順に並べる' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '固定' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '適用' }));
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(onApplyOrder).toHaveBeenCalledOnce(); expect(onCancelOrder).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} orderPreview={preview} previewPending />);
    expect(screen.getByRole('button', { name: '適用' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'やめる' })).toBeDisabled();
  });
  it('disables undo without history and keeps feedback shrinkable', () => {
    render(<PlanningBoardToolbar {...props()} canUndoOrder={false} feedback={<span>保存中</span>} />);
    expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled();
    expect(screen.getByText('保存中').parentElement).toHaveClass('min-w-0', 'flex-1');
  });
});
