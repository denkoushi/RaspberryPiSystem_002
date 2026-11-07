import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PieceOperationBlockedError, PlanningBoardPiecePopover, PlanningBoardPiecesContext, usePlanningBoardPieceActions, usePlanningBoardPieceFocus } from './PlanningBoardPiecePopover';

import type { GrindingPlanningBoardItem } from '@raspi-system/shared-types';

const row = { itemId: 'row:a', kind: 'row', fhinmei: '部品A', originalResourceCd: 'CUT-1', plannedQuantity: 5, isCompleted: false } as GrindingPlanningBoardItem;
const piece = (id: string, quantity: number, extra: Partial<GrindingPlanningBoardItem> = {}): GrindingPlanningBoardItem => ({
  ...row, itemId: `piece:${id}`, kind: 'piece', pieceId: id, parentItemId: row.itemId,
  quantity, plannedQuantity: quantity, parentPlannedQuantity: 5, ...extra
});
function setup(item = row, items = [item], selectedItemIds = new Set(items.map((value) => value.itemId)), createEnabled = true) {
  const onSplit = vi.fn().mockResolvedValue(undefined);
  const onMerge = vi.fn().mockResolvedValue(undefined);
  const selectedItems = items.filter((candidate) => selectedItemIds.has(candidate.itemId));
  const { result } = renderHook(() => usePlanningBoardPieceActions({ createEnabled, enabled: true,
    resourceCategories: { 'CUT-1': 'cutting' }, selectedItems, changePieces: vi.fn() }));
  const value = { ...result.current, onSplit, onMerge };
  const view = render(<PlanningBoardPiecesContext.Provider value={value}><PlanningBoardPiecePopover item={item} selected={selectedItemIds.has(item.itemId)} /></PlanningBoardPiecesContext.Provider>);
  return { ...view, value, onSplit, onMerge };
}
describe('PlanningBoardPiecePopover', () => {
  it.each([false, true])('keeps the value and parent index stable across unrelated renders with 1000 rows (pieces=%s)', (withPieces) => {
    const readParent = vi.fn(() => withPieces ? 'parent' : undefined);
    const items = Array.from({ length: 1000 }, (_, index) => ({ ...row, itemId: `item:${index}`,
      kind: withPieces ? 'piece' : 'row',
      get parentItemId() { return readParent(); }
    } as GrindingPlanningBoardItem));
    const options = { createEnabled: true, enabled: true, resourceCategories: undefined,
      selectedItems: items, changePieces: vi.fn() };
    const { result, rerender } = renderHook(() => usePlanningBoardPieceActions(options));
    const original = result.current;
    expect(original.selectedItemsByParent.size).toBe(withPieces ? 1 : 0);
    expect(readParent.mock.calls.length).toBeLessThanOrEqual(2001);
    readParent.mockClear();
    rerender();
    expect(result.current).toBe(original);
    expect(readParent).not.toHaveBeenCalled();
  });
  it('keeps prior selection maps unchanged and uses the latest callback', async () => {
    const items = [piece('a', 2), piece('b', 3)];
    const initial = { createEnabled: true, enabled: true, resourceCategories: undefined,
      selectedItems: [] as GrindingPlanningBoardItem[], changePieces: vi.fn() };
    const { result, rerender } = renderHook((options) => usePlanningBoardPieceActions(options), { initialProps: initial });
    const original = result.current;
    const changePieces = vi.fn().mockResolvedValue(undefined);
    rerender({ ...initial, selectedItems: items, changePieces });
    expect(result.current).not.toBe(original);
    expect(original.selectedItemsByParent.size).toBe(0);
    expect(result.current.selectedItemsByParent.get(row.itemId)).toEqual(items);
    await original.onSplit(row, [2, 3]);
    expect(changePieces).toHaveBeenCalledWith([row], [2, 3]);
    expect(initial.changePieces).not.toHaveBeenCalled();
  });
  it('keeps context identity for row selections and pending callback changes', async () => {
    const initial = { createEnabled: true, enabled: true, resourceCategories: undefined,
      selectedItems: [] as GrindingPlanningBoardItem[], changePieces: vi.fn() };
    const { result, rerender } = renderHook((options) => usePlanningBoardPieceActions(options), { initialProps: initial });
    const original = result.current;
    const changePieces = vi.fn().mockResolvedValue(undefined);
    rerender({ ...initial, selectedItems: [row], changePieces });
    expect(result.current).toBe(original);
    rerender({ ...initial, selectedItems: [], changePieces });
    expect(result.current).toBe(original);
    await original.onSplit(row, [2, 3]);
    expect(changePieces).toHaveBeenCalledWith([row], [2, 3]);
  });
  it.each([undefined, {}, { 'CUT-1': 'grinding' as const }])('hides split until the resource category is cutting (%j)', (resourceCategories) => {
    const { result } = renderHook(() => usePlanningBoardPieceActions({ createEnabled: true, enabled: true,
      resourceCategories, selectedItems: [], changePieces: vi.fn() }));
    render(<PlanningBoardPiecesContext.Provider value={result.current}><PlanningBoardPiecePopover item={row} /></PlanningBoardPiecesContext.Provider>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('5個')).toBeInTheDocument();
  });
  it.each([undefined, 1, null])('preserves quantity clicks when splitting is unavailable (quantity=%s)', (quantity) => {
    const onClick = vi.fn();
    const item = quantity === undefined ? row : { ...row, plannedQuantity: quantity };
    const { result } = renderHook(() => usePlanningBoardPieceActions({ createEnabled: quantity !== undefined,
      enabled: true, resourceCategories: undefined, selectedItems: [], changePieces: vi.fn() }));
    render(<PlanningBoardPiecesContext.Provider value={quantity === undefined ? null : result.current}>
      <div onClick={onClick}><PlanningBoardPiecePopover item={item} /></div>
    </PlanningBoardPiecesContext.Provider>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(quantity === undefined ? '5個' : quantity == null ? '—' : '1個'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
  it('checks a 1000-piece merge selection once before rows render', () => {
    const items = Array.from({ length: 1000 }, (_, index) => piece(String(index), 1));
    const { result } = renderHook(() => usePlanningBoardPieceActions({ createEnabled: false, enabled: true,
      resourceCategories: undefined, selectedItems: items, changePieces: vi.fn() }));
    const getParent = vi.spyOn(result.current.selectedItemsByParent, 'get');
    render(<PlanningBoardPiecesContext.Provider value={result.current}>
      {items.map((item) => <PlanningBoardPiecePopover key={item.itemId} item={item} selected />)}
    </PlanningBoardPiecesContext.Provider>);
    expect(getParent).toHaveBeenCalledTimes(1000);
    expect(screen.getAllByRole('button').every((button) => !button.hasAttribute('disabled'))).toBe(true);
  });
  it.each(['table', 'gantt'] as const)('shows linked later quantity without split/merge controls (%s)', (variant) => {
    const items = [piece('a', 2, { sourcePieceId: 'cut-a' }), piece('b', 3, { sourcePieceId: 'cut-b' })];
    const { result } = renderHook(() => usePlanningBoardPieceActions({ createEnabled: true, enabled: true,
      resourceCategories: { 'CUT-1': 'cutting' }, selectedItems: items, changePieces: vi.fn() }));
    expect(result.current.selectedItemsByParent.size).toBe(0);
    render(<PlanningBoardPiecesContext.Provider value={result.current}><PlanningBoardPiecePopover item={items[0]} selected variant={variant} /></PlanningBoardPiecesContext.Provider>);
    expect(screen.getByText('2／5')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('▾')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('2／5'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('分ける')).not.toBeInTheDocument();
    expect(screen.queryByText('まとめる')).not.toBeInTheDocument();
  });
  it('splits five into 2+3, bounds the counter and restores focus on Escape', async () => {
    const { onSplit } = setup();
    const trigger = screen.getByRole('button', { name: '部品Aの数量 5個' });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByRole('button', { name: '分け数を減らす' })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole('button', { name: '分け数を増やす' })).toBeEnabled());
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: '分け数を増やす' }));
    expect(screen.getByRole('button', { name: '分け数を増やす' })).toBeDisabled();
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: '分け数を減らす' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger); await waitFor(() => expect(screen.getByRole('button', { name: '分ける' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: '分ける' }));
    await waitFor(() => expect(onSplit).toHaveBeenCalledExactlyOnceWith(row, [2, 3]));
  });
  it('bounds every piece at one, balances the last and resets distribution when count changes', async () => {
    setup({ ...row, plannedQuantity: 6 });
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '分け数を増やす' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '分け数を増やす' }));
    expect(screen.getByLabelText('3片目の数量')).toHaveTextContent('2');
    const minus = screen.getByRole('button', { name: '1片目の数量を減らす' });
    fireEvent.click(minus); fireEvent.click(minus);
    expect(minus).toBeDisabled();
    expect(screen.getByLabelText('1片目の数量')).toHaveTextContent('1');
    expect(screen.getByLabelText('3片目の数量')).toHaveTextContent('3');
    const plus = screen.getByRole('button', { name: '2片目の数量を増やす' });
    fireEvent.click(plus); fireEvent.click(plus); fireEvent.click(plus);
    expect(plus).toBeDisabled();
    expect(screen.getByRole('button', { name: '1片目の数量を増やす' })).toBeDisabled();
    expect(screen.getByLabelText('3片目の数量')).toHaveTextContent('1');
    expect(screen.getByLabelText('3片目の数量を増やす')).toHaveStyle({ visibility: 'hidden' });
    expect(screen.getByLabelText('3片目の数量を減らす')).toHaveStyle({ visibility: 'hidden' });
    fireEvent.click(screen.getByRole('button', { name: '分け数を減らす' }));
    expect(screen.getByLabelText('1片目の数量')).toHaveTextContent('3');
    expect(screen.getByLabelText('2片目の数量')).toHaveTextContent('3');
  });
  it.each([[5, 3], [3, 2]])('redistributes an open dialog when total changes from %s to %s', async (before, after) => {
    const h = setup({ ...row, plannedQuantity: before });
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '分ける' })).toBeEnabled());
    if (before === 5) fireEvent.click(screen.getByRole('button', { name: '分け数を増やす' }));
    const updated = { ...row, plannedQuantity: after };
    h.rerender(<PlanningBoardPiecesContext.Provider value={h.value}><PlanningBoardPiecePopover item={updated} /></PlanningBoardPiecesContext.Provider>);
    expect(screen.getByLabelText('分け数')).toHaveTextContent('2');
    fireEvent.click(screen.getByRole('button', { name: '分ける' }));
    await waitFor(() => expect(h.onSplit).toHaveBeenCalledExactlyOnceWith(updated, after === 3 ? [1, 2] : [1, 1]));
  });
  it('preserves an edited distribution when only the revision changes', async () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '分け数を増やす' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '分け数を増やす' }));
    fireEvent.click(screen.getByLabelText('1片目の数量を増やす'));
    const updated = { ...row, itemRevision: 'new' };
    h.rerender(<PlanningBoardPiecesContext.Provider value={h.value}><PlanningBoardPiecePopover item={updated} /></PlanningBoardPiecesContext.Provider>);
    expect(screen.getByLabelText('分け数')).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('button', { name: '分ける' }));
    await waitFor(() => expect(h.onSplit).toHaveBeenCalledExactlyOnceWith(updated, [2, 2, 1]));
  });
  it.each([false, true])('blocks a completing parent inside the popover even with external disabled=%s', (disabled) => {
    const h = setup(piece('a', 3));
    h.rerender(<PlanningBoardPiecesContext.Provider value={{ ...h.value, completionPendingParentIds: new Set([row.itemId]) }}>
      <PlanningBoardPiecePopover item={piece('a', 3)} disabled={disabled} />
    </PlanningBoardPiecesContext.Provider>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
  it('scrolls many piece rows inside the viewport-bounded dialog', async () => {
    setup({ ...row, plannedQuantity: 30 });
    fireEvent.click(screen.getByRole('button', { name: /の数量/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '分け数を増やす' })).toBeEnabled());
    for (let i = 2; i < 30; i++) fireEvent.click(screen.getByRole('button', { name: '分け数を増やす' }));
    expect(screen.getByLabelText('30片目の数量')).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: '分け数を増やす' })).toBeDisabled();
    expect(document.querySelector('[data-planning-board-piece-dialog]')!.parentElement).toHaveClass('overflow-y-auto', '!max-h-[calc(100dvh-4rem)]');
  });
  it('opens without changing body scroll styles or querying focusable element layout', () => {
    const originalOverflow = document.body.style.overflow;
    const offsetParent = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get');
    setup();
    const trigger = screen.getByRole('button'); trigger.focus(); fireEvent.click(trigger);
    expect(document.body.style.overflow).toBe(originalOverflow);
    expect(offsetParent).not.toHaveBeenCalled();
    expect(document.querySelector('[data-planning-board-piece-dialog]')).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('uses Dialog focus restoration when the trigger survives saving', async () => {
    setup();
    const trigger = screen.getByRole('button', { name: '部品Aの数量 5個' });
    trigger.focus(); fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('button', { name: '分ける' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: '分ける' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
  it('re-splits three into 1+2 and displays a proportion band', async () => {
    const value = piece('b', 3);
    const { onSplit, container } = setup(value);
    expect(container.querySelector('[style="width: 60%;"]')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '部品Aの数量 3／5' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '分ける' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: '分ける' }));
    await waitFor(() => expect(onSplit).toHaveBeenCalledExactlyOnceWith(value, [1, 2]));
  });
  it('does not offer merging on an unselected sibling', () => {
    const items = [piece('a', 2), piece('b', 2), piece('c', 1)];
    setup(items[2], items, new Set([items[0]!.itemId, items[1]!.itemId]), false);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps action identity while showing the latest write pending reason inside the popup', async () => {
    const options = { createEnabled: true, enabled: true, resourceCategories: { 'CUT-1': 'cutting' as const },
      selectedItems: [], changePieces: vi.fn(), blocked: false };
    const { result, rerender } = renderHook((props) => usePlanningBoardPieceActions(props), { initialProps: options });
    const actions = result.current;
    render(<PlanningBoardPiecesContext.Provider value={actions}><PlanningBoardPiecePopover item={row} /></PlanningBoardPiecesContext.Provider>);
    rerender({ ...options, blocked: true });
    expect(result.current).toBe(actions);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('保存中…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: '分ける' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '分け数を増やす' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '分け数を減らす' })).toBeDisabled();
    rerender(options);
    expect(screen.queryByText('保存中…')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '分ける' })).toBeEnabled());
  });
  it('keeps context stable and updates only the open dialog on readiness loss and recovery', async () => {
    const options = { createEnabled: true, enabled: true, resourceCategories: { 'CUT-1': 'cutting' as const },
      selectedItems: [], changePieces: vi.fn(), ready: true };
    const { result, rerender } = renderHook((props) => usePlanningBoardPieceActions(props), { initialProps: options });
    const actions = result.current;
    render(<PlanningBoardPiecesContext.Provider value={actions}><PlanningBoardPiecePopover item={row} /></PlanningBoardPiecesContext.Provider>);
    fireEvent.click(screen.getByRole('button'));
    rerender({ ...options, ready: false });
    expect(result.current).toBe(actions);
    expect(screen.getByText('保存中…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('button', { name: '分ける' })).toBeDisabled();
    expect(screen.getByRole('dialog').firstElementChild).not.toHaveClass('!border-red-500');
    rerender(options);
    expect(result.current).toBe(actions);
    expect(screen.queryByText('保存中…')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '分ける' })).toBeEnabled());
  });
  it('does not retain a guarded wait or hide a later store conflict after recovery', async () => {
    const options = { createEnabled: true, enabled: true, resourceCategories: { 'CUT-1': 'cutting' as const },
      selectedItems: [], changePieces: vi.fn().mockRejectedValue(new PieceOperationBlockedError('保存中…')),
      blocked: false, blockedMessage: '保存中…', blockedIsError: false };
    const { result, rerender } = renderHook((props) => usePlanningBoardPieceActions(props), { initialProps: options });
    const actions = result.current;
    render(<PlanningBoardPiecesContext.Provider value={actions}><PlanningBoardPiecePopover item={row} /></PlanningBoardPiecesContext.Provider>);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button', { name: '分ける' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: '分ける' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '分ける' })).toBeEnabled());
    expect(screen.queryByText('保存中…')).not.toBeInTheDocument();
    rerender({ ...options, blocked: true });
    expect(screen.getByText('保存中…')).toHaveAttribute('role', 'status');
    expect(screen.getByRole('dialog').firstElementChild).not.toHaveClass('!border-red-500');
    rerender({ ...options, blocked: true, blockedMessage: '表示中のデータが更新されています。最新状態を取得してください。', blockedIsError: true });
    expect(screen.getByRole('alert')).toHaveTextContent('表示中のデータが更新されています。最新状態を取得してください。');
    rerender(options);
    expect(screen.queryByText('保存中…')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(result.current).toBe(actions);
  });
  it('ignores a second tap on the newly opened backdrop, then permits closing', () => {
    vi.useFakeTimers();
    try {
      setup();
      fireEvent.click(screen.getByRole('button'));
      fireEvent.mouseDown(screen.getByRole('dialog'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(350); });
      fireEvent.mouseDown(screen.getByRole('dialog'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    } finally { vi.useRealTimers(); }
  });
  it.each(['split', 'merge'])('guards counter and %s buttons for the whole opening gesture', (operation) => {
    vi.useFakeTimers();
    try {
      const items = [piece('a', 2), piece('b', 3)];
      const h = setup(items[1], items);
      fireEvent.click(screen.getByRole('button'));
      for (const button of screen.getAllByRole('button').slice(1)) expect(button).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: operation === 'split' ? '分ける' : 'まとめる' }));
      act(() => { vi.advanceTimersByTime(349); });
      expect(h.onSplit).not.toHaveBeenCalled(); expect(h.onMerge).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: '分け数を増やす' })).toBeDisabled();
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.getByRole('button', { name: '分け数を増やす' })).toBeEnabled();
      expect(screen.getByRole('button', { name: operation === 'split' ? '分ける' : 'まとめる' })).toBeEnabled();
    } finally { vi.useRealTimers(); }
  });
  it('disables count controls during its own save while keeping Escape active', async () => {
    const h = setup();
    let finish!: () => void;
    h.onSplit.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('button', { name: '分ける' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '分け数を増やす' }));
    fireEvent.click(screen.getByRole('button', { name: '分ける' }));
    expect(h.onSplit).toHaveBeenCalledExactlyOnceWith(row, [1, 2, 2]);
    expect(screen.getByRole('button', { name: '分け数を増やす' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '分け数を減らす' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '分け数を増やす' }));
    expect(screen.getByLabelText('分け数')).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('button', { name: '分ける' }));
    expect(h.onSplit).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await act(async () => finish());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps an open popup when capabilities are lost and removes its control only after closing', () => {
    const h = setup();
    const trigger = screen.getByRole('button'); trigger.focus(); fireEvent.click(trigger);
    h.rerender(<PlanningBoardPiecesContext.Provider value={{ ...h.value, createEnabled: false, enabled: false }}><PlanningBoardPiecePopover item={row} /></PlanningBoardPiecesContext.Provider>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(trigger).toBeDisabled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('5個')).toBeInTheDocument();
  });
  it('keeps the quantity text while giving an enabled trigger a 44px target', () => {
    setup();
    expect(screen.getByRole('button')).toHaveTextContent('5個');
    expect(screen.getByRole('button')).toHaveClass('min-h-11', 'min-w-11');
  });
  it('merges selected unfinished siblings even when creation is disabled', async () => {
    const items = [piece('a', 2), piece('b', 3)];
    const { onMerge } = setup(items[0], items, new Set(items.map((item) => item.itemId)), false);
    fireEvent.click(screen.getByRole('button', { name: '部品Aの数量 2／5' }));
    expect(screen.queryByText('分ける')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'まとめる' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: 'まとめる' }));
    await waitFor(() => expect(onMerge).toHaveBeenCalledExactlyOnceWith(items));
  });
  it.each([{ isCompleted: true }, { quantityWarning: 'INVALID_PLANNED_QUANTITY' as const }, { completionSource: 'import' as const, isCompleted: true }])('does not split or merge completed/warning items: %j', (extra) => {
    const items = [piece('a', 2, extra), piece('b', 3)];
    const { container } = setup(items[0], items);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('2／5')).toBeInTheDocument();
    expect(container.querySelector('[style="width: 40%;"]')).toBeInTheDocument();
  });
  it('displays the proportion band when the creation gate is off', () => {
    const item = piece('a', 2);
    const { container } = setup(item, [item], new Set(), false);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('2／5')).toBeInTheDocument();
    expect(container.querySelector('[style="width: 40%;"]')).toBeInTheDocument();
  });
  it('displays the proportion band without operation capabilities', () => {
    const { container } = render(<PlanningBoardPiecePopover item={piece('a', 2)} />);
    expect(screen.getByText('2／5')).toBeInTheDocument();
    expect(container.querySelector('[style="width: 40%;"]')).toBeInTheDocument();
  });
  it('rejects a selection containing another parent and hides operations without capabilities', () => {
    const items = [piece('a', 2), piece('b', 3, { parentItemId: 'row:other' })];
    const { unmount } = setup(items[0], items, new Set(items.map((item) => item.itemId)), false);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount(); render(<PlanningBoardPiecePopover item={row} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('keeps the popup and marks failure locally without resending', async () => {
    const { onSplit } = setup(); onSplit.mockRejectedValue({ response: { status: 409 } });
    fireEvent.click(screen.getByRole('button')); await waitFor(() => expect(screen.getByRole('button', { name: '分ける' })).toBeEnabled()); fireEvent.click(screen.getByRole('button', { name: '分ける' }));
    await waitFor(() => expect(screen.getByRole('dialog').firstElementChild).toHaveClass('!border-red-500'));
    expect(screen.getByRole('alert')).toHaveTextContent('保存できませんでした。時間をおいて再試行してください。');
    expect(onSplit).toHaveBeenCalledTimes(1);
  });
});

describe('usePlanningBoardPieceFocus', () => {
  it('does not focus behind a modal during a successful refresh', () => {
    const item = piece('a', 2);
    render(<><button data-planning-board-quantity-item={item.itemId}>quantity</button>
      <div role="dialog" aria-modal="true" tabIndex={-1}>数量</div></>);
    const modal = screen.getByRole('dialog'); modal.focus();
    const { result, rerender } = renderHook(({ pending }) => usePlanningBoardPieceFocus([item], pending), { initialProps: { pending: true } });
    result.current.current = { itemId: item.itemId, parentItemId: row.itemId };
    rerender({ pending: false });
    expect(modal).toHaveFocus();
  });
  it('consumes recovery focus once without stealing focus from another input', () => {
    const item = piece('a', 2);
    render(<><input aria-label="scan" /><button data-planning-board-quantity-item={item.itemId}>quantity</button></>);
    const { result, rerender } = renderHook(({ items, ready }) => usePlanningBoardPieceFocus(items, false, ready), {
      initialProps: { items: [] as GrindingPlanningBoardItem[], ready: false }
    });
    result.current.current = { itemId: item.itemId, parentItemId: row.itemId };
    screen.getByRole('textbox').focus();
    rerender({ items: [item], ready: true });
    expect(screen.getByRole('textbox')).toHaveFocus();
    expect(result.current.current).toBeNull();
    screen.getByRole('textbox').blur();
    rerender({ items: [item], ready: true });
    expect(screen.getByRole('button')).not.toHaveFocus();
  });
  it('clears a filtered target without scanning the DOM again', () => {
    const item = piece('a', 2);
    const initialProps = { items: [item], pending: true };
    const { result, rerender } = renderHook(({ items, pending }) => usePlanningBoardPieceFocus(items, pending), { initialProps });
    result.current.current = item.itemId;
    const query = vi.spyOn(document, 'querySelectorAll');
    rerender({ items: [], pending: false });
    expect(result.current.current).toBeNull();
    expect(query).not.toHaveBeenCalled();
    rerender({ items: [piece('b', 3)], pending: false });
    expect(query).not.toHaveBeenCalled();
    query.mockRestore();
  });
  it('retains an absent target after failed refresh and focuses it after recovery', () => {
    const item = piece('a', 2);
    const initialProps = { items: [] as GrindingPlanningBoardItem[], refreshSucceeded: false };
    const { result, rerender } = renderHook(({ items, refreshSucceeded }) => usePlanningBoardPieceFocus(items, false, refreshSucceeded), { initialProps });
    result.current.current = { itemId: item.itemId, parentItemId: row.itemId };
    rerender(initialProps);
    expect(result.current.current).toEqual({ itemId: item.itemId, parentItemId: row.itemId });
    render(<button data-planning-board-quantity-item={item.itemId}>2／5</button>);
    rerender({ items: [item], refreshSucceeded: true });
    expect(screen.getByRole('button')).toHaveFocus();
    expect(result.current.current).toBeNull();
  });
  it.each(['parent', 'sibling', 'table'])('falls back to the %s when the target disappears', (fallback) => {
    const sibling = piece('b', 3);
    const items = fallback === 'parent' ? [row] : fallback === 'sibling' ? [sibling] : [];
    const targetItem = items[0];
    render(targetItem ? <button data-planning-board-quantity-item={targetItem.itemId}>quantity</button> : <table><tbody /></table>);
    const { result, rerender } = renderHook(({ pending }) => usePlanningBoardPieceFocus(items, pending), { initialProps: { pending: true } });
    result.current.current = { itemId: 'piece:removed', parentItemId: row.itemId };
    rerender({ pending: false });
    expect(targetItem ? screen.getByRole('button') : screen.getByRole('table')).toHaveFocus();
    expect(result.current.current).toBeNull();
  });
  it('focuses a visible quantity button and clears its target', () => {
    const item = piece('a', 2);
    render(<button data-planning-board-quantity-item={item.itemId}>2／5</button>);
    const { result, rerender } = renderHook(({ pending }) => usePlanningBoardPieceFocus([item], pending), { initialProps: { pending: true } });
    result.current.current = item.itemId;
    rerender({ pending: false });
    expect(screen.getByRole('button')).toHaveFocus();
    expect(result.current.current).toBeNull();
  });
});
