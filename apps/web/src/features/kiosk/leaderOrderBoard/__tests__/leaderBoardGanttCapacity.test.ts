import { describe, expect, it } from 'vitest';

import {
  normalizeLeaderBoardGanttCapacityMinutes,
  resolveLeaderBoardGanttCapacityMinutes
} from '../gantt/leaderBoardGanttCapacity';
import {
  GANTT_DEFAULT_CAPACITY_MINUTES,
  GANTT_MAX_CAPACITY_MINUTES
} from '../gantt/leaderBoardGanttConstants';

describe('leaderBoardGanttCapacity', () => {
  it('resolveLeaderBoardGanttCapacityMinutes returns default 480 for all slots initially', () => {
    expect(
      resolveLeaderBoardGanttCapacityMinutes({
        siteKey: 'site-a',
        deviceScopeKey: 'device-1',
        slotIndex: 0,
        resourceCd: '305'
      })
    ).toBe(GANTT_DEFAULT_CAPACITY_MINUTES);
    expect(
      resolveLeaderBoardGanttCapacityMinutes({
        siteKey: 'site-a',
        deviceScopeKey: 'device-1',
        slotIndex: 3,
        resourceCd: '584'
      })
    ).toBe(GANTT_DEFAULT_CAPACITY_MINUTES);
  });

  it('normalizeLeaderBoardGanttCapacityMinutes falls back to 480 for invalid values', () => {
    expect(normalizeLeaderBoardGanttCapacityMinutes(undefined)).toBe(GANTT_DEFAULT_CAPACITY_MINUTES);
    expect(normalizeLeaderBoardGanttCapacityMinutes(0)).toBe(GANTT_DEFAULT_CAPACITY_MINUTES);
    expect(normalizeLeaderBoardGanttCapacityMinutes(-10)).toBe(GANTT_DEFAULT_CAPACITY_MINUTES);
    expect(normalizeLeaderBoardGanttCapacityMinutes(Number.NaN)).toBe(GANTT_DEFAULT_CAPACITY_MINUTES);
    expect(normalizeLeaderBoardGanttCapacityMinutes(GANTT_MAX_CAPACITY_MINUTES + 1)).toBe(
      GANTT_DEFAULT_CAPACITY_MINUTES
    );
  });

  it('normalizeLeaderBoardGanttCapacityMinutes accepts valid custom capacity', () => {
    expect(normalizeLeaderBoardGanttCapacityMinutes(720)).toBe(720);
    expect(normalizeLeaderBoardGanttCapacityMinutes(600)).toBe(600);
  });
});
