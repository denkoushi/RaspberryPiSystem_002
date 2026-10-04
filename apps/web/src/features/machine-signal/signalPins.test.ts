import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSignalPins } from './signalPins';

describe('useSignalPins', () => {
  beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

  it('toggles pins, saves signal numbers and restores them on another mount', () => {
    const { result, unmount } = renderHook(useSignalPins);
    expect([...result.current.pins]).toEqual([]);
    act(() => result.current.toggle(2));
    act(() => result.current.toggle(5));
    expect([...result.current.pins]).toEqual([2, 5]);
    expect(localStorage.getItem('machine-signal-pins')).toBe('[2,5]');
    act(() => result.current.toggle(2));
    expect([...result.current.pins]).toEqual([5]);
    unmount();
    expect([...renderHook(useSignalPins).result.current.pins]).toEqual([5]);
  });

  it('ignores malformed or invalid saved data', () => {
    localStorage.setItem('machine-signal-pins', 'bad json');
    expect(renderHook(useSignalPins).result.current.pins.size).toBe(0);
    localStorage.setItem('machine-signal-pins', '[2,2,"5",null,-1,1.5]');
    expect([...renderHook(useSignalPins).result.current.pins]).toEqual([2]);
    localStorage.setItem('machine-signal-pins', '{}');
    expect(renderHook(useSignalPins).result.current.pins.size).toBe(0);
  });

  it('keeps toggling when reads and writes throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    const { result } = renderHook(useSignalPins);
    act(() => result.current.toggle(1));
    expect(result.current.pins.has(1)).toBe(true);
    act(() => result.current.toggle(1));
    expect(result.current.pins.size).toBe(0);
  });
});
