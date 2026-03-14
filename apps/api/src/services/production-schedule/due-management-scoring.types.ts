import type {
  RankingProposal,
  RankingProposalItem,
  ScoreComponentContext,
  GlobalRankScoreBreakdown
} from './due-management/domain/contracts.js';
import type { DueManagementScoringParameters } from './auto-tuning/tuning-types.js';

export type GlobalRankScoreInput = ScoreComponentContext;
export type GlobalRankProposalItem = RankingProposalItem;
export type GlobalRankProposal = RankingProposal;
export type { GlobalRankScoreBreakdown };
export type { DueManagementScoringParameters };

export type GlobalRankWritePolicy = {
  minCandidateCount: number;
  maxReorderDeltaRatio: number;
  keepExistingTail: boolean;
};

export type GlobalRankAutoGenerateResult = {
  success: boolean;
  applied: boolean;
  orderedFseibans: string[];
  previousOrderedFseibans: string[];
  sourceType: 'auto';
  guard: {
    rejected: boolean;
    reason: string | null;
    reorderDeltaRatio: number;
  };
  proposal: GlobalRankProposal;
};
