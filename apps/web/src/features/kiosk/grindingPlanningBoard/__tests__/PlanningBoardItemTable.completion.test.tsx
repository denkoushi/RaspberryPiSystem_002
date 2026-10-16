import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningBoardItemTable } from '../PlanningBoardItemTable';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const item = (itemId: string, partial: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  itemId,
  kind: 'row',
  itemRevision: `${itemId}-0`,
  version: 0,
  sourceRowId: itemId,
  fseiban: 'CA1S1M11',
  fhincd: `MD-${itemId}`,
  fhinmei: `部品${itemId}`,
  machineName: 'MX-520',
  productNo: '0003594297',
  processOrder: '10',
  originalResourceCd: '305',
  effectiveResourceCd: '305',
  originalDueDate: '2026-10-08',
  effectiveDueDate: '2026-10-08',
  originalRank: null,
  alternateRank: null,
  plannedQuantity: 2,
  requiredMinutes: 120,
  requiredMinutesKnown: true,
  isCompleted: false,
  progress: { completed: 0, total: 1, quantityKnown: true },
  ...partial
});

describe('PlanningBoardItemTable completion', () => {
  const items = [item('row'), item('done', { isCompleted: true }), item('split', { kind: 'split' })];
  const props = { items, allocation: 'alternate' as const, selectedItemIds: new Set<string>(),
    onToggleItem: vi.fn(), onResourceClick: vi.fn(), tableLabel: '工程' };

  it('shows completion only for rows and keeps completed items enabled for undo', () => {
    const onCompleteToggle = vi.fn();
    const onSpecialDueClick = vi.fn();
    render(<PlanningBoardItemTable {...props} onCompleteToggle={onCompleteToggle} specialDueMode="today" onSpecialDueClick={onSpecialDueClick} />);
    expect(screen.getByRole('columnheader', { name: '完了' })).toBeInTheDocument();
    const incomplete = screen.getByRole('button', { name: '完了にする' });
    expect(incomplete).toHaveClass('h-7', 'w-7', 'rounded-full', 'border-emerald-400');
    fireEvent.click(incomplete);
    expect(onCompleteToggle).toHaveBeenLastCalledWith(items[0], 'complete');
    const completed = screen.getByRole('button', { name: '未完了に戻す' });
    expect(completed).toBeEnabled();
    expect(completed).toHaveClass('border-slate-400');
    fireEvent.click(completed);
    expect(onCompleteToggle).toHaveBeenLastCalledWith(items[1], 'incomplete');
    expect(within(screen.getByTestId('planning-board-item-split')).queryByText('✓')).not.toBeInTheDocument();
    expect(onSpecialDueClick).not.toHaveBeenCalled();
    expect(props.onToggleItem).not.toHaveBeenCalled();
    expect(screen.getByRole('table').querySelectorAll('col')).toHaveLength(5);
  });

  it('omits the column without a handler and updates memoized pending controls', () => {
    const { rerender } = render(<PlanningBoardItemTable {...props} />);
    expect(screen.queryByRole('columnheader', { name: '完了' })).not.toBeInTheDocument();
    expect(screen.queryByText('✓')).not.toBeInTheDocument();
    expect(screen.getByRole('table').querySelectorAll('col')).toHaveLength(4);
    expect(within(screen.getByTestId('planning-board-item-row')).getAllByRole('cell')).toHaveLength(4);
    const onCompleteToggle = vi.fn();
    rerender(<PlanningBoardItemTable {...props} onCompleteToggle={onCompleteToggle} />);
    expect(screen.getByRole('button', { name: '未完了に戻す' })).toBeEnabled();
    rerender(<PlanningBoardItemTable {...props} onCompleteToggle={onCompleteToggle} completePending />);
    expect(screen.getByRole('button', { name: '未完了に戻す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '完了にする' })).toBeDisabled();
    rerender(<PlanningBoardItemTable {...props} onCompleteToggle={onCompleteToggle} disabled />);
    expect(screen.getByRole('button', { name: '未完了に戻す' })).toBeDisabled();
  });
});
