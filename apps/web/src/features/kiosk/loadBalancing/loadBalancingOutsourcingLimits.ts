/**
 * 外注・部品推奨セットの上限（API `outsourcing-simulation.policy.ts` と同期）。
 */
export const LOAD_BALANCING_OUTSOURCING_LIMITS = {
  MAX_PART_CANDIDATE_POOL: 500,
  MAX_CANDIDATES_LIST_REQUEST: 200,
  DEFAULT_CANDIDATES_LIST: 100,
  MAX_SELECTED_CANDIDATE_IDS: 500
} as const;
