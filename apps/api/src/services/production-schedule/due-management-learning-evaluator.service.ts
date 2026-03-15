import { prisma } from '../../lib/prisma.js';
import { fetchSeibanProgressRows } from './seiban-progress.service.js';
import type { DueManagementLearningReport } from './due-management/domain/contracts.js';
import {
  listDueManagementSummariesWithScope,
  resolveDueManagementStorageLocationKey,
  toDueManagementScope,
  type DueManagementLocationScopeInput
} from './due-management-location-scope-adapter.service.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const toJstDayStart = (value: Date): number => {
  const jstDate = new Date(value.getTime() + JST_OFFSET_MS);
  return Date.UTC(jstDate.getUTCFullYear(), jstDate.getUTCMonth(), jstDate.getUTCDate());
};

const computeDaysUntilDue = (dueDate: Date | null): number | null => {
  if (!dueDate) return null;
  const now = new Date();
  return Math.floor((toJstDayStart(dueDate) - toJstDayStart(now)) / DAY_MS);
};

const average = (values: number[]): number => {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(6));
};

const parseDateRange = (params: { from?: string; to?: string }): { from: Date; to: Date } => {
  const now = new Date();
  const to = params.to ? new Date(params.to) : now;
  const from = params.from ? new Date(params.from) : new Date(to.getTime() - 30 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error('invalid_date_range');
  }
  if (from.getTime() > to.getTime()) {
    throw new Error('invalid_date_range_order');
  }
  return { from, to };
};

export async function evaluateDueManagementLearningReport(params: {
  locationScope: DueManagementLocationScopeInput;
  from?: string;
  to?: string;
}): Promise<DueManagementLearningReport> {
  const locationScope = toDueManagementScope(params.locationScope);
  const locationKey = resolveDueManagementStorageLocationKey(locationScope);
  const { from, to } = parseDateRange({ from: params.from, to: params.to });
  const [proposalEvents, decisionEvents, outcomeEvents, summaries] = await Promise.all([
    prisma.dueManagementProposalEvent.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        createdAt: { gte: from, lte: to }
      },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true }
    }),
    prisma.dueManagementOperatorDecisionEvent.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        createdAt: { gte: from, lte: to }
      },
      orderBy: [{ createdAt: 'asc' }],
      select: { payload: true }
    }),
    prisma.dueManagementOutcomeEvent.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        createdAt: { gte: from, lte: to }
      },
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true }
    }),
    listDueManagementSummariesWithScope(locationScope)
  ]);

  const progressRows = await fetchSeibanProgressRows(summaries.map((summary) => summary.fseiban));
  const progressBySeiban = new Map(progressRows.map((row) => [row.fseiban, row] as const));

  let overdueSeibanCount = 0;
  let overdueTotalDays = 0;
  for (const summary of summaries) {
    const daysUntilDue = computeDaysUntilDue(summary.dueDate);
    if (daysUntilDue === null || daysUntilDue >= 0) continue;
    const progress = progressBySeiban.get(summary.fseiban);
    const hasIncomplete = (progress?.completed ?? 0) < (progress?.total ?? 0);
    if (!hasIncomplete) continue;
    overdueSeibanCount += 1;
    overdueTotalDays += Math.abs(daysUntilDue);
  }

  const topKPrecisionList: number[] = [];
  const spearmanList: number[] = [];
  const kendallList: number[] = [];
  for (const event of decisionEvents) {
    const payload = event.payload as { rankMetrics?: { topKPrecision?: number; spearmanRho?: number; kendallTau?: number } } | null;
    const rankMetrics = payload?.rankMetrics;
    if (!rankMetrics) continue;
    if (typeof rankMetrics.topKPrecision === 'number') topKPrecisionList.push(rankMetrics.topKPrecision);
    if (typeof rankMetrics.spearmanRho === 'number') spearmanList.push(rankMetrics.spearmanRho);
    if (typeof rankMetrics.kendallTau === 'number') kendallList.push(rankMetrics.kendallTau);
  }

  return {
    locationKey,
    range: {
      from: from.toISOString(),
      to: to.toISOString()
    },
    summary: {
      proposalCount: proposalEvents.length,
      decisionCount: decisionEvents.length,
      outcomeCount: outcomeEvents.length,
      overdueSeibanCount,
      overdueTotalDays,
      avgTopKPrecision: average(topKPrecisionList),
      avgSpearmanRho: average(spearmanList),
      avgKendallTau: average(kendallList)
    },
    recommendation: {
      primaryObjective: 'minimize_due_delay',
      note:
        '重み自動更新は行わず、遅延指標（overdueSeibanCount/overdueTotalDays）を主指標にオフライン検証で候補重みを比較してください。'
    }
  };
}
