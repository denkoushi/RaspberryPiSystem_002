import { act, render, screen } from '@testing-library/react';
import { Suspense } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scheduleKioskPreload } from './browserKioskSeamlessUpdate';
import { createKioskLazyPreloader, KIOSK_PRELOAD_GAP_MS, KIOSK_PRELOAD_INITIAL_DELAY_MS } from './kioskLazyPreload';

describe('kiosk registered lazy preloading', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('loads in sequence once, observes gaps, continues after failure, and shares the lazy loader', async () => {
    const preloader = createKioskLazyPreloader();
    const calls: string[] = [];
    let resolveFirst!: (value: { default: () => JSX.Element }) => void;
    const first = vi.fn(() => {
      calls.push('first');
      return new Promise<{ default: () => JSX.Element }>((resolve) => { resolveFirst = resolve; });
    });
    const First = preloader.lazy(first);
    const failure = vi.fn(async () => { calls.push('failed'); throw new Error('missing chunk'); });
    preloader.lazy(failure);
    const third = vi.fn(async () => { calls.push('third'); return { default: () => null }; });
    preloader.lazy(third);
    const cancel = preloader.start('/kiosk/tag', false, scheduleKioskPreload);
    await vi.advanceTimersByTimeAsync(KIOSK_PRELOAD_INITIAL_DELAY_MS - 1);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(calls).toEqual(['first']);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toEqual(['first']); // No overlap while an import is pending.
    resolveFirst({ default: () => <div>loaded</div> });
    await vi.advanceTimersByTimeAsync(KIOSK_PRELOAD_GAP_MS - 1);
    expect(calls).toEqual(['first']);
    await vi.advanceTimersByTimeAsync(2 * KIOSK_PRELOAD_GAP_MS + 10);
    expect(calls).toEqual(['first', 'failed', 'third']);
    cancel();
    const cancelAgain = preloader.start('/kiosk/photo', false, scheduleKioskPreload);
    await vi.runAllTimersAsync();
    render(<Suspense fallback="waiting"><First /></Suspense>);
    await act(async () => {});
    expect(screen.getByText('loaded')).toBeInTheDocument();
    expect(first).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
    cancelAgain();
  });

  it.each([['/admin', false], ['/kiosks', false], ['/kiosk/tag', true]])('does not preload on %s (development=%s)', async (path, dev) => {
    const preloader = createKioskLazyPreloader();
    const loader = vi.fn(async () => ({ default: () => null }));
    preloader.lazy(loader);
    preloader.start(path as string, dev as boolean, scheduleKioskPreload);
    await vi.runAllTimersAsync();
    expect(loader).not.toHaveBeenCalled();
  });

  it('pauses on cleanup and resumes without duplicate imports, including nested registration', async () => {
    const preloader = createKioskLazyPreloader();
    const nested = vi.fn(async () => ({ default: () => null }));
    const first = vi.fn(async () => { preloader.lazy(nested); return { default: () => null }; });
    preloader.lazy(first);
    const stopBeforeMount = preloader.start('/kiosk', false, scheduleKioskPreload);
    stopBeforeMount();
    const stop = preloader.start('/kiosk', false, scheduleKioskPreload);
    await vi.advanceTimersByTimeAsync(KIOSK_PRELOAD_INITIAL_DELAY_MS + 1);
    expect(first).toHaveBeenCalledTimes(1);
    stop();
    await vi.runAllTimersAsync();
    expect(nested).not.toHaveBeenCalled();
    const stopAgain = preloader.start('/kiosk', false, scheduleKioskPreload);
    await vi.runAllTimersAsync();
    expect(nested).toHaveBeenCalledTimes(1);
    stopAgain();
  });

  it('uses requestIdleCallback after the delay, and cancels its pending work', async () => {
    const idle = vi.fn(() => 7);
    const cancelIdle = vi.fn();
    vi.stubGlobal('requestIdleCallback', idle);
    vi.stubGlobal('cancelIdleCallback', cancelIdle);
    const callback = vi.fn();
    const cancel = scheduleKioskPreload(callback, 5_000);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(idle).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(idle).toHaveBeenCalledWith(callback);
    expect(callback).not.toHaveBeenCalled();
    cancel();
    expect(cancelIdle).toHaveBeenCalledWith(7);
  });
});
