import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolveJstBusinessDayRange9am,
  resolveJstSignageBusinessDate,
} from '../signage-business-day.js';

describe('signage business day', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function withFakeSystemTime<T>(now: Date, run: () => T | Promise<T>): Promise<T> {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      return await run();
    } finally {
      vi.useRealTimers();
    }
  }

  it('8:59 JST uses previous calendar day', async () => {
    await withFakeSystemTime(new Date('2026-02-10T23:59:00.000Z'), () => {
      expect(resolveJstSignageBusinessDate()).toBe('2026-02-10');
    });
  });

  it('9:00 JST uses same calendar day', async () => {
    await withFakeSystemTime(new Date('2026-02-11T00:00:00.000Z'), () => {
      expect(resolveJstSignageBusinessDate()).toBe('2026-02-11');
    });
  });

  it('returns a half-open 9:00 JST business-day range', () => {
    const { date, start, end } = resolveJstBusinessDayRange9am('2026-02-10');

    expect(date).toBe('2026-02-10');
    expect(start.toISOString()).toBe('2026-02-10T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-02-11T00:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(86_400_000);
  });
});
