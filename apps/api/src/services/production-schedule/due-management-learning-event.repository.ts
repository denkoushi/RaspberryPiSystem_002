import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import type {
  DecisionEventRepository,
  OperatorDecisionInput,
  OutcomeMetricInput,
  OutcomeMetricsRepository,
  RankingProposalRepository
} from './due-management/domain/contracts.js';

type RankMetrics = {
  topKPrecision: number;
  spearmanRho: number;
  kendallTau: number;
};

const normalizeFseibans = (items: string[]): string[] => {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of items) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next.slice(0, 2000);
};

const roundMetric = (value: number): number => Number(value.toFixed(6));

const computeRankMetrics = (params: {
  proposalOrderedFseibans: string[];
  finalOrderedFseibans: string[];
  topK?: number;
}): RankMetrics => {
  const proposal = normalizeFseibans(params.proposalOrderedFseibans);
  const finalOrder = normalizeFseibans(params.finalOrderedFseibans);
  const shared = proposal.filter((fseiban) => finalOrder.includes(fseiban));
  if (shared.length === 0) {
    return {
      topKPrecision: 0,
      spearmanRho: 0,
      kendallTau: 0
    };
  }

  const topK = Math.max(1, Math.min(params.topK ?? 5, shared.length));
  const proposalTopK = new Set(proposal.slice(0, topK));
  const finalTopK = finalOrder.slice(0, topK);
  const intersection = finalTopK.filter((item) => proposalTopK.has(item)).length;
  const topKPrecision = intersection / topK;

  const proposalRank = new Map(shared.map((item, index) => [item, index + 1] as const));
  const finalRank = new Map(shared.map((item, index) => [item, index + 1] as const));

  const n = shared.length;
  const dSquaredSum = shared.reduce((sum, item) => {
    const d = (proposalRank.get(item) ?? 0) - (finalRank.get(item) ?? 0);
    return sum + d * d;
  }, 0);
  const spearmanRho = n > 1 ? 1 - (6 * dSquaredSum) / (n * (n * n - 1)) : 1;

  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < shared.length; i += 1) {
    for (let j = i + 1; j < shared.length; j += 1) {
      const left = shared[i];
      const right = shared[j];
      const proposalDiff = (proposalRank.get(left) ?? 0) - (proposalRank.get(right) ?? 0);
      const finalDiff = (finalRank.get(left) ?? 0) - (finalRank.get(right) ?? 0);
      const product = proposalDiff * finalDiff;
      if (product > 0) concordant += 1;
      if (product < 0) discordant += 1;
    }
  }
  const totalPairs = concordant + discordant;
  const kendallTau = totalPairs > 0 ? (concordant - discordant) / totalPairs : 0;

  return {
    topKPrecision: roundMetric(topKPrecision),
    spearmanRho: roundMetric(spearmanRho),
    kendallTau: roundMetric(kendallTau)
  };
};

class PrismaDueManagementLearningEventRepository
implements RankingProposalRepository, DecisionEventRepository, OutcomeMetricsRepository {
  async saveProposalEvent(params: {
    locationKey: string;
    proposal: {
      generatedAt: string;
      orderedFseibans: string[];
      candidateCount: number;
      items: Array<{
        fseiban: string;
        rank: number;
        score: number;
        breakdown: Record<string, unknown>;
      }>;
    };
    selectedFseibans: string[];
    writePolicy: Record<string, unknown> | null;
    actorClientKey: string | null;
  }): Promise<void> {
    await prisma.dueManagementProposalEvent.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: params.locationKey,
        generatedAt: new Date(params.proposal.generatedAt),
        orderedFseibans: normalizeFseibans(params.proposal.orderedFseibans),
        candidateCount: params.proposal.candidateCount,
        selectedFseibans: normalizeFseibans(params.selectedFseibans),
        writePolicy: params.writePolicy,
        actorClientKey: params.actorClientKey,
        payload: {
          items: params.proposal.items
        }
      }
    });
  }

  async saveDecisionEvent(input: OperatorDecisionInput): Promise<void> {
    const orderedFseibans = normalizeFseibans(input.orderedFseibans);
    const previousOrderedFseibans = normalizeFseibans(input.previousOrderedFseibans);
    const proposalOrderedFseibans = normalizeFseibans(input.proposalOrderedFseibans);
    const rankMetrics = computeRankMetrics({
      proposalOrderedFseibans,
      finalOrderedFseibans: orderedFseibans
    });
    await prisma.dueManagementOperatorDecisionEvent.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: input.locationKey,
        sourceType: input.sourceType,
        orderedFseibans,
        previousOrderedFseibans,
        proposalOrderedFseibans,
        reorderDeltaRatio: input.reorderDeltaRatio,
        payload: {
          ...(input.metadata ?? {}),
          rankMetrics
        }
      }
    });
  }

  async saveOutcomeEvent(input: OutcomeMetricInput): Promise<void> {
    await prisma.dueManagementOutcomeEvent.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: input.locationKey,
        eventType: input.eventType,
        csvDashboardRowId: input.csvDashboardRowId,
        fseiban: input.fseiban,
        isCompleted: input.isCompleted,
        occurredAt: input.occurredAt,
        payload: input.metadata ?? null
      }
    });
  }
}

const repository = new PrismaDueManagementLearningEventRepository();

export const dueManagementLearningEventRepository: RankingProposalRepository &
DecisionEventRepository &
OutcomeMetricsRepository = repository;

export { computeRankMetrics };
