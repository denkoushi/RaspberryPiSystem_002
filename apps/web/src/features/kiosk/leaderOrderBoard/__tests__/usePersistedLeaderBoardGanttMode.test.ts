import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePersistedLeaderBoardGanttMode } from '../usePersistedLeaderBoardGanttMode';

describe('usePersistedLeaderBoardGanttMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to OFF', async () => {
    const { result } = renderHook(() => usePersistedLeaderBoardGanttMode('第2工場', 'DeviceA'));
    await waitFor(() => {
      expect(result.current.ganttEnabled).toBe(false);
    });
  });

  it('persists enabled state per site and device', async () => {
    const { result } = renderHook(() => usePersistedLeaderBoardGanttMode('第2工場', 'DeviceA'));
    await waitFor(() => {
      expect(result.current.ganttEnabled).toBe(false);
    });

    act(() => {
      result.current.toggleGanttMode();
    });

    await waitFor(() => {
      expect(result.current.ganttEnabled).toBe(true);
    });

    const raw = window.localStorage.getItem('kiosk-leader-order-board-gantt-mode:第2工場\0DeviceA');
    expect(raw).toContain('"enabled":true');
  });

  it('does not overwrite the next scope before hydration completes', async () => {
    window.localStorage.setItem(
      'kiosk-leader-order-board-gantt-mode:第2工場\0DeviceB',
      JSON.stringify({ schemaVersion: 1, enabled: true })
    );
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { result, rerender } = renderHook(
      ({ deviceScopeKey }) => usePersistedLeaderBoardGanttMode('第2工場', deviceScopeKey),
      { initialProps: { deviceScopeKey: 'DeviceA' } }
    );

    await waitFor(() => {
      expect(result.current.ganttEnabled).toBe(false);
    });

    setItemSpy.mockClear();

    act(() => {
      rerender({ deviceScopeKey: 'DeviceB' });
    });

    await waitFor(() => {
      expect(result.current.ganttEnabled).toBe(true);
    });

    expect(setItemSpy).not.toHaveBeenCalledWith(
      'kiosk-leader-order-board-gantt-mode:第2工場\0DeviceB',
      expect.stringContaining('"enabled":false')
    );
  });
});
