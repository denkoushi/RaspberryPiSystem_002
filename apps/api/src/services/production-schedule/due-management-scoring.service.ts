import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { createActualHoursFeatureResolver } from './actual-hours-feature-resolver.service.js';
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
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

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

const buildDueConfiguredSeibanSet = (
  summaries: Array<{
    fseiban: string;
    dueDate: Date | null;
  }>
): Set<string> => {
  const set = new Set<string>();
  for (const summary of summaries) {
    if (summary.dueDate) {
      set.add(summary.fseiban);
    }
  }
  return set;
};

const buildDueScopedCandidates = (params: {
  selectedFseibans: string[];
  existingRank: string[];
  summaries: Array<{ fseiban: string; dueDate: Date | null }>;
}): string[] => {
  const dueConfiguredSet = buildDueConfiguredSeibanSet(params.summaries);
  const baseCandidates = params.selectedFseibans.length > 0
    ? [...params.selectedFseibans, ...params.existingRank]
    : [...params.summaries.map((row) => row.fseiban), ...params.existingRank];
  return normalizeFseibans(baseCandidates.filter((fseiban) => dueConfiguredSet.has(fseiban)));
};

const toJstDayStart = (value: Date): number => {
  const jstDate = new Date(value.getTime() + JST_OFFSET_MS);
  return Date.UTC(jstDate.getUTCFullYear(), jstDate.getUTCMonth(), jstDate.getUTCDate());
};

const computeDaysUntilDue = (dueDate: Date | null): number | null => {
  if (!dueDate) return null;
  const now = new Date();
  return Math.floor((toJstDayStart(dueDate) - toJstDayStart(now)) / DAY_MS);
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

type ActualHoursSignal = {
  actualHoursScore: number;
  estimatedActualMinutes: number;
  coverageRatio: number;
};

const ACTUAL_HOURS_DEFAULT_SCORE = 0.35;

const loadActualHoursSignals = async (params: {
  locationKey: string;
  candidateFseibans: string[];
}): Promise<Map<string, ActualHoursSignal>> => {
  const result = new Map<string, ActualHoursSignal>();
  if (params.candidateFseibans.length === 0) {
    return result;
  }

  const featureDelegate = (prisma as unknown as {
    productionScheduleActualHoursFeature?: {
      findMany: (args: unknown) => Promise<Array<{
        fhincd: string;
        resourceCd: string;
        sampleCount: number;
        medianPerPieceMinutes: number;
        p75PerPieceMinutes: number | null;
      }>>;
    };
  }).productionScheduleActualHoursFeature;
  if (!featureDelegate) {
    return result;
  }

  const featureRows = await featureDelegate.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: params.locationKey,
    },
    select: {
      fhincd: true,
      resourceCd: true,
      sampleCount: true,
      medianPerPieceMinutes: true,
      p75PerPieceMinutes: true,
    },
  });
  if (featureRows.length === 0) {
    return result;
  }
  const sampleCountMap = new Map(
    featureRows.map(
      (row) => [`${row.fhincd.trim().toUpperCase()}__${row.resourceCd.trim().toUpperCase()}`, row.sampleCount] as const
    )
  );
  const mappingRows = await prisma.productionScheduleResourceCodeMapping.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: params.locationKey,
      enabled: true,
    },
    orderBy: [{ fromResourceCd: 'asc' }, { priority: 'asc' }, { toResourceCd: 'asc' }],
    select: {
      fromResourceCd: true,
      toResourceCd: true,
      priority: true,
      enabled: true,
    },
  });
  const resolver = createActualHoursFeatureResolver({
    features: featureRows,
    resourceCodeMappings: mappingRows,
  });

  const candidateList = Prisma.join(params.candidateFseibans.map((fseiban) => Prisma.sql`${fseiban}`));
  const rowSignals = await prisma.$queryRaw<Array<{
    fseiban: string;
    fhincd: string | null;
    resourceCd: string | null;
  }>>(Prisma.sql`
    SELECT
      "rowData"->>'FSEIBAN' AS "fseiban",
      "rowData"->>'FHINCD' AS "fhincd",
      "rowData"->>'FSIGENCD' AS "resourceCd"
    FROM "CsvDashboardRow"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND "rowData"->>'FSEIBAN' IN (${candidateList})
      AND COALESCE("rowData"->>'FPROGRESS', '') <> '完了'
  `);

  const aggregateMap = new Map<string, { totalRows: number; matchedRows: number; sampleCountSum: number }>();
  for (const row of rowSignals) {
    const fseiban = row.fseiban?.trim();
    if (!fseiban) {
      continue;
    }
    const current = aggregateMap.get(fseiban) ?? {
      totalRows: 0,
      matchedRows: 0,
      sampleCountSum: 0,
    };
    current.totalRows += 1;

    const fhincd = row.fhincd?.trim() ?? '';
    const resourceCd = row.resourceCd?.trim() ?? '';
    if (fhincd && resourceCd) {
      const resolved = resolver.resolve({ fhincd, resourceCd });
      if (resolved.perPieceMinutes !== null && resolved.matchedResourceCd) {
        current.matchedRows += 1;
        const sampleCount =
          sampleCountMap.get(`${fhincd.trim().toUpperCase()}__${resolved.matchedResourceCd}`) ?? 0;
        current.sampleCountSum += sampleCount;
      }
    }
    aggregateMap.set(fseiban, current);
  }

  for (const fseiban of params.candidateFseibans) {
    const aggregated = aggregateMap.get(fseiban);
    if (!aggregated || aggregated.totalRows <= 0 || aggregated.matchedRows <= 0) {
      result.set(fseiban, {
        actualHoursScore: ACTUAL_HOURS_DEFAULT_SCORE,
        estimatedActualMinutes: 0,
        coverageRatio: 0,
      });
      continue;
    }
    const coverageRatio = clamp(aggregated.matchedRows / aggregated.totalRows, 0, 1);
    const sampleConfidence = clamp((aggregated.sampleCountSum / aggregated.matchedRows) / 20, 0, 1);
    result.set(fseiban, {
      actualHoursScore: coverageRatio * 0.6 + sampleConfidence * 0.4,
      estimatedActualMinutes: 0,
      coverageRatio,
    });
  }

  return result;
};

const buildReasons = (breakdown: Omit<GlobalRankScoreBreakdown, 'reasons'>): string[] => {
  const reasons: string[] = [];
  if (breakdown.resourceDemandScore >= 0.7) reasons.push('資源所要量と混雑影響が高いため上位評価');
  if (breakdown.dueUrgencyScore >= 0.75) reasons.push('納期切迫度が高い');
  if (breakdown.carryoverScore >= 0.9) reasons.push('前日からの引継ぎ案件');
  if (breakdown.partPriorityScore >= 0.6) reasons.push('製番内の上位部品が重い');
  if (breakdown.historyCalibrationScore >= 0.6) reasons.push('完了実績から遅延リスクが高い');
  if (breakdown.actualHoursScore >= 0.65) reasons.push('実績工数特徴量から負荷が高い');
  if (reasons.length === 0) reasons.push('総合スコアのバランス評価');
  return reasons;
};

export async function buildDueManagementGlobalRankProposal(params: {
  locationKey: string;
  existingRankLocationKey?: string;
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
  const existingRank = await listDueManagementGlobalRank({
    locationKey: params.existingRankLocationKey ?? params.locationKey,
    targetLocation: params.locationKey,
    scope: params.existingRankLocationKey ? 'globalShared' : 'locationScoped'
  });
  const existingOrder = new Map(existingRank.map((fseiban, index) => [fseiban, index]));
  const candidateFseibans = buildDueScopedCandidates({
    selectedFseibans: selectedRows.map((row) => row.fseiban),
    existingRank,
    summaries
  });

  const resourceSignals = await estimateResourceLoadSignals({
    locationKey: params.locationKey,
    candidateFseibans
  });
  const historySignals = await analyzeCompletionHistorySignals({ candidateFseibans });
  const actualHoursSignals = await loadActualHoursSignals({
    locationKey: params.locationKey,
    candidateFseibans,
  });
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

  const scored: Array<{
    fseiban: string;
    score: number;
    breakdown: GlobalRankScoreBreakdown;
    estimatedActualMinutes: number;
    coverageRatio: number;
  }> = [];
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
    const actualHoursSignal = actualHoursSignals.get(fseiban) ?? {
      actualHoursScore: ACTUAL_HOURS_DEFAULT_SCORE,
      estimatedActualMinutes: 0,
      coverageRatio: 0,
    };

    const breakdownBase = {
      resourceDemandScore: resourceDemandScore(scoreInput),
      dueUrgencyScore: dueUrgencyScore(scoreInput.daysUntilDue),
      carryoverScore: carryoverScore(scoreInput),
      partPriorityScore: partPriorityScore(scoreInput),
      historyCalibrationScore: historyCalibrationScore(scoreInput),
      actualHoursScore: actualHoursSignal.actualHoursScore,
      tieBreaker: {
        isCarryover: scoreInput.isCarryover,
        dueDateRankKey: scoreInput.daysUntilDue ?? Number.MAX_SAFE_INTEGER,
        existingRankOrder: existingOrder.get(fseiban) ?? Number.MAX_SAFE_INTEGER
      },
      weightedTotalScore: 0
    };
    const weightedTotalScore =
      breakdownBase.resourceDemandScore * 0.35 +
      breakdownBase.dueUrgencyScore * 0.18 +
      breakdownBase.historyCalibrationScore * 0.12 +
      breakdownBase.carryoverScore * 0.08 +
      breakdownBase.partPriorityScore * 0.07 +
      breakdownBase.actualHoursScore * 0.2;
    const breakdown: GlobalRankScoreBreakdown = {
      ...breakdownBase,
      weightedTotalScore,
      reasons: buildReasons({ ...breakdownBase, weightedTotalScore })
    };
    scored.push({
      fseiban,
      score: weightedTotalScore,
      breakdown,
      estimatedActualMinutes: actualHoursSignal.estimatedActualMinutes,
      coverageRatio: actualHoursSignal.coverageRatio
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
    estimatedActualMinutes: Number(item.estimatedActualMinutes.toFixed(2)),
    coverageRatio: Number(item.coverageRatio.toFixed(4)),
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
