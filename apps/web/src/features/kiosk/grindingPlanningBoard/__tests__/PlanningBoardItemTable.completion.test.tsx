import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanningBoardItemTable } from '../PlanningBoardItemTable';
import { PlanningBoardPiecesContext } from '../PlanningBoardPiecePopover';

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
  lslhSurface: false, requiredMinutesKnown: true,
  isCompleted: false,
  progress: { completed: 0, total: 1, quantityKnown: true },
  ...partial
});

describe('PlanningBoardItemTable completion', () => {
  const items = [item('row'), item('done', { isCompleted: true, completionSource: 'manual' })];
  const props = { items, allocation: 'alternate' as const, selectedItemIds: new Set<string>(),
    onToggleItem: vi.fn(), onResourceClick: vi.fn(), tableLabel: '工程' };

  it('shows parent completion and keeps completed items enabled for undo', () => {
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
    expect(onSpecialDueClick).not.toHaveBeenCalled();
    expect(props.onToggleItem).not.toHaveBeenCalled();
    expect(screen.getByRole('table').querySelectorAll('col')).toHaveLength(5);
  });

  it.each([undefined, 'cut'])('keeps later piece completion available without structural controls (source=%s)', (sourcePieceId) => {
    const later = item('piece:later', { kind: 'piece', pieceId: 'later', sourcePieceId, isLaterProcess: true, parentItemId: 'parent', pieceSetVersion: 1,
      quantity: 2, plannedQuantity: 2, parentPlannedQuantity: 5 });
    const onCompleteToggle = vi.fn();
    const actions = { enabled: true, createEnabled: true, isCutting: () => true, selectedItemsByParent: new Map(),
      subscribeBlocking: () => () => {}, getBlocking: () => ({ blocked: false, message: '保存中…', isError: false }), onSplit: vi.fn(), onMerge: vi.fn() };
    render(<PlanningBoardPiecesContext.Provider value={actions}><PlanningBoardItemTable {...props} items={[later]} onCompleteToggle={onCompleteToggle} /></PlanningBoardPiecesContext.Provider>);
    expect(screen.getByText('2／5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /の数量/ })).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: '完了にする' }); expect(button).toBeEnabled(); fireEvent.click(button);
    expect(onCompleteToggle).toHaveBeenCalledWith(later, 'complete');
  });

  it.each(['td', 'tr'])('blocks special-due clicks falling through locked controls to %s without replacing the row', (target) => {
    const onSpecialDueClick = vi.fn();
    const table = <PlanningBoardItemTable {...props} onCompleteToggle={vi.fn()} specialDueMode="today" onSpecialDueClick={onSpecialDueClick} />;
    const page = render(<div data-planning-board-pieces-writing="false">{table}</div>);
    const row = screen.getByTestId('planning-board-item-row');
    const completionCell = within(row).getByRole('button', { name: '完了にする' }).closest('td')!;
    fireEvent.click(target === 'td' ? completionCell : row);
    expect(onSpecialDueClick).toHaveBeenCalledTimes(1); onSpecialDueClick.mockClear();
    page.rerender(<div data-planning-board-pieces-writing="true">{table}</div>);
    expect(screen.getByTestId('planning-board-item-row')).toBe(row);
    fireEvent.click(target === 'td' ? completionCell : row);
    expect(onSpecialDueClick).not.toHaveBeenCalled();
    page.rerender(<div data-planning-board-pieces-writing="false">{table}</div>);
    fireEvent.click(target === 'td' ? completionCell : row);
    expect(onSpecialDueClick).toHaveBeenCalledTimes(1);
  });

  it('keeps completion and warning display scoped to each item ID', () => {
    const siblings = [item('piece:a', { kind: 'piece', sourceRowId: 'parent', quantityWarning: 'INVALID_PLANNED_QUANTITY' }),
      item('piece:b', { kind: 'piece', sourceRowId: 'parent' })];
    const onCompleteToggle = vi.fn();
    render(<PlanningBoardItemTable {...props} items={siblings} onCompleteToggle={onCompleteToggle} completionPendingItemIds={new Set(['piece:a'])} />);
    const a = screen.getByTestId('planning-board-item-piece:a');
    expect(a).toHaveClass('!outline-red-500');
    expect(within(a).getByRole('button', { name: '完了にする' })).toBeDisabled();
    fireEvent.click(within(screen.getByTestId('planning-board-item-piece:b')).getByRole('button', { name: '完了にする' }));
    expect(onCompleteToggle).toHaveBeenCalledWith(siblings[1], 'complete');
  });

  it('limits pending quantity controls to their own parent instead of every row', () => {
    const rows = [item('parent'), item('other'), item('piece:b', { kind: 'piece', parentItemId: 'parent', pieceId: 'b', parentPlannedQuantity: 5 })];
    const actions = { enabled: true, createEnabled: true, isCutting: () => true, selectedItemsByParent: new Map(),
      subscribeBlocking: () => () => {}, getBlocking: () => ({ blocked: false, message: '保存中…', isError: false }),
      completionPendingParentIds: new Set(['parent']), onSplit: vi.fn(), onMerge: vi.fn() };
    render(<PlanningBoardPiecesContext.Provider value={actions}><PlanningBoardItemTable {...props} items={rows}
      completionPendingItemIds={new Set(['parent', 'piece:a'])} /></PlanningBoardPiecesContext.Provider>);
    expect(within(screen.getByTestId('planning-board-item-parent')).getByRole('button', { name: /の数量/ })).toBeDisabled();
    expect(within(screen.getByTestId('planning-board-item-piece:b')).getByRole('button', { name: /の数量/ })).toBeDisabled();
    expect(within(screen.getByTestId('planning-board-item-other')).getByRole('button', { name: /の数量/ })).toBeEnabled();
  });

  it('lets a plain quantity click reach the special-due row action', () => {
    const onSpecialDueClick = vi.fn();
    render(<PlanningBoardItemTable {...props} showRank specialDueMode="today" onSpecialDueClick={onSpecialDueClick} />);
    fireEvent.click(within(screen.getByTestId('planning-board-item-row')).getByText('2個 · 120分'));
    expect(onSpecialDueClick).toHaveBeenCalledExactlyOnceWith(items[0]);
    expect(screen.queryByRole('button', { name: /の数量/ })).not.toBeInTheDocument();
  });

  it('preserves special-due quantity clicks with the creation gate enabled and zero pieces', () => {
    const onSpecialDueClick = vi.fn();
    const actions = { enabled: true, createEnabled: true, isCutting: () => true,
      subscribeBlocking: () => () => {}, getBlocking: () => ({ blocked: false, message: '保存中…', isError: false }),
      selectedItemsByParent: new Map(), onSplit: vi.fn(), onMerge: vi.fn() };
    render(<PlanningBoardPiecesContext.Provider value={actions}><PlanningBoardItemTable {...props}
      specialDueMode="today" onSpecialDueClick={onSpecialDueClick} /></PlanningBoardPiecesContext.Provider>);
    expect(screen.queryByRole('button', { name: /の数量/ })).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('planning-board-item-row')).getByText('2個'));
    expect(onSpecialDueClick).toHaveBeenCalledExactlyOnceWith(items[0]);
  });
  it('renders imported completion as a disabled sky badge', () => {
    const onCompleteToggle = vi.fn();
    render(<PlanningBoardItemTable {...props} items={[item('imported', { isCompleted: true, completionSource: 'import' })]}
      onCompleteToggle={onCompleteToggle} />);
    const badge = screen.getByRole('button', { name: '取込で完了' });
    expect(badge).toHaveTextContent('取込');
    expect(badge).toHaveClass('h-7', 'w-7', 'rounded-full', 'border-sky-400', 'bg-cyan-700/35', 'text-sky-50');
    expect(badge).toBeDisabled();
    fireEvent.click(badge);
    expect(onCompleteToggle).not.toHaveBeenCalled();
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
    rerender(<PlanningBoardItemTable {...props} onCompleteToggle={onCompleteToggle} completionPendingItemIds={new Set(['done'])} />);
    expect(screen.getByRole('button', { name: '未完了に戻す' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '完了にする' })).toBeEnabled();
    rerender(<PlanningBoardItemTable {...props} onCompleteToggle={onCompleteToggle} disabled />);
    expect(screen.getByRole('button', { name: '未完了に戻す' })).toBeDisabled();
  });
});
