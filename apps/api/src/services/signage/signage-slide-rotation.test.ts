import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRotatingSlideIndex, type SignageSlideRotationState } from './signage-slide-rotation.js';

describe('getRotatingSlideIndex', () => {
  async function withFakeSystemTime<T>(now: Date, run: () => T | Promise<T>): Promise<T> {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      return await run();
    } finally {
      vi.useRealTimers();
    }
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns 0 and clears state when totalPages is 0', async () => {
    await withFakeSystemTime(new Date('2026-03-31T12:00:00.000Z'), () => {
      const map = new Map<string, SignageSlideRotationState>();
      map.set('k', { lastIndex: 2, lastRenderedAt: Date.now() });
      const idx = getRotatingSlideIndex(map, {
        stateKey: 'k',
        totalPages: 0,
        displayMode: 'SLIDESHOW',
        slideIntervalSeconds: 30,
        logContext: {},
      });
      expect(idx).toBe(0);
      expect(map.has('k')).toBe(false);
    });
  });

  it('starts at 0 and registers state', async () => {
    await withFakeSystemTime(new Date('2026-03-31T12:00:00.000Z'), () => {
      const map = new Map<string, SignageSlideRotationState>();
      const idx = getRotatingSlideIndex(map, {
        stateKey: 'a',
        totalPages: 3,
        displayMode: 'SLIDESHOW',
        slideIntervalSeconds: 30,
        logContext: { test: true },
      });
      expect(idx).toBe(0);
      expect(map.get('a')).toEqual({ lastIndex: 0, lastRenderedAt: Date.now() });
    });
  });

  it('advances at most one page after interval elapses', async () => {
    await withFakeSystemTime(new Date('2026-03-31T12:00:00.000Z'), () => {
      const map = new Map<string, SignageSlideRotationState>();
      getRotatingSlideIndex(map, {
        stateKey: 'a',
        totalPages: 3,
        displayMode: 'SLIDESHOW',
        slideIntervalSeconds: 30,
        logContext: {},
      });
      vi.setSystemTime(new Date('2026-03-31T12:00:31.000Z'));
      const idx = getRotatingSlideIndex(map, {
        stateKey: 'a',
        totalPages: 3,
        displayMode: 'SLIDESHOW',
        slideIntervalSeconds: 30,
        logContext: {},
      });
      expect(idx).toBe(1);
    });
  });

  it('wraps modulo totalPages', async () => {
    await withFakeSystemTime(new Date('2026-03-31T12:00:00.000Z'), () => {
      const map = new Map<string, SignageSlideRotationState>([
        ['a', { lastIndex: 2, lastRenderedAt: Date.now() }],
      ]);
      vi.setSystemTime(new Date('2026-03-31T12:00:31.000Z'));
      const idx = getRotatingSlideIndex(map, {
        stateKey: 'a',
        totalPages: 3,
        displayMode: 'SLIDESHOW',
        slideIntervalSeconds: 30,
        logContext: {},
      });
      expect(idx).toBe(0);
    });
  });
});
