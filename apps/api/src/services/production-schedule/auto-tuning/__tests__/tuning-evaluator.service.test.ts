import { describe, expect, it } from 'vitest';
import { TuningEvaluator } from '../tuning-evaluator.service.js';

describe('TuningEvaluator', () => {
  it('overdue指標が改善したとき improved=true を返す', () => {
    const evaluator = new TuningEvaluator();
    const result = evaluator.evaluate({
      baseline: {
        overdueSeibanCount: 5,
        overdueTotalDays: 20,
        bottleneckStagnationScore: 0.5,
      },
      current: {
        overdueSeibanCount: 4,
        overdueTotalDays: 12,
        bottleneckStagnationScore: 0.4,
      },
    });

    expect(result.improved).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('overdueが悪化したとき improved=false を返す', () => {
    const evaluator = new TuningEvaluator();
    const result = evaluator.evaluate({
      baseline: {
        overdueSeibanCount: 2,
        overdueTotalDays: 4,
        bottleneckStagnationScore: 0.2,
      },
      current: {
        overdueSeibanCount: 3,
        overdueTotalDays: 6,
        bottleneckStagnationScore: 0.1,
      },
    });

    expect(result.improved).toBe(false);
    expect(result.reason).toBe('overdue_metrics_not_improved');
  });
});
