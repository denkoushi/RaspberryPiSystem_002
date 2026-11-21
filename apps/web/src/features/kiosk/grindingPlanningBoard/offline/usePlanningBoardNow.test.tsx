import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { endForwardDropCache } from '../gantt/planningBoardForwardDrop';
import { usePlanningBoardDragPreview } from '../gantt/usePlanningBoardSharedDrag';

import { usePlanningBoardNow } from './usePlanningBoardNow';

const preview = { bar: {}, x: 1, y: 1, allowed: new Set<string>(), drop: null } as never;
const START = new Date('2026-11-20T00:00:00Z').getTime();

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
afterEach(() => { endForwardDropCache(); vi.useRealTimers(); });

describe('usePlanningBoardNow', () => {
  it('follows the clock every 30 seconds when nothing is dragged', () => {
    const { result } = renderHook(() => usePlanningBoardNow());
    expect(result.current).toBe(START);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(result.current).toBe(START + 30_000);
  });

  it('holds the value while dragging and applies the latest one after the drop', () => {
    const now = renderHook(() => usePlanningBoardNow());
    const drag = renderHook(() => usePlanningBoardDragPreview());
    act(() => drag.result.current[1](preview));
    act(() => { vi.advanceTimersByTime(90_000); });
    expect(now.result.current).toBe(START);
    act(() => drag.result.current[1](null));
    expect(now.result.current).toBe(START + 90_000);
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(now.result.current).toBe(START + 120_000);
  });

  it('applies the latest value when the drag owner unmounts mid-drag', () => {
    const now = renderHook(() => usePlanningBoardNow());
    const drag = renderHook(() => usePlanningBoardDragPreview());
    act(() => drag.result.current[1](preview));
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(now.result.current).toBe(START);
    drag.unmount();
    expect(now.result.current).toBe(START + 60_000);
  });
});
