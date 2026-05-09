import { describe, expect, it } from 'vitest';

import { computeProductionScheduleDisappearanceOccurredAtBounds } from '../schedule-csv-disappearance-occurred-at-window.policy.js';

describe('computeProductionScheduleDisappearanceOccurredAtBounds', () => {
  it('shifts reference by ±3 calendar months in UTC', () => {
    const ref = new Date(Date.UTC(2026, 4, 9, 12, 0, 0));
    const { windowStart, windowEnd } = computeProductionScheduleDisappearanceOccurredAtBounds(ref);

    expect(windowStart.toISOString()).toBe(new Date(Date.UTC(2026, 1, 9, 12, 0, 0)).toISOString());
    expect(windowEnd.toISOString()).toBe(new Date(Date.UTC(2026, 7, 9, 12, 0, 0)).toISOString());
  });
});
