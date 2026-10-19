import { describe, expect, it } from 'vitest';

import { formatPlanningBoardLoadSummary, formatPlanningBoardResourceLoad } from '../planningBoardLoad';

describe('planning board load labels', () => {
  it('idle resource is zero minutes', () => {
    expect(formatPlanningBoardResourceLoad(undefined, 'alternate')).toBe('0分');
  });

  it('keeps known minutes and unknown count separate', () => {
    expect(formatPlanningBoardLoadSummary(null, 2)).toBe('0分 + 不明2件');
  });
});
