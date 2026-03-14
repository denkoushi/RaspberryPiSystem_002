import { describe, expect, it } from 'vitest';
import { TuningGuardService } from '../tuning-guard.service.js';

const base = {
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

describe('TuningGuardService', () => {
  it('改善連続回数が足りない場合は却下する', () => {
    const guard = new TuningGuardService(0.08);
    const result = guard.canApplyCandidate({
      base,
      candidate: base,
      evaluation: {
        improved: true,
        score: 1,
        reason: 'ok',
        baseline: { overdueSeibanCount: 3, overdueTotalDays: 6, bottleneckStagnationScore: 0.4 },
        current: { overdueSeibanCount: 2, overdueTotalDays: 4, bottleneckStagnationScore: 0.3 },
      },
      improvementStreak: 1,
      requiredStreak: 2,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('improvement_streak_insufficient');
  });

  it('特殊日判定で除外日をtrueにする', () => {
    const guard = new TuningGuardService(0.08);
    const result = guard.isSpecialDay({
      date: new Date('2026-03-21T00:00:00.000Z'),
      excludedDateSet: new Set(['2026-03-21']),
      excludeWeekends: false,
    });
    expect(result).toBe(true);
  });
});
