import type { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  DEFAULT_DUE_MANAGEMENT_SCORING_PARAMETERS,
  sanitizeDueManagementScoringParameters,
} from '../auto-tuning/tuning-defaults.js';
import type { DueManagementScoringParameters } from '../auto-tuning/tuning-types.js';

type StableSnapshot = {
  params: DueManagementScoringParameters;
  previousParams: DueManagementScoringParameters | null;
  version: number;
};

const stableDelegate = () =>
  (prisma as unknown as {
    productionScheduleDueManagementTuningStableSnapshot?: {
      findUnique: (args: unknown) => Promise<{
        params: Prisma.JsonValue;
        previousParams: Prisma.JsonValue | null;
        version: number;
      } | null>;
      upsert: (args: unknown) => Promise<unknown>;
      update: (args: unknown) => Promise<unknown>;
    };
  }).productionScheduleDueManagementTuningStableSnapshot;

const parseParams = (value: Prisma.JsonValue | null | undefined): DueManagementScoringParameters =>
  sanitizeDueManagementScoringParameters((value ?? null) as Partial<DueManagementScoringParameters> | null);

export class TuningParamsRepository {
  async getStableSnapshot(locationKey: string): Promise<StableSnapshot | null> {
    const delegate = stableDelegate();
    if (!delegate) return null;
    const row = await delegate.findUnique({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: locationKey,
        },
      },
      select: {
        params: true,
        previousParams: true,
        version: true,
      },
    });
    if (!row) return null;
    return {
      params: parseParams(row.params),
      previousParams: row.previousParams ? parseParams(row.previousParams) : null,
      version: row.version,
    };
  }

  async getCurrentParams(locationKey: string): Promise<DueManagementScoringParameters> {
    const snapshot = await this.getStableSnapshot(locationKey);
    return snapshot?.params ?? { ...DEFAULT_DUE_MANAGEMENT_SCORING_PARAMETERS };
  }

  async setStableParams(params: {
    locationKey: string;
    nextParams: DueManagementScoringParameters;
  }): Promise<void> {
    const delegate = stableDelegate();
    if (!delegate) return;
    const current = await this.getStableSnapshot(params.locationKey);
    const next = sanitizeDueManagementScoringParameters(params.nextParams);
    await delegate.upsert({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: params.locationKey,
        },
      },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: params.locationKey,
        params: next as Prisma.InputJsonValue,
        previousParams: null,
        version: 1,
      },
      update: {
        params: next as Prisma.InputJsonValue,
        previousParams: current?.params
          ? (current.params as unknown as Prisma.InputJsonValue)
          : null,
        previousVersion: current?.version ?? null,
        version: (current?.version ?? 0) + 1,
        activatedAt: new Date(),
      },
    });
  }

  async rollbackToPreviousStable(locationKey: string): Promise<DueManagementScoringParameters | null> {
    const delegate = stableDelegate();
    if (!delegate) return null;
    const current = await this.getStableSnapshot(locationKey);
    if (!current?.previousParams) return null;
    await delegate.update({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: locationKey,
        },
      },
      data: {
        params: current.previousParams as unknown as Prisma.InputJsonValue,
        previousParams: current.params as unknown as Prisma.InputJsonValue,
        previousVersion: current.version,
        version: current.version + 1,
        activatedAt: new Date(),
      },
    });
    return current.previousParams;
  }
}
