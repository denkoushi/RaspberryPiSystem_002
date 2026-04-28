import { describe, expect, it } from 'vitest';

import { getHourInTimeZone, isWithinLocalLlmWarmWindow } from '../local-llm-runtime-schedule.policy.js';

const window7to23 = {
  enabled: true,
  timeZone: 'Asia/Tokyo',
  startHourInclusive: 7,
  endHourExclusive: 23,
} as const;

describe('local-llm-runtime-schedule.policy', () => {
  it('returns hour in time zone (Asia/Tokyo)', () => {
    // 2026-04-28 06:59 JST
    expect(getHourInTimeZone(new Date('2026-04-27T21:59:00.000Z'), 'Asia/Tokyo')).toBe(6);
    // 2026-04-28 07:00 JST
    expect(getHourInTimeZone(new Date('2026-04-27T22:00:00.000Z'), 'Asia/Tokyo')).toBe(7);
    // 2026-04-28 22:59 JST
    expect(getHourInTimeZone(new Date('2026-04-28T13:59:00.000Z'), 'Asia/Tokyo')).toBe(22);
    // 2026-04-28 23:00 JST
    expect(getHourInTimeZone(new Date('2026-04-28T14:00:00.000Z'), 'Asia/Tokyo')).toBe(23);
  });

  it('is false just before warm window, true at start, true just before end, false at end (JST 7–23)', () => {
    expect(isWithinLocalLlmWarmWindow(new Date('2026-04-27T21:59:00.000Z'), window7to23)).toBe(false);
    expect(isWithinLocalLlmWarmWindow(new Date('2026-04-27T22:00:00.000Z'), window7to23)).toBe(true);
    expect(isWithinLocalLlmWarmWindow(new Date('2026-04-28T13:59:00.000Z'), window7to23)).toBe(true);
    expect(isWithinLocalLlmWarmWindow(new Date('2026-04-28T14:00:00.000Z'), window7to23)).toBe(false);
  });

  it('when disabled, always false', () => {
    expect(
      isWithinLocalLlmWarmWindow(new Date('2026-04-27T22:00:00.000Z'), {
        ...window7to23,
        enabled: false,
      })
    ).toBe(false);
  });

  it('when start >= end, always false even if enabled', () => {
    expect(
      isWithinLocalLlmWarmWindow(new Date('2026-04-27T22:00:00.000Z'), {
        enabled: true,
        timeZone: 'Asia/Tokyo',
        startHourInclusive: 23,
        endHourExclusive: 7,
      })
    ).toBe(false);
  });
});
