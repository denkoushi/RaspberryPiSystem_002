import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePersistedLeaderBoardLaborMode } from '../usePersistedLeaderBoardLaborMode';

describe('usePersistedLeaderBoardLaborMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults all slots to OFF', async () => {
    const { result } = renderHook(() => usePersistedLeaderBoardLaborMode('第2工場', 'DeviceA', 4));
    await waitFor(() => {
      expect(result.current.laborEnabledBySlotIndex).toEqual([false, false, false, false]);
    });
  });

  it('persists slot toggles per site and device', async () => {
    const { result } = renderHook(() => usePersistedLeaderBoardLaborMode('第2工場', 'DeviceA', 2));
    await waitFor(() => {
      expect(result.current.isLaborEnabledForSlot(0)).toBe(false);
    });

    act(() => {
      result.current.toggleLaborForSlot(0);
    });

    await waitFor(() => {
      expect(result.current.isLaborEnabledForSlot(0)).toBe(true);
      expect(result.current.isLaborEnabledForSlot(1)).toBe(false);
    });

    const raw = window.localStorage.getItem('kiosk-leader-order-board-labor-mode:第2工場\0DeviceA');
    expect(raw).toContain('"enabledBySlotIndex":[true,false]');
  });

  it('does not overwrite the next scope before hydration completes', async () => {
    window.localStorage.setItem(
      'kiosk-leader-order-board-labor-mode:第2工場\0DeviceB',
      JSON.stringify({ schemaVersion: 1, enabledBySlotIndex: [true] })
    );
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { result, rerender } = renderHook(
      ({ deviceScopeKey }) => usePersistedLeaderBoardLaborMode('第2工場', deviceScopeKey, 1),
      { initialProps: { deviceScopeKey: 'DeviceA' } }
    );

    await waitFor(() => {
      expect(result.current.isLaborEnabledForSlot(0)).toBe(false);
    });

    setItemSpy.mockClear();

    act(() => {
      rerender({ deviceScopeKey: 'DeviceB' });
    });

    await waitFor(() => {
      expect(result.current.isLaborEnabledForSlot(0)).toBe(true);
    });

    expect(setItemSpy).not.toHaveBeenCalledWith(
      'kiosk-leader-order-board-labor-mode:第2工場\0DeviceB',
      expect.stringContaining('"enabledBySlotIndex":[false]')
    );
  });
});
