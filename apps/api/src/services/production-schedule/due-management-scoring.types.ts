export type GlobalRankScoreInput = {
  fseiban: string;
  daysUntilDue: number | null;
  isInTodayTriage: boolean;
  isCarryover: boolean;
  processCount: number;
  partsCount: number;
  totalRequiredMinutes: number;
  resourceSignal: {
    unfinishedProcessCount: number;
    resourceTypeCount: number;
    concentrationRatio: number;
    bottleneckLoadRatio: number;
    crowdedLoadRatio: number;
  };
  historySignal: {
    delayRiskScore: number;
    estimationGapScore: number;
    throughputPenaltyScore: number;
  };
  partPrioritySignal: {
    hasPriorityDefinition: boolean;
    topPriorityCoverage: number;
    topPriorityRequiredMinutes: number;
  };
};

export type GlobalRankScoreBreakdown = {
  resourceDemandScore: number;
  dueUrgencyScore: number;
  carryoverScore: number;
  partPriorityScore: number;
  historyCalibrationScore: number;
  tieBreaker: {
    isCarryover: boolean;
    dueDateRankKey: number;
    existingRankOrder: number;
  };
  weightedTotalScore: number;
  reasons: string[];
};

export type GlobalRankProposalItem = {
  fseiban: string;
  rank: number;
  score: number;
  breakdown: GlobalRankScoreBreakdown;
};

export type GlobalRankProposal = {
  generatedAt: string;
  locationKey: string;
  candidateCount: number;
  orderedFseibans: string[];
  items: GlobalRankProposalItem[];
};

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
