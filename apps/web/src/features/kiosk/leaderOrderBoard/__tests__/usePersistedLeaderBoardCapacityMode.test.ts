import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  GANTT_EIGHT_HOURS_MINUTES,
  GANTT_TEN_HOURS_MINUTES
} from '../gantt/leaderBoardGanttConstants';
import { usePersistedLeaderBoardCapacityMode } from '../usePersistedLeaderBoardCapacityMode';

describe('usePersistedLeaderBoardCapacityMode', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults all slots to 8H', async () => {
    const { result } = renderHook(() => usePersistedLeaderBoardCapacityMode('第2工場', 'DeviceA', 3));

    await waitFor(() => {
      expect(result.current.capacityMinutesBySlotIndex).toEqual([
        GANTT_EIGHT_HOURS_MINUTES,
        GANTT_EIGHT_HOURS_MINUTES,
        GANTT_EIGHT_HOURS_MINUTES
      ]);
    });
  });

  it('persists 8H/10H toggles per site and device', async () => {
    const { result } = renderHook(() => usePersistedLeaderBoardCapacityMode('第2工場', 'DeviceA', 2));
    await waitFor(() => {
      expect(result.current.capacityMinutesForSlot(0)).toBe(GANTT_EIGHT_HOURS_MINUTES);
    });

    act(() => {
      result.current.toggleCapacityForSlot(0);
    });

    await waitFor(() => {
      expect(result.current.capacityMinutesForSlot(0)).toBe(GANTT_TEN_HOURS_MINUTES);
      expect(result.current.capacityMinutesForSlot(1)).toBe(GANTT_EIGHT_HOURS_MINUTES);
    });

    const raw = window.localStorage.getItem('kiosk-leader-order-board-capacity-mode:第2工場\0DeviceA');
    expect(raw).toContain('"capacityMinutesBySlotIndex":[600,480]');
  });

  it('does not overwrite the next scope before hydration completes', async () => {
    window.localStorage.setItem(
      'kiosk-leader-order-board-capacity-mode:第2工場\0DeviceB',
      JSON.stringify({ schemaVersion: 1, capacityMinutesBySlotIndex: [GANTT_TEN_HOURS_MINUTES] })
    );
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const { result, rerender } = renderHook(
      ({ deviceScopeKey }) => usePersistedLeaderBoardCapacityMode('第2工場', deviceScopeKey, 1),
      { initialProps: { deviceScopeKey: 'DeviceA' } }
    );

    await waitFor(() => {
      expect(result.current.capacityMinutesForSlot(0)).toBe(GANTT_EIGHT_HOURS_MINUTES);
    });

    setItemSpy.mockClear();

    act(() => {
      rerender({ deviceScopeKey: 'DeviceB' });
    });

    await waitFor(() => {
      expect(result.current.capacityMinutesForSlot(0)).toBe(GANTT_TEN_HOURS_MINUTES);
    });

    expect(setItemSpy).not.toHaveBeenCalledWith(
      'kiosk-leader-order-board-capacity-mode:第2工場\0DeviceB',
      expect.stringContaining('"capacityMinutesBySlotIndex":[480]')
    );
  });
});
