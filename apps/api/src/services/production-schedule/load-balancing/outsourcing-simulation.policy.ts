/**
 * 外注・部品推奨セット API / エンジン共通の上限（単一正本）。
 * ルート Zod・サービス・エンジン・Web はこの値を参照する。
 */
export const LOAD_BALANCING_OUTSOURCING_LIMITS = {
  /** 部品候補プール（plan / simulate 内部構築） */
  MAX_PART_CANDIDATE_POOL: 500,
  /** POST outsourcing-candidates の maxCandidates 上限 */
  MAX_CANDIDATES_LIST_REQUEST: 200,
  /** 一覧 API の既定件数 */
  DEFAULT_CANDIDATES_LIST: 100,
  /** POST outsourcing-simulate / replacements の selectedCandidateIds 上限 */
  MAX_SELECTED_CANDIDATE_IDS: 500,
  /** 工程行ベース候補（legacy） */
  MAX_ROW_CANDIDATES_LIST: 200,
  /** overResourceCds 配列上限 */
  MAX_OVER_RESOURCE_CDS: 100
} as const;

export type LoadBalancingOutsourcingLimits = typeof LOAD_BALANCING_OUTSOURCING_LIMITS;
