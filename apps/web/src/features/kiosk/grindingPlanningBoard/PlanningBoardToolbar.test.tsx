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
    fireEvent.click(screen.getByRole('button', { name: '⚠ 遅れ 2' }));
    expect(values.onNextLate).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)
      .filter((label) => ['固定', '並べ替え', '⇅ 納期順に並べる', '↶ 戻す'].includes(label!)))
      .toEqual(['固定', '並べ替え', '⇅ 納期順に並べる', '↶ 戻す']);
    fireEvent.click(screen.getByRole('button', { name: '並べ替え' }));
    expect(values.onProposeOrder).toHaveBeenCalledOnce();
    expect(values.onSortDue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '⇅ 納期順に並べる' }));
    fireEvent.click(screen.getByRole('button', { name: '↶ 戻す' }));
    expect(values.onSortDue).toHaveBeenCalledOnce();
    expect(values.onUndoOrder).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} lateCount={0} />);
    expect(screen.getByRole('button', { name: '✓ 遅れなし' })).toBeInTheDocument();
  });
  it.each([{ allocation: 'original' as const }, { orderDisabled: true }])('disables writes: %j', (changes) => {
    render(<PlanningBoardToolbar {...props()} {...changes} />);
    expect(screen.getByRole('button', { name: '並べ替え' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '⇅ 納期順に並べる' })).toBeDisabled();
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
    expect(screen.getByRole('button', { name: '⇅ 納期順に並べる' })).toBeEnabled();
    rerender(<PlanningBoardToolbar {...values} ganttMode="backward" />);
    expect(screen.getByRole('button', { name: '⇅ 納期順に並べる' })).toBeDisabled();
  });
  it('shows comparison and blocks pending preview actions', () => {
    const values = props();
    const onApplyOrder = vi.fn(); const onCancelOrder = vi.fn();
    const preview = { before: { lateCount: 3, waitMinutes: 125 }, after: { lateCount: 1, waitMinutes: 30 } };
    const { rerender } = render(<PlanningBoardToolbar {...values} orderPreview={preview} onApplyOrder={onApplyOrder} onCancelOrder={onCancelOrder} />);
    expect(screen.getByRole('status')).toHaveTextContent('遅れ 3 → 1 件');
    expect(screen.getByRole('status')).toHaveTextContent('待ち 2時間05分 → 0時間30分');
    expect(screen.queryByRole('button', { name: '並べ替え' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '⇅ 納期順に並べる' })).not.toBeInTheDocument();
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
