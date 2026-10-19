import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useKeyedSingleFlight, useSingleFlight } from './useSingleFlight';

function deferred() {
  let resolve!: (value: number) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<number>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

describe('useSingleFlight', () => {
  it('blocks synchronous duplicates, reports pending and allows a new run after completion', async () => {
    const work = deferred();
    const fn = vi.fn(() => work.promise);
    const { result } = renderHook(useSingleFlight, { wrapper: StrictMode });
    let first!: Promise<number | undefined>;
    let duplicate!: Promise<number | undefined>;
    act(() => {
      first = result.current.run(fn);
      duplicate = result.current.run(fn);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);
    await expect(duplicate).resolves.toBeUndefined();
    await act(async () => { work.resolve(42); await expect(first).resolves.toBe(42); });
    expect(result.current.pending).toBe(false);
    await act(async () => { await expect(result.current.run(() => 7)).resolves.toBe(7); });
  });

  it('releases the guard and rethrows after rejection or a synchronous throw', async () => {
    const { result } = renderHook(useSingleFlight);
    const work = deferred();
    const error = new Error('save failed');
    let first!: Promise<number | undefined>;
    act(() => { first = result.current.run(() => work.promise); });
    expect(result.current.pending).toBe(true);
    await act(async () => { work.reject(error); await expect(first).rejects.toBe(error); });
    expect(result.current.pending).toBe(false);
    await act(async () => {
      await expect(result.current.run(() => { throw error; })).rejects.toBe(error);
    });
    expect(result.current.pending).toBe(false);
    await act(async () => { await expect(result.current.run(() => 1)).resolves.toBe(1); });
  });

  it('finishes safely after unmount and ignores calls through a stale handler', async () => {
    const work = deferred();
    const { result, unmount } = renderHook(useSingleFlight);
    const run = result.current.run;
    let first!: Promise<number | undefined>;
    act(() => { first = run(() => work.promise); });
    unmount();
    work.resolve(1);
    await expect(first).resolves.toBe(1);
    const fn = vi.fn();
    await run(fn);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('useKeyedSingleFlight', () => {
  it('blocks only the same key and independently releases successful and failed writes', async () => {
    const a = deferred();
    const b = deferred();
    const fn = vi.fn(() => a.promise);
    const { result } = renderHook(() => useKeyedSingleFlight<string>());
    let first!: Promise<number | undefined>;
    let second!: Promise<number | undefined>;
    act(() => {
      first = result.current.run('a', fn);
      void result.current.run('a', fn);
      second = result.current.run('b', () => b.promise);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result.current.isPending('a')).toBe(true);
    expect(result.current.isPending('b')).toBe(true);
    await act(async () => { a.resolve(1); await first; });
    expect(result.current.isPending('a')).toBe(false);
    expect(result.current.isPending('b')).toBe(true);
    await act(async () => { b.reject(new Error('failed')); await expect(second).rejects.toThrow('failed'); });
    expect(result.current.isPending('b')).toBe(false);
    await act(async () => { await expect(result.current.run('a', () => 2)).resolves.toBe(2); });
  });
});
