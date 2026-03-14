import type { DueManagementScoringParameters, DueManagementTuningEvaluation } from './tuning-types.js';

const MAX_THRESHOLD_DELTA = 3;

export class TuningGuardService {
  constructor(private readonly maxWeightDelta: number) {}

  isSpecialDay(params: {
    date: Date;
    excludedDateSet: Set<string>;
    excludeWeekends: boolean;
  }): boolean {
    const dateKey = params.date.toISOString().slice(0, 10);
    if (params.excludedDateSet.has(dateKey)) {
      return true;
    }
    if (!params.excludeWeekends) {
      return false;
    }
    const day = params.date.getUTCDay();
    return day === 0 || day === 6;
  }

  canApplyCandidate(params: {
    base: DueManagementScoringParameters;
    candidate: DueManagementScoringParameters;
    evaluation: DueManagementTuningEvaluation;
    improvementStreak: number;
    requiredStreak: number;
  }): { allowed: boolean; reason: string | null } {
    if (!params.evaluation.improved) {
      return { allowed: false, reason: 'evaluation_not_improved' };
    }
    if (params.improvementStreak < params.requiredStreak) {
      return {
        allowed: false,
        reason: `improvement_streak_insufficient(${params.improvementStreak} < ${params.requiredStreak})`,
      };
    }

    const keys: Array<keyof DueManagementScoringParameters['weights']> = [
      'resourceDemand',
      'dueUrgency',
      'historyCalibration',
      'carryover',
      'partPriority',
      'actualHours',
    ];
    for (const key of keys) {
      const diff = Math.abs(params.base.weights[key] - params.candidate.weights[key]);
      if (diff > this.maxWeightDelta) {
        return {
          allowed: false,
          reason: `weight_delta_exceeded(${key}:${diff.toFixed(6)} > ${this.maxWeightDelta.toFixed(6)})`,
        };
      }
    }

    const thresholdDiff = Math.abs(
      params.base.thresholds.dueUrgencySoonDays - params.candidate.thresholds.dueUrgencySoonDays
    );
    if (thresholdDiff > MAX_THRESHOLD_DELTA) {
      return {
        allowed: false,
        reason: `threshold_delta_exceeded(${thresholdDiff} > ${MAX_THRESHOLD_DELTA})`,
      };
    }

    return { allowed: true, reason: null };
  }
}
