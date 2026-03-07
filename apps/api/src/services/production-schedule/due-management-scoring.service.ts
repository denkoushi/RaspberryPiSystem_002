import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { analyzeCompletionHistorySignals } from './completion-history-analyzer.service.js';
import { listDueManagementGlobalRank } from './due-management-global-rank.service.js';
import { listDueManagementSummaries } from './due-management-query.service.js';
import type {
  GlobalRankProposal,
  GlobalRankProposalItem,
  GlobalRankScoreBreakdown,
  GlobalRankScoreInput
} from './due-management-scoring.types.js';
import { estimateResourceLoadSignals } from './resource-load-estimator.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeFseibans = (items: string[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next.slice(0, 2000);
};

const toUtcDayStart = (value: Date): number => Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());

const computeDaysUntilDue = (dueDate: Date | null): number | null => {
  if (!dueDate) return null;
  const now = new Date();
  return Math.floor((toUtcDayStart(dueDate) - toUtcDayStart(now)) / DAY_MS);
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const resourceDemandScore = (input: GlobalRankScoreInput): number => {
  const processScore = clamp(input.resourceSignal.unfinishedProcessCount / 40, 0, 1);
  const diversityScore = clamp(input.resourceSignal.resourceTypeCount / 8, 0, 1);
  const concentrationScore = clamp(input.resourceSignal.concentrationRatio, 0, 1);
  const bottleneckScore = clamp(input.resourceSignal.bottleneckLoadRatio, 0, 1);
  const crowdedScore = clamp(input.resourceSignal.crowdedLoadRatio, 0, 1);
  return processScore * 0.35 + diversityScore * 0.1 + concentrationScore * 0.2 + bottleneckScore * 0.2 + crowdedScore * 0.15;
};

const dueUrgencyScore = (daysUntilDue: number | null): number => {
  if (daysUntilDue === null) return 0.35;
  if (daysUntilDue <= 0) return 1;
  if (daysUntilDue <= 1) return 0.9;
  if (daysUntilDue <= 3) return 0.75;
  if (daysUntilDue <= 7) return 0.5;
  return 0.2;
};

const carryoverScore = (input: GlobalRankScoreInput): number => {
  if (input.isCarryover) return 1;
  if (input.isInTodayTriage) return 0.7;
  return 0.25;
};

const partPriorityScore = (input: GlobalRankScoreInput): number => {
  if (!input.partPrioritySignal.hasPriorityDefinition) return 0.2;
  const coverage = clamp(input.partPrioritySignal.topPriorityCoverage, 0, 1);
  const volume = clamp(input.partPrioritySignal.topPriorityRequiredMinutes / Math.max(1, input.totalRequiredMinutes), 0, 1);
  return coverage * 0.55 + volume * 0.45;
};

const historyCalibrationScore = (input: GlobalRankScoreInput): number => {
  const delay = clamp(input.historySignal.delayRiskScore, 0, 1);
  const gap = clamp(input.historySignal.estimationGapScore / 2, 0, 1);
  const throughput = clamp(input.historySignal.throughputPenaltyScore, 0, 1);
  return delay * 0.5 + gap * 0.3 + throughput * 0.2;
};

const buildReasons = (breakdown: Omit<GlobalRankScoreBreakdown, 'reasons'>): string[] => {
  const reasons: string[] = [];
  if (breakdown.resourceDemandScore >= 0.7) reasons.push('資源所要量と混雑影響が高いため上位評価');
  if (breakdown.dueUrgencyScore >= 0.75) reasons.push('納期切迫度が高い');
  if (breakdown.carryoverScore >= 0.9) reasons.push('前日からの引継ぎ案件');
  if (breakdown.partPriorityScore >= 0.6) reasons.push('製番内の上位部品が重い');
  if (breakdown.historyCalibrationScore >= 0.6) reasons.push('完了実績から遅延リスクが高い');
  if (reasons.length === 0) reasons.push('総合スコアのバランス評価');
  return reasons;
};

export async function buildDueManagementGlobalRankProposal(params: {
  locationKey: string;
}): Promise<GlobalRankProposal> {
  const summaries = await listDueManagementSummaries(params.locationKey);
  const selectedRows = await prisma.productionScheduleTriageSelection.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: params.locationKey
    },
    orderBy: [{ createdAt: 'asc' }, { fseiban: 'asc' }],
    select: { fseiban: true }
  });
  const selectedSet = new Set(selectedRows.map((row) => row.fseiban));
  const existingRank = await listDueManagementGlobalRank(params.locationKey);
  const existingOrder = new Map(existingRank.map((fseiban, index) => [fseiban, index]));
  const candidateFseibans = normalizeFseibans(
    selectedRows.length > 0
      ? [...selectedRows.map((row) => row.fseiban), ...existingRank]
      : [...summaries.map((row) => row.fseiban), ...existingRank]
  );

  const resourceSignals = await estimateResourceLoadSignals({
    locationKey: params.locationKey,
    candidateFseibans
  });
  const historySignals = await analyzeCompletionHistorySignals({ candidateFseibans });
  const partPriorityRows = await prisma.productionSchedulePartPriority.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: params.locationKey,
      fseiban: { in: candidateFseibans }
    },
    select: {
      fseiban: true,
      priorityRank: true
    }
  });
  const partPriorityMap = new Map<string, number[]>();
  for (const row of partPriorityRows) {
    const list = partPriorityMap.get(row.fseiban) ?? [];
    list.push(row.priorityRank);
    partPriorityMap.set(row.fseiban, list);
  }
  const summaryMap = new Map(summaries.map((item) => [item.fseiban, item] as const));

  const scored: Array<{ fseiban: string; score: number; breakdown: GlobalRankScoreBreakdown }> = [];
  for (const fseiban of candidateFseibans) {
    const summary = summaryMap.get(fseiban);
    const daysUntilDue = computeDaysUntilDue(summary?.dueDate ?? null);
    const priorityRanks = (partPriorityMap.get(fseiban) ?? []).sort((a, b) => a - b);
    const topPriorityCount = priorityRanks.filter((rank) => rank <= 3).length;
    const totalRequiredMinutes = summary?.totalRequiredMinutes ?? 0;
    const scoreInput: GlobalRankScoreInput = {
      fseiban,
      daysUntilDue,
      isInTodayTriage: selectedSet.has(fseiban),
      isCarryover: !selectedSet.has(fseiban),
      processCount: summary?.processCount ?? 0,
      partsCount: summary?.partsCount ?? 0,
      totalRequiredMinutes,
      resourceSignal: resourceSignals.get(fseiban) ?? {
        unfinishedProcessCount: 0,
        resourceTypeCount: 0,
        concentrationRatio: 0,
        bottleneckLoadRatio: 0,
        crowdedLoadRatio: 0
      },
      historySignal: historySignals.get(fseiban) ?? {
        delayRiskScore: 0,
        estimationGapScore: 0,
        throughputPenaltyScore: 0
      },
      partPrioritySignal: {
        hasPriorityDefinition: priorityRanks.length > 0,
        topPriorityCoverage: (summary?.partsCount ?? 0) > 0 ? topPriorityCount / (summary?.partsCount ?? 1) : 0,
        topPriorityRequiredMinutes: totalRequiredMinutes * ((summary?.partsCount ?? 0) > 0 ? topPriorityCount / (summary?.partsCount ?? 1) : 0)
      }
    };

    const breakdownBase = {
      resourceDemandScore: resourceDemandScore(scoreInput),
      dueUrgencyScore: dueUrgencyScore(scoreInput.daysUntilDue),
      carryoverScore: carryoverScore(scoreInput),
      partPriorityScore: partPriorityScore(scoreInput),
      historyCalibrationScore: historyCalibrationScore(scoreInput),
      tieBreaker: {
        isCarryover: scoreInput.isCarryover,
        dueDateRankKey: scoreInput.daysUntilDue ?? Number.MAX_SAFE_INTEGER,
        existingRankOrder: existingOrder.get(fseiban) ?? Number.MAX_SAFE_INTEGER
      },
      weightedTotalScore: 0
    };
    const weightedTotalScore =
      breakdownBase.resourceDemandScore * 0.45 +
      breakdownBase.dueUrgencyScore * 0.2 +
      breakdownBase.historyCalibrationScore * 0.15 +
      breakdownBase.carryoverScore * 0.1 +
      breakdownBase.partPriorityScore * 0.1;
    const breakdown: GlobalRankScoreBreakdown = {
      ...breakdownBase,
      weightedTotalScore,
      reasons: buildReasons({ ...breakdownBase, weightedTotalScore })
    };
    scored.push({
      fseiban,
      score: weightedTotalScore,
      breakdown
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.breakdown.tieBreaker.isCarryover !== b.breakdown.tieBreaker.isCarryover) {
      return a.breakdown.tieBreaker.isCarryover ? -1 : 1;
    }
    if (a.breakdown.tieBreaker.dueDateRankKey !== b.breakdown.tieBreaker.dueDateRankKey) {
      return a.breakdown.tieBreaker.dueDateRankKey - b.breakdown.tieBreaker.dueDateRankKey;
    }
    if (a.breakdown.tieBreaker.existingRankOrder !== b.breakdown.tieBreaker.existingRankOrder) {
      return a.breakdown.tieBreaker.existingRankOrder - b.breakdown.tieBreaker.existingRankOrder;
    }
    return a.fseiban.localeCompare(b.fseiban);
  });

  const orderedFseibans = scored.map((item) => item.fseiban);
  const items: GlobalRankProposalItem[] = scored.map((item, index) => ({
    fseiban: item.fseiban,
    rank: index + 1,
    score: Number(item.score.toFixed(6)),
    breakdown: item.breakdown
  }));

  return {
    generatedAt: new Date().toISOString(),
    locationKey: params.locationKey,
    candidateCount: items.length,
    orderedFseibans,
    items
  };
}
