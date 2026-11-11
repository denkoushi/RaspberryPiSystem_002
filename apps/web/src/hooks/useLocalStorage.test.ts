import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useLocalStorage, useLocalStorageApiKey, useLocalStorageUuid } from './useLocalStorage';

afterEach(() => vi.restoreAllMocks());

const hooks = [
  { name: 'generic', use: useLocalStorage<string>, fallback: 'default', next: 'next' },
  { name: 'apiKey', use: useLocalStorageApiKey, fallback: 'default-key', next: 'updated-key' },
  { name: 'uuid', use: useLocalStorageUuid, fallback: '', next: '550e8400-e29b-41d4-a716-446655440000' }
];

describe.each(hooks)('$name storage failures', ({ use, fallback, next }) => {
  it('preserves the JSON storage format', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(JSON.stringify(next));
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
    const { result } = renderHook(() => use('test-key', fallback));
    expect(result.current[0]).toBe(next);
    expect(write).toHaveBeenCalledWith('test-key', JSON.stringify(next));
  });

  it('uses the default when reading throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('unavailable', 'SecurityError'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => use('test-key', fallback));
    expect(result.current[0]).toBe(fallback);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Failed to read'), expect.any(DOMException));
  });

  it('keeps updated state when writing throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => use('test-key', fallback));
    act(() => result.current[1](next));
    expect(result.current[0]).toBe(next);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('Failed to write'), expect.any(DOMException));
  });
});
