import type { DueManagementTuningEvaluation, DueManagementTuningMetrics } from './tuning-types.js';

const round = (value: number): number => Number(value.toFixed(6));

export class TuningEvaluator {
  evaluate(params: {
    baseline: DueManagementTuningMetrics;
    current: DueManagementTuningMetrics;
  }): DueManagementTuningEvaluation {
    const overdueDaysDiff = params.baseline.overdueTotalDays - params.current.overdueTotalDays;
    const overdueCountDiff = params.baseline.overdueSeibanCount - params.current.overdueSeibanCount;
    const bottleneckDiff = params.baseline.bottleneckStagnationScore - params.current.bottleneckStagnationScore;

    const score = overdueDaysDiff * 2 + overdueCountDiff * 8 + bottleneckDiff * 3;
    const improved = overdueDaysDiff >= 0 && overdueCountDiff >= 0 && score > 0;
    const reason = improved
      ? 'overdue_metrics_improved'
      : 'overdue_metrics_not_improved';

    return {
      improved,
      score: round(score),
      reason,
      baseline: params.baseline,
      current: params.current,
    };
  }
}
