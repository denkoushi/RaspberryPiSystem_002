import type { DueManagementScoringParameters } from './tuning-types.js';

export const DEFAULT_DUE_MANAGEMENT_SCORING_PARAMETERS: DueManagementScoringParameters = {
  weights: {
    resourceDemand: 0.35,
    dueUrgency: 0.18,
    historyCalibration: 0.12,
    carryover: 0.08,
    partPriority: 0.07,
    actualHours: 0.2,
  },
  thresholds: {
    dueUrgencyOverdueDays: 0,
    dueUrgencyUrgentDays: 1,
    dueUrgencyNearDays: 3,
    dueUrgencySoonDays: 7,
  },
};

const MIN_WEIGHT = 0.01;

const normalizeWeights = (weights: DueManagementScoringParameters['weights']): DueManagementScoringParameters['weights'] => {
  const values = Object.values(weights);
  const total = values.reduce((sum, value) => sum + Math.max(MIN_WEIGHT, value), 0);
  if (total <= 0) {
    return { ...DEFAULT_DUE_MANAGEMENT_SCORING_PARAMETERS.weights };
  }
  return {
    resourceDemand: Number((Math.max(MIN_WEIGHT, weights.resourceDemand) / total).toFixed(6)),
    dueUrgency: Number((Math.max(MIN_WEIGHT, weights.dueUrgency) / total).toFixed(6)),
    historyCalibration: Number((Math.max(MIN_WEIGHT, weights.historyCalibration) / total).toFixed(6)),
    carryover: Number((Math.max(MIN_WEIGHT, weights.carryover) / total).toFixed(6)),
    partPriority: Number((Math.max(MIN_WEIGHT, weights.partPriority) / total).toFixed(6)),
    actualHours: Number((Math.max(MIN_WEIGHT, weights.actualHours) / total).toFixed(6)),
  };
};

const normalizeThresholds = (
  thresholds: DueManagementScoringParameters['thresholds']
): DueManagementScoringParameters['thresholds'] => {
  const overdue = Math.max(-30, Math.min(30, Math.trunc(thresholds.dueUrgencyOverdueDays)));
  const urgent = Math.max(overdue, Math.min(60, Math.trunc(thresholds.dueUrgencyUrgentDays)));
  const near = Math.max(urgent, Math.min(90, Math.trunc(thresholds.dueUrgencyNearDays)));
  const soon = Math.max(near, Math.min(180, Math.trunc(thresholds.dueUrgencySoonDays)));
  return {
    dueUrgencyOverdueDays: overdue,
    dueUrgencyUrgentDays: urgent,
    dueUrgencyNearDays: near,
    dueUrgencySoonDays: soon,
  };
};

export const sanitizeDueManagementScoringParameters = (
  value: Partial<DueManagementScoringParameters> | null | undefined
): DueManagementScoringParameters => {
  if (!value) {
    return { ...DEFAULT_DUE_MANAGEMENT_SCORING_PARAMETERS };
  }
  return {
    weights: normalizeWeights({
      ...DEFAULT_DUE_MANAGEMENT_SCORING_PARAMETERS.weights,
      ...(value.weights ?? {}),
    }),
    thresholds: normalizeThresholds({
      ...DEFAULT_DUE_MANAGEMENT_SCORING_PARAMETERS.thresholds,
      ...(value.thresholds ?? {}),
    }),
  };
};
