import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanningBoardToolbar, type PlanningBoardToolbarProps } from './grindingPlanningBoard/PlanningBoardToolbar';
import { usePersistedArrivalFilter } from './usePersistedArrivalFilter';

const toolbarProps: PlanningBoardToolbarProps = {
  categories: { grinding: true, cutting: false }, view: 'resource', status: 'incomplete', allocation: 'alternate',
  selectedCount: 0, registeredCount: 0, onOpenDrawer: vi.fn(), onCategoriesChange: vi.fn(), onViewChange: vi.fn(),
  onStatusChange: vi.fn(), onAllocationChange: vi.fn(), onOpenDueEditor: vi.fn()
};
function Toolbar() {
  const { arrivalFilterEnabled, toggleArrivalFilter } = usePersistedArrivalFilter('planning-terminal');
  return <PlanningBoardToolbar {...toolbarProps} arrivalFilterEnabled={arrivalFilterEnabled} onToggleArrivalFilter={toggleArrivalFilter} />;
}

describe('arrival preference', () => {
  beforeEach(() => localStorage.clear());
  it('defaults ON, toggles via the 46px 着 button immediately after 工程, and persists on remount', () => {
    const first = render(<Toolbar />);
    const button = screen.getByRole('button', { name: '前工程が済んだものだけ表示' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveClass('h-[46px]', 'w-[46px]', 'text-base', 'font-bold', 'bg-sky-400');
    expect(button.previousElementSibling).toBe(screen.getByRole('group', { name: '工程' }));
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveClass('border-slate-600', 'text-sky-300');
    first.unmount();
    render(<Toolbar />);
    expect(screen.getByRole('button', { name: '前工程が済んだものだけ表示' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('isolates board and terminal keys and loads each scope without overwriting saved values', () => {
    const { result, rerender } = renderHook(({ key }) => usePersistedArrivalFilter(key), { initialProps: { key: 'leader:site\0A' } });
    act(() => result.current.toggleArrivalFilter());
    expect(result.current.arrivalFilterEnabled).toBe(false);
    rerender({ key: 'leader:site\0B' });
    expect(result.current.arrivalFilterEnabled).toBe(true);
    rerender({ key: 'planning-terminal' });
    expect(result.current.arrivalFilterEnabled).toBe(true);
    rerender({ key: 'leader:site\0A' });
    expect(result.current.arrivalFilterEnabled).toBe(false);
  });
  it('defaults ON with malformed storage and retains the session preference if storage is unavailable', () => {
    localStorage.setItem('key', '{');
    const { result } = renderHook(() => usePersistedArrivalFilter('key'));
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    act(() => result.current.toggleArrivalFilter());
    expect(result.current.arrivalFilterEnabled).toBe(false);
    spy.mockRestore();
  });
});
