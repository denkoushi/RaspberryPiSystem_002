import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

const DEFAULT_RECENT_DAYS_EXCLUDED = 30;
const DEFAULT_OUTLIER_MAX_PER_PIECE_MINUTES = 600;

type GroupStats = {
  fhincd: string;
  resourceCd: string;
  values: number[];
};

function percentileFromSorted(values: number[], percentile: number): number {
  if (values.length === 0) {
    return 0;
  }
  if (values.length === 1) {
    return values[0] ?? 0;
  }
  const position = (values.length - 1) * percentile;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = values[lowerIndex] ?? values[values.length - 1] ?? 0;
  const upper = values[upperIndex] ?? values[values.length - 1] ?? 0;
  if (lowerIndex === upperIndex) {
    return lower;
  }
  const ratio = position - lowerIndex;
  return lower + (upper - lower) * ratio;
}

export type ProductionActualHoursAggregateResult = {
  totalRows: number;
  excludedRecentRows: number;
  excludedOutlierRows: number;
  excludedPreFlaggedRows: number;
  featureKeyCount: number;
};

export type ProductionActualHoursStats = {
  totalRawRows: number;
  totalFeatureKeys: number;
  topFeatures: Array<{
    fhincd: string;
    resourceCd: string;
    sampleCount: number;
    medianPerPieceMinutes: number;
    p75PerPieceMinutes: number | null;
    updatedAt: string;
  }>;
};

export class ProductionActualHoursAggregateService {
  async rebuild(params: {
    locationKey: string;
    csvDashboardId?: string;
    recentDaysExcluded?: number;
    outlierMaxPerPieceMinutes?: number;
    minSampleCount?: number;
  }): Promise<ProductionActualHoursAggregateResult> {
    const csvDashboardId = params.csvDashboardId ?? PRODUCTION_SCHEDULE_DASHBOARD_ID;
    const recentDaysExcluded = params.recentDaysExcluded ?? DEFAULT_RECENT_DAYS_EXCLUDED;
    const outlierMaxPerPieceMinutes = params.outlierMaxPerPieceMinutes ?? DEFAULT_OUTLIER_MAX_PER_PIECE_MINUTES;
    const minSampleCount = params.minSampleCount ?? 1;
    const recentCutoff = new Date();
    recentCutoff.setUTCDate(recentCutoff.getUTCDate() - recentDaysExcluded);

    const rows = await prisma.productionScheduleActualHoursRaw.findMany({
      where: { csvDashboardId },
      select: {
        fhincd: true,
        resourceCd: true,
        perPieceMinutes: true,
        isExcluded: true,
        workDate: true,
      },
    });

    let excludedRecentRows = 0;
    let excludedOutlierRows = 0;
    let excludedPreFlaggedRows = 0;

    const grouped = new Map<string, GroupStats>();
    for (const row of rows) {
      if (row.isExcluded) {
        excludedPreFlaggedRows += 1;
        continue;
      }
      if (row.workDate >= recentCutoff) {
        excludedRecentRows += 1;
        continue;
      }
      if (row.perPieceMinutes > outlierMaxPerPieceMinutes) {
        excludedOutlierRows += 1;
        continue;
      }
      if (!Number.isFinite(row.perPieceMinutes) || row.perPieceMinutes <= 0) {
        excludedOutlierRows += 1;
        continue;
      }
      const key = `${row.fhincd}__${row.resourceCd}`;
      const current = grouped.get(key) ?? { fhincd: row.fhincd, resourceCd: row.resourceCd, values: [] };
      current.values.push(row.perPieceMinutes);
      grouped.set(key, current);
    }

    const features: Prisma.ProductionScheduleActualHoursFeatureCreateManyInput[] = [];
    for (const groupedStats of grouped.values()) {
      if (groupedStats.values.length < minSampleCount) {
        continue;
      }
      const sorted = groupedStats.values.slice().sort((a, b) => a - b);
      features.push({
        csvDashboardId,
        location: params.locationKey,
        fhincd: groupedStats.fhincd,
        resourceCd: groupedStats.resourceCd,
        sampleCount: sorted.length,
        medianPerPieceMinutes: percentileFromSorted(sorted, 0.5),
        p75PerPieceMinutes: percentileFromSorted(sorted, 0.75),
        windowFrom: new Date(0),
        windowTo: recentCutoff,
        recentDaysExcluded,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.productionScheduleActualHoursFeature.deleteMany({
        where: {
          csvDashboardId,
          location: params.locationKey,
        },
      });
      if (features.length > 0) {
        await tx.productionScheduleActualHoursFeature.createMany({
          data: features,
        });
      }
    });

    return {
      totalRows: rows.length,
      excludedRecentRows,
      excludedOutlierRows,
      excludedPreFlaggedRows,
      featureKeyCount: features.length,
    };
  }

  async getStats(params: {
    locationKey: string;
    csvDashboardId?: string;
    limit?: number;
  }): Promise<ProductionActualHoursStats> {
    const csvDashboardId = params.csvDashboardId ?? PRODUCTION_SCHEDULE_DASHBOARD_ID;
    const limit = Math.max(1, Math.min(params.limit ?? 50, 200));
    const [totalRawRows, totalFeatureKeys, topFeatures] = await Promise.all([
      prisma.productionScheduleActualHoursRaw.count({
        where: { csvDashboardId },
      }),
      prisma.productionScheduleActualHoursFeature.count({
        where: { csvDashboardId, location: params.locationKey },
      }),
      prisma.productionScheduleActualHoursFeature.findMany({
        where: { csvDashboardId, location: params.locationKey },
        orderBy: [{ sampleCount: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
        select: {
          fhincd: true,
          resourceCd: true,
          sampleCount: true,
          medianPerPieceMinutes: true,
          p75PerPieceMinutes: true,
          updatedAt: true,
        },
      }),
    ]);
    return {
      totalRawRows,
      totalFeatureKeys,
      topFeatures: topFeatures.map((row) => ({
        fhincd: row.fhincd,
        resourceCd: row.resourceCd,
        sampleCount: row.sampleCount,
        medianPerPieceMinutes: row.medianPerPieceMinutes,
        p75PerPieceMinutes: row.p75PerPieceMinutes,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }
}
