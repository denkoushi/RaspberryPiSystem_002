export type DueManagementScoringWeights = {
  resourceDemand: number;
  dueUrgency: number;
  historyCalibration: number;
  carryover: number;
  partPriority: number;
  actualHours: number;
};

export type DueManagementScoringThresholds = {
  dueUrgencyOverdueDays: number;
  dueUrgencyUrgentDays: number;
  dueUrgencyNearDays: number;
  dueUrgencySoonDays: number;
};

export type DueManagementScoringParameters = {
  weights: DueManagementScoringWeights;
  thresholds: DueManagementScoringThresholds;
};

export type DueManagementTuningMetrics = {
  overdueSeibanCount: number;
  overdueTotalDays: number;
  bottleneckStagnationScore: number;
};

export type DueManagementTuningEvaluation = {
  improved: boolean;
  score: number;
  reason: string;
  baseline: DueManagementTuningMetrics;
  current: DueManagementTuningMetrics;
};
