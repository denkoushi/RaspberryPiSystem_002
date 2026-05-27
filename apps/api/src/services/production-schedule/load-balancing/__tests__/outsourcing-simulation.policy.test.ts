import { describe, expect, it } from 'vitest';

import { LOAD_BALANCING_OUTSOURCING_LIMITS } from '../outsourcing-simulation.policy.js';

describe('LOAD_BALANCING_OUTSOURCING_LIMITS', () => {
  it('plan プール上限は simulate / replacements の selected 上限以上', () => {
    expect(LOAD_BALANCING_OUTSOURCING_LIMITS.MAX_PART_CANDIDATE_POOL).toBeGreaterThanOrEqual(
      LOAD_BALANCING_OUTSOURCING_LIMITS.MAX_SELECTED_CANDIDATE_IDS
    );
  });

  it('candidates 一覧リクエスト上限はプール上限以下', () => {
    expect(LOAD_BALANCING_OUTSOURCING_LIMITS.MAX_CANDIDATES_LIST_REQUEST).toBeLessThanOrEqual(
      LOAD_BALANCING_OUTSOURCING_LIMITS.MAX_PART_CANDIDATE_POOL
    );
  });
});
