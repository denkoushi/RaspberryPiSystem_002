export type ScoreComponentContext = {
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

export type GlobalRankTieBreaker = {
  isCarryover: boolean;
  dueDateRankKey: number;
  existingRankOrder: number;
};

export type ScoreComponentResult = {
  id: string;
  score: number;
};

export interface ScoreComponent {
  readonly id: string;
  evaluate(context: ScoreComponentContext): ScoreComponentResult;
}

export type GlobalRankScoreBreakdown = {
  resourceDemandScore: number;
  dueUrgencyScore: number;
  carryoverScore: number;
  partPriorityScore: number;
  historyCalibrationScore: number;
  actualHoursScore: number;
  tieBreaker: GlobalRankTieBreaker;
  weightedTotalScore: number;
  reasons: string[];
};

export type RankingProposalItem = {
  fseiban: string;
  rank: number;
  score: number;
  estimatedActualMinutes: number;
  coverageRatio: number;
  breakdown: GlobalRankScoreBreakdown;
};

export type RankingProposal = {
  generatedAt: string;
  locationKey: string;
  candidateCount: number;
  orderedFseibans: string[];
  items: RankingProposalItem[];
};

export type OperatorDecisionInput = {
  locationKey: string;
  sourceType: 'auto' | 'manual';
  reasonCode?: string | null;
  orderedFseibans: string[];
  previousOrderedFseibans: string[];
  proposalOrderedFseibans: string[];
  reorderDeltaRatio: number | null;
  metadata?: Record<string, unknown>;
};

export type OutcomeMetricInput = {
  locationKey: string;
  eventType: 'progress_sync' | 'manual_complete_toggle' | 'manual_order_update';
  csvDashboardRowId: string;
  fseiban: string | null;
  isCompleted: boolean;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
};

export type DueManagementLearningReport = {
  locationKey: string;
  range: {
    from: string;
    to: string;
  };
  summary: {
    proposalCount: number;
    decisionCount: number;
    outcomeCount: number;
    overdueSeibanCount: number;
    overdueTotalDays: number;
    avgTopKPrecision: number;
    avgSpearmanRho: number;
    avgKendallTau: number;
  };
  recommendation: {
    primaryObjective: 'minimize_due_delay';
    note: string;
  };
};

export interface RankingProposalRepository {
  saveProposalEvent(params: {
    locationKey: string;
    proposal: RankingProposal;
    selectedFseibans: string[];
    writePolicy: Record<string, unknown> | null;
    actorClientKey: string | null;
  }): Promise<void>;
}

export interface DecisionEventRepository {
  saveDecisionEvent(input: OperatorDecisionInput): Promise<void>;
}

export interface OutcomeMetricsRepository {
  saveOutcomeEvent(input: OutcomeMetricInput): Promise<void>;
}
