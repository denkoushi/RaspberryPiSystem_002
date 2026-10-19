import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LARGE_SCREEN_STORAGE_KEY, usePlanningBoardLargeScreen } from './usePlanningBoardLargeScreen';

describe('usePlanningBoardLargeScreen', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('defaults off, persists both selections and clears zoom on unmount', () => {
    const first = renderHook(usePlanningBoardLargeScreen);
    expect(first.result.current.largeScreen).toBe(false);
    expect(document.documentElement.style.zoom).toBe('');
    const resize = vi.fn();
    window.addEventListener('resize', resize);
    act(() => first.result.current.changeLargeScreen(true));
    window.removeEventListener('resize', resize);
    expect(resize).toHaveBeenCalledOnce();
    expect(document.documentElement.style.zoom).toBe('0.7');
    expect(JSON.parse(localStorage.getItem(LARGE_SCREEN_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, enabled: true });
    first.unmount();
    expect(document.documentElement.style.zoom).toBe('');
    const second = renderHook(usePlanningBoardLargeScreen);
    expect(second.result.current.largeScreen).toBe(true);
    expect(document.documentElement.style.zoom).toBe('0.7');
    act(() => second.result.current.changeLargeScreen(false));
    expect(document.documentElement.style.zoom).toBe('');
    expect(JSON.parse(localStorage.getItem(LARGE_SCREEN_STORAGE_KEY)!)).toEqual({ schemaVersion: 1, enabled: false });
    second.unmount();
    expect(renderHook(usePlanningBoardLargeScreen).result.current.largeScreen).toBe(false);
  });

  it.each(['{', 'null', '{"schemaVersion":2,"enabled":true}', '{"schemaVersion":1,"enabled":"true"}'])('ignores invalid storage: %s', (saved) => {
    localStorage.setItem(LARGE_SCREEN_STORAGE_KEY, saved);
    expect(renderHook(usePlanningBoardLargeScreen).result.current.largeScreen).toBe(false);
    expect(document.documentElement.style.zoom).toBe('');
  });

  it('works when storage reads and writes fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(usePlanningBoardLargeScreen);
    expect(result.current.largeScreen).toBe(false);
    act(() => result.current.changeLargeScreen(true));
    expect(result.current.largeScreen).toBe(true);
    expect(document.documentElement.style.zoom).toBe('0.7');
  });
});
