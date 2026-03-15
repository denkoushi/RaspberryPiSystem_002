import cron, { validate } from 'node-cron';
import { logger } from '../../../lib/logger.js';
import { env } from '../../../config/env.js';
import { evaluateDueManagementLearningReport } from '../due-management-learning-evaluator.service.js';
import { TuningCandidateGenerator } from './tuning-candidate-generator.service.js';
import { TuningEvaluator } from './tuning-evaluator.service.js';
import { TuningGuardService } from './tuning-guard.service.js';
import { TuningRollbackService } from './tuning-rollback.service.js';
import { TuningParamsRepository } from '../repositories/tuning-params.repository.js';
import { TuningHistoryRepository } from '../repositories/tuning-history.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const parseLocations = (value: string): string[] =>
  Array.from(
    new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  );

const averageBottleneckStagnation = (report: {
  summary: { avgTopKPrecision: number; avgSpearmanRho: number };
}): number => {
  const topKPenalty = 1 - report.summary.avgTopKPrecision;
  const spearmanPenalty = 1 - Math.max(0, report.summary.avgSpearmanRho);
  return Number(((topKPenalty * 0.7) + (spearmanPenalty * 0.3)).toFixed(6));
};

export class DueManagementTuningOrchestrator {
  private task: cron.ScheduledTask | null = null;
  private readonly candidateGenerator = new TuningCandidateGenerator();
  private readonly evaluator = new TuningEvaluator();
  private readonly paramsRepository = new TuningParamsRepository();
  private readonly historyRepository = new TuningHistoryRepository();
  private readonly guard = new TuningGuardService(env.DUE_MGMT_TUNING_MAX_WEIGHT_DELTA);
  private readonly rollback = new TuningRollbackService(this.paramsRepository, this.historyRepository);
  private readonly excludedDateSet = new Set(
    env.DUE_MGMT_TUNING_EXCLUDED_DATES
      ?.split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0) ?? []
  );

  async start(): Promise<void> {
    if (!env.DUE_MGMT_TUNING_ENABLED) {
      logger.info('[DueManagementAutoTuning] Scheduler disabled by environment');
      return;
    }
    if (this.task) {
      logger.warn('[DueManagementAutoTuning] Scheduler already running');
      return;
    }
    if (!validate(env.DUE_MGMT_TUNING_CRON)) {
      logger.warn(
        { cron: env.DUE_MGMT_TUNING_CRON },
        '[DueManagementAutoTuning] Invalid cron expression; scheduler not started'
      );
      return;
    }
    this.task = cron.schedule(env.DUE_MGMT_TUNING_CRON, () => {
      void this.runDaily();
    });
    logger.info({ cron: env.DUE_MGMT_TUNING_CRON }, '[DueManagementAutoTuning] Scheduler started');
  }

  stop(): void {
    if (!this.task) return;
    this.task.stop();
    this.task = null;
    logger.info('[DueManagementAutoTuning] Scheduler stopped');
  }

  async runDaily(): Promise<void> {
    const now = new Date();
    if (this.guard.isSpecialDay({
      date: now,
      excludedDateSet: this.excludedDateSet,
      excludeWeekends: env.DUE_MGMT_TUNING_EXCLUDE_WEEKENDS,
    })) {
      logger.info('[DueManagementAutoTuning] Skip run on special day');
      return;
    }
    const locations = parseLocations(env.DUE_MGMT_TUNING_LOCATIONS);
    for (const locationKey of locations) {
      await this.runForLocation(locationKey);
    }
  }

  async runForLocation(locationKey: string): Promise<void> {
    try {
      const now = new Date();
      const currentFrom = new Date(now.getTime() - 7 * DAY_MS).toISOString();
      const prevFrom = new Date(now.getTime() - 14 * DAY_MS).toISOString();
      const prevTo = new Date(now.getTime() - 7 * DAY_MS).toISOString();
      const [currentReport, previousReport] = await Promise.all([
        evaluateDueManagementLearningReport({
          locationScope: { deviceScopeKey: locationKey },
          from: currentFrom,
          to: now.toISOString(),
        }),
        evaluateDueManagementLearningReport({
          locationScope: { deviceScopeKey: locationKey },
          from: prevFrom,
          to: prevTo,
        }),
      ]);

      const currentMetrics = {
        overdueSeibanCount: currentReport.summary.overdueSeibanCount,
        overdueTotalDays: currentReport.summary.overdueTotalDays,
        bottleneckStagnationScore: averageBottleneckStagnation(currentReport),
      };
      const previousMetrics = {
        overdueSeibanCount: previousReport.summary.overdueSeibanCount,
        overdueTotalDays: previousReport.summary.overdueTotalDays,
        bottleneckStagnationScore: averageBottleneckStagnation(previousReport),
      };

      if (
        currentMetrics.overdueTotalDays > previousMetrics.overdueTotalDays &&
        currentMetrics.overdueSeibanCount >= previousMetrics.overdueSeibanCount
      ) {
        await this.rollback.rollbackToPreviousStable({
          locationKey,
          reason: 'regression_detected_before_candidate_apply',
        });
      }

      const base = await this.paramsRepository.getCurrentParams(locationKey);
      const candidates = this.candidateGenerator.generate({
        base,
        recentMetrics: currentMetrics,
        previousMetrics,
      });
      const evaluation = this.evaluator.evaluate({
        baseline: previousMetrics,
        current: currentMetrics,
      });
      const improvementStreak = await this.historyRepository.getConsecutiveImprovementCount(locationKey);
      const selected = evaluation.improved && candidates.length > 1 ? candidates[1] : (candidates[0] ?? { label: 'base', params: base });
      const guard = this.guard.canApplyCandidate({
        base,
        candidate: selected.params,
        evaluation,
        improvementStreak,
        requiredStreak: env.DUE_MGMT_TUNING_IMPROVEMENT_STREAK_REQUIRED,
      });
      await this.historyRepository.appendHistory({
        locationKey,
        status: guard.allowed ? 'applied' : 'rejected',
        label: selected.label,
        candidateParams: selected.params,
        baseParams: base,
        evaluation,
        guardReason: guard.reason,
      });

      if (!guard.allowed || selected.label === 'base') {
        logger.info(
          { locationKey, reason: guard.reason, improved: evaluation.improved },
          '[DueManagementAutoTuning] Candidate rejected'
        );
        return;
      }

      await this.paramsRepository.setStableParams({
        locationKey,
        nextParams: selected.params,
      });
      logger.info(
        { locationKey, label: selected.label, score: evaluation.score },
        '[DueManagementAutoTuning] Candidate applied'
      );
    } catch (error) {
      logger.error({ err: error, locationKey }, '[DueManagementAutoTuning] Run failed');
      await this.historyRepository.appendFailure({
        locationKey,
        reason: error instanceof Error ? error.message : String(error),
        candidateParams: null,
        previousStableParams: null,
        metrics: null,
      });
    }
  }
}

let orchestratorInstance: DueManagementTuningOrchestrator | null = null;

export const getDueManagementTuningOrchestrator = (): DueManagementTuningOrchestrator => {
  if (!orchestratorInstance) {
    orchestratorInstance = new DueManagementTuningOrchestrator();
  }
  return orchestratorInstance;
};
