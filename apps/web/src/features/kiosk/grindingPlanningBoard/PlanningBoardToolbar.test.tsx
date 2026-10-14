import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningBoardToolbar } from './PlanningBoardToolbar';

import type { PlanningBoardToolbarProps } from './PlanningBoardToolbar';

const props = (): PlanningBoardToolbarProps => ({
  ganttEnabled: true, onToggleGantt: vi.fn(), ganttMode: 'forward', onGanttModeChange: vi.fn(), lateCount: 2, onNextLate: vi.fn(),
  onSortDue: vi.fn(), onUndoOrder: vi.fn(), canUndoOrder: true,
  category: 'grinding', view: 'resource', status: 'incomplete', allocation: 'alternate', selectedCount: 0, registeredCount: 3,
  onOpenDrawer: vi.fn(), onCategoryChange: vi.fn(), onViewChange: vi.fn(), onStatusChange: vi.fn(), onAllocationChange: vi.fn(), onOpenDueEditor: vi.fn()
});
describe('PlanningBoardToolbar forward controls', () => {
  it('toggles mode and navigates late work', () => {
    const values = props();
    const { rerender } = render(<PlanningBoardToolbar {...values} />);
    expect(screen.getByRole('button', { name: '今日から' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '納期から' }));
    expect(values.onGanttModeChange).toHaveBeenCalledWith('backward');
    fireEvent.click(screen.getByRole('button', { name: '⚠ 遅れ見込み 2' }));
    expect(values.onNextLate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '⇅ 納期順に並べる' }));
    fireEvent.click(screen.getByRole('button', { name: '↶ 戻す' }));
    expect(values.onSortDue).toHaveBeenCalledOnce();
    expect(values.onUndoOrder).toHaveBeenCalledOnce();
    rerender(<PlanningBoardToolbar {...values} lateCount={0} />);
    expect(screen.getByRole('button', { name: '✓ 遅れなし' })).toBeInTheDocument();
  });
  it.each([{ ganttMode: 'backward' as const }, { allocation: 'original' as const }, { orderDisabled: true }])('disables writes: %j', (changes) => {
    render(<PlanningBoardToolbar {...props()} {...changes} />);
    expect(screen.getByRole('button', { name: '⇅ 納期順に並べる' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled();
  });
  it('disables undo without history and keeps feedback shrinkable', () => {
    render(<PlanningBoardToolbar {...props()} canUndoOrder={false} feedback={<span>保存中</span>} />);
    expect(screen.getByRole('button', { name: '↶ 戻す' })).toBeDisabled();
    expect(screen.getByText('保存中').parentElement).toHaveClass('min-w-0', 'flex-1');
  });
});
