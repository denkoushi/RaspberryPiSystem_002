import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FILL_HEIGHT_STORAGE_KEY, usePersistedPlanningBoardFillHeight } from './usePersistedPlanningBoardFillHeight';

beforeEach(() => { localStorage.clear(); vi.stubGlobal('innerHeight', 2160); });
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('fill height device preference', () => {
  it('synchronizes toolbar/chart, persists and restores independently of screen eligibility', () => {
    const first = renderHook(() => usePersistedPlanningBoardFillHeight(true));
    const chart = renderHook(() => usePersistedPlanningBoardFillHeight(true));
    expect(first.result.current.fillHeight).toBe(false);
    act(() => first.result.current.changeFillHeight(true));
    expect(chart.result.current.fillHeight).toBe(true);
    expect(JSON.parse(localStorage.getItem(FILL_HEIGHT_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, enabled: true });
    first.unmount(); chart.unmount();
    const restored = renderHook(({ grinding }) => usePersistedPlanningBoardFillHeight(grinding), { initialProps: { grinding: true } });
    expect(restored.result.current.fillHeight).toBe(true);
    restored.rerender({ grinding: false });
    expect(restored.result.current.available).toBe(false);
    expect(restored.result.current.fillHeight).toBe(false);
    restored.rerender({ grinding: true });
    act(() => { vi.stubGlobal('innerHeight', 1599); window.dispatchEvent(new Event('resize')); });
    expect(restored.result.current.fillHeight).toBe(false);
    act(() => { vi.stubGlobal('innerHeight', 1600); window.dispatchEvent(new Event('resize')); });
    expect(restored.result.current.fillHeight).toBe(true);
    act(() => restored.result.current.changeFillHeight(false));
    expect(JSON.parse(localStorage.getItem(FILL_HEIGHT_STORAGE_KEY)!).enabled).toBe(false);
  });
  it.each(['{', 'null', '{"schemaVersion":2,"enabled":true}', '{"schemaVersion":1,"enabled":"true"}'])('ignores invalid storage: %s', value => {
    localStorage.setItem(FILL_HEIGHT_STORAGE_KEY, value);
    expect(renderHook(() => usePersistedPlanningBoardFillHeight(true)).result.current.fillHeight).toBe(false);
  });
  it('shares the session selection when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const first = renderHook(() => usePersistedPlanningBoardFillHeight(true));
    const second = renderHook(() => usePersistedPlanningBoardFillHeight(true));
    act(() => first.result.current.changeFillHeight(true));
    expect(second.result.current.fillHeight).toBe(true);
  });
});
