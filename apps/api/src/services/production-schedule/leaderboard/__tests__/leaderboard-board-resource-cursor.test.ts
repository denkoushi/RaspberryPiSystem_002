import { describe, expect, it } from 'vitest';

import { resolveFiniteLeaderboardBoardNextCursor } from '../leaderboard-board-resource-cursor.js';

describe('resolveFiniteLeaderboardBoardNextCursor', () => {
  it('prefers first finite number and truncates toward zero', () => {
    expect(resolveFiniteLeaderboardBoardNextCursor(12.9, [])).toBe(12);
    expect(resolveFiniteLeaderboardBoardNextCursor(-3, [])).toBe(0);
  });

  it('falls back through the list when preferred is not finite', () => {
    expect(resolveFiniteLeaderboardBoardNextCursor(undefined, [8, 2])).toBe(8);
    expect(resolveFiniteLeaderboardBoardNextCursor(NaN, [undefined, 5])).toBe(5);
    expect(resolveFiniteLeaderboardBoardNextCursor(Infinity, [Number.NaN, 3])).toBe(3);
  });

  it('returns 0 when nothing is finite', () => {
    expect(resolveFiniteLeaderboardBoardNextCursor(undefined, [undefined, NaN])).toBe(0);
    expect(resolveFiniteLeaderboardBoardNextCursor('x' as unknown as number, [])).toBe(0);
  });
});
