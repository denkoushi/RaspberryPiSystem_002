import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import type { DueManagementScoringParameters } from '../auto-tuning/tuning-types.js';

type TuningHistoryStatus = 'candidate' | 'applied' | 'rejected' | 'rolled_back';

const historyDelegate = () =>
  (prisma as unknown as {
    productionScheduleDueManagementTuningHistory?: {
      create: (args: unknown) => Promise<unknown>;
      findMany: (args: unknown) => Promise<Array<{ evaluation: Prisma.JsonValue | null }>>;
    };
  }).productionScheduleDueManagementTuningHistory;

const failureDelegate = () =>
  (prisma as unknown as {
    productionScheduleDueManagementTuningFailureHistory?: {
      create: (args: unknown) => Promise<unknown>;
    };
  }).productionScheduleDueManagementTuningFailureHistory;

export class TuningHistoryRepository {
  async appendHistory(params: {
    locationKey: string;
    status: TuningHistoryStatus;
    label: string;
    candidateParams: DueManagementScoringParameters;
    baseParams: DueManagementScoringParameters;
    evaluation: Record<string, unknown>;
    guardReason: string | null;
  }): Promise<void> {
    const delegate = historyDelegate();
    if (!delegate) return;
    await delegate.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: params.locationKey,
        status: params.status.toUpperCase(),
        label: params.label,
        candidateParams: params.candidateParams as unknown as Prisma.InputJsonValue,
        baseParams: params.baseParams as unknown as Prisma.InputJsonValue,
        evaluation: params.evaluation as Prisma.InputJsonValue,
        guardReason: params.guardReason,
      },
    });
  }

  async appendFailure(params: {
    locationKey: string;
    reason: string;
    candidateParams: DueManagementScoringParameters | null;
    previousStableParams: DueManagementScoringParameters | null;
    metrics: Record<string, unknown> | null;
  }): Promise<void> {
    const delegate = failureDelegate();
    if (!delegate) return;
    await delegate.create({
      data: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: params.locationKey,
        reason: params.reason,
        candidateParams: params.candidateParams
          ? (params.candidateParams as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        previousStableParams: params.previousStableParams
          ? (params.previousStableParams as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        metrics: params.metrics ? (params.metrics as Prisma.InputJsonValue) : Prisma.JsonNull,
        failedAt: new Date(),
      },
    });
  }

  async getConsecutiveImprovementCount(locationKey: string, maxRows = 20): Promise<number> {
    const delegate = historyDelegate();
    if (!delegate) return 0;
    const rows = await delegate.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
      },
      orderBy: [{ createdAt: 'desc' }],
      take: maxRows,
      select: { evaluation: true },
    });

    let count = 0;
    for (const row of rows) {
      const evaluation = row.evaluation as { improved?: unknown } | null;
      if (evaluation?.improved === true) {
        count += 1;
        continue;
      }
      break;
    }
    return count;
  }
}
