import { sanitizeDueManagementScoringParameters } from './tuning-defaults.js';
import type { DueManagementScoringParameters, DueManagementTuningMetrics } from './tuning-types.js';

const shiftWeight = (base: DueManagementScoringParameters, key: keyof DueManagementScoringParameters['weights'], delta: number) =>
  sanitizeDueManagementScoringParameters({
    ...base,
    weights: {
      ...base.weights,
      [key]: base.weights[key] + delta,
    },
  });

const shiftThresholds = (base: DueManagementScoringParameters, delta: number) =>
  sanitizeDueManagementScoringParameters({
    ...base,
    thresholds: {
      ...base.thresholds,
      dueUrgencyUrgentDays: base.thresholds.dueUrgencyUrgentDays + delta,
      dueUrgencyNearDays: base.thresholds.dueUrgencyNearDays + delta,
      dueUrgencySoonDays: base.thresholds.dueUrgencySoonDays + delta,
    },
  });

export type TuningCandidate = {
  label: string;
  params: DueManagementScoringParameters;
};

export class TuningCandidateGenerator {
  generate(params: {
    base: DueManagementScoringParameters;
    recentMetrics: DueManagementTuningMetrics;
    previousMetrics: DueManagementTuningMetrics;
  }): TuningCandidate[] {
    const base = sanitizeDueManagementScoringParameters(params.base);
    const candidates: TuningCandidate[] = [{ label: 'base', params: base }];
    const overdueWorsened = params.recentMetrics.overdueTotalDays > params.previousMetrics.overdueTotalDays;
    const bottleneckWorsened = params.recentMetrics.bottleneckStagnationScore > params.previousMetrics.bottleneckStagnationScore;

    // 納期悪化時は納期寄り、ボトルネック悪化時は資源需要寄りに小さく寄せる。
    const dueDelta = overdueWorsened ? 0.04 : 0.02;
    const resourceDelta = bottleneckWorsened ? 0.04 : 0.02;
    candidates.push({
      label: 'due_urgency_plus',
      params: shiftWeight(base, 'dueUrgency', dueDelta),
    });
    candidates.push({
      label: 'resource_demand_plus',
      params: shiftWeight(base, 'resourceDemand', resourceDelta),
    });
    candidates.push({
      label: 'actual_hours_plus',
      params: shiftWeight(base, 'actualHours', 0.02),
    });
    candidates.push({
      label: 'tighter_due_threshold',
      params: shiftThresholds(base, -1),
    });

    return candidates;
  }
}
