import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KIOSK_REVEAL_CLOSE_DELAY_MS } from './kioskRevealUi';
import { useTimedHoverReveal } from './useTimedHoverReveal';

describe('useTimedHoverReveal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('closes after the delay once the pointer leaves', () => {
    const { result } = renderHook(() => useTimedHoverReveal(true));
    act(() => result.current.onHotZoneEnter());
    act(() => result.current.onHeaderMouseLeave());
    act(() => vi.advanceTimersByTime(KIOSK_REVEAL_CLOSE_DELAY_MS));
    expect(result.current.isVisible).toBe(false);
  });

  it('keeps waiting while closing is blocked and closes when the block ends', () => {
    let blocked = true;
    const { result } = renderHook(() => useTimedHoverReveal(true, () => !blocked));
    act(() => result.current.onHotZoneEnter());
    act(() => result.current.onHeaderMouseLeave());
    act(() => vi.advanceTimersByTime(KIOSK_REVEAL_CLOSE_DELAY_MS * 3));
    expect(result.current.isVisible).toBe(true);
    blocked = false;
    act(() => vi.advanceTimersByTime(KIOSK_REVEAL_CLOSE_DELAY_MS));
    expect(result.current.isVisible).toBe(false);
  });

  it('stays open when the pointer returns while closing is blocked', () => {
    let blocked = true;
    const { result } = renderHook(() => useTimedHoverReveal(true, () => !blocked));
    act(() => result.current.onHotZoneEnter());
    act(() => result.current.onHeaderMouseLeave());
    act(() => vi.advanceTimersByTime(KIOSK_REVEAL_CLOSE_DELAY_MS));
    act(() => result.current.onHeaderMouseEnter());
    blocked = false;
    act(() => vi.advanceTimersByTime(KIOSK_REVEAL_CLOSE_DELAY_MS * 3));
    expect(result.current.isVisible).toBe(true);
  });

  it('tells the guard whether the close is automatic or explicit', () => {
    const guard = vi.fn(() => true);
    const { result } = renderHook(() => useTimedHoverReveal(true, guard));
    act(() => result.current.onHotZoneEnter());
    act(() => result.current.close());
    expect(guard).toHaveBeenLastCalledWith('manual');
    act(() => result.current.onHotZoneEnter());
    act(() => result.current.onHeaderMouseLeave());
    act(() => vi.advanceTimersByTime(KIOSK_REVEAL_CLOSE_DELAY_MS));
    expect(guard).toHaveBeenLastCalledWith('timer');
  });
});
