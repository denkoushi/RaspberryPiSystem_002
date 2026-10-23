import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTimeoutSignal } from '../timeout-signal.js';

describe('createTimeoutSignal', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('aborts only after the timeout elapses', () => {
    const { signal, cleanup } = createTimeoutSignal(100);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(99);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    cleanup();
  });

  it('does not abort when cleanup runs first', () => {
    const { signal, cleanup } = createTimeoutSignal(100);
    vi.advanceTimersByTime(50);
    cleanup();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(100);
    expect(signal.aborted).toBe(false);
  });
});
