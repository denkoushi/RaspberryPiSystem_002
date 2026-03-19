import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

type ManualOrderOverviewResource = {
  resourceCd: string;
  assignedCount: number;
  maxOrderNumber: number | null;
  avgGlobalRankGap: number | null;
  comparedCount: number;
  missingGlobalRankCount: number;
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
};

type ManualOrderOverview = {
  targetLocation: string;
  resources: ManualOrderOverviewResource[];
};

type Params = {
  targetLocation: string;
  resourceCd?: string;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export async function listDueManagementManualOrderOverview(params: Params): Promise<ManualOrderOverview> {
  const targetLocation = params.targetLocation.trim();
  const resourceCd = params.resourceCd?.trim();
  const [assignments, globalRanks, recentEvents] = await Promise.all([
    prisma.productionScheduleOrderAssignment.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: targetLocation,
        ...(resourceCd ? { resourceCd } : {})
      },
      select: {
        resourceCd: true,
        orderNumber: true,
        updatedAt: true,
        csvDashboardRow: {
          select: {
            rowData: true
          }
        }
      },
      orderBy: {
        updatedAt: 'desc'
      }
    }),
    prisma.productionScheduleGlobalRank.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: targetLocation
      },
      select: {
        fseiban: true,
        rankOrder: true
      }
    }),
    prisma.dueManagementOutcomeEvent.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: targetLocation,
        eventType: 'manual_order_update'
      },
      select: {
        occurredAt: true,
        payload: true
      },
      orderBy: {
        occurredAt: 'desc'
      },
      take: 500
    })
  ]);

  const globalRankMap = new Map<string, number>();
  globalRanks.forEach((item) => {
    const fseiban = item.fseiban.trim();
    if (!fseiban) return;
    globalRankMap.set(fseiban, item.rankOrder);
  });

  const latestUpdateByResource = new Map<string, { lastUpdatedAt: string; lastUpdatedBy: string | null }>();
  for (const event of recentEvents) {
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) continue;
    const payload = event.payload as Record<string, unknown>;
    const eventResourceCd = typeof payload.resourceCd === 'string' ? payload.resourceCd.trim() : '';
    if (!eventResourceCd || latestUpdateByResource.has(eventResourceCd)) continue;
    const actorLocation = typeof payload.actorLocation === 'string' ? payload.actorLocation.trim() : '';
    latestUpdateByResource.set(eventResourceCd, {
      lastUpdatedAt: event.occurredAt.toISOString(),
      lastUpdatedBy: actorLocation.length > 0 ? actorLocation : null
    });
  }

  const buckets = new Map<
    string,
    {
      assignedCount: number;
      maxOrderNumber: number | null;
      comparedCount: number;
      missingGlobalRankCount: number;
      totalGap: number;
      fallbackLatestUpdatedAt: string | null;
    }
  >();

  assignments.forEach((assignment) => {
    const bucket =
      buckets.get(assignment.resourceCd) ??
      {
        assignedCount: 0,
        maxOrderNumber: null,
        comparedCount: 0,
        missingGlobalRankCount: 0,
        totalGap: 0,
        fallbackLatestUpdatedAt: null
      };
    bucket.assignedCount += 1;
    bucket.maxOrderNumber =
      bucket.maxOrderNumber === null ? assignment.orderNumber : Math.max(bucket.maxOrderNumber, assignment.orderNumber);
    if (!bucket.fallbackLatestUpdatedAt) {
      bucket.fallbackLatestUpdatedAt = assignment.updatedAt.toISOString();
    }

    const rowData = assignment.csvDashboardRow.rowData as Record<string, unknown>;
    const fseiban = typeof rowData.FSEIBAN === 'string' ? rowData.FSEIBAN.trim() : '';
    const autoRank = fseiban.length > 0 ? globalRankMap.get(fseiban) : undefined;
    if (typeof autoRank !== 'number') {
      bucket.missingGlobalRankCount += 1;
    } else {
      bucket.comparedCount += 1;
      bucket.totalGap += Math.abs(assignment.orderNumber - autoRank);
    }
    buckets.set(assignment.resourceCd, bucket);
  });

  const resources: ManualOrderOverviewResource[] = Array.from(buckets.entries())
    .map(([resourceCdValue, bucket]) => {
      const latest = latestUpdateByResource.get(resourceCdValue);
      return {
        resourceCd: resourceCdValue,
        assignedCount: bucket.assignedCount,
        maxOrderNumber: bucket.maxOrderNumber,
        avgGlobalRankGap:
          bucket.comparedCount > 0 ? Number((bucket.totalGap / bucket.comparedCount).toFixed(2)) : null,
        comparedCount: bucket.comparedCount,
        missingGlobalRankCount: bucket.missingGlobalRankCount,
        lastUpdatedAt: latest?.lastUpdatedAt ?? bucket.fallbackLatestUpdatedAt,
        lastUpdatedBy: latest?.lastUpdatedBy ?? null
      };
    })
    .sort((left, right) => {
      const leftNumeric = toNumber(left.resourceCd);
      const rightNumeric = toNumber(right.resourceCd);
      if (leftNumeric !== null && rightNumeric !== null && leftNumeric !== rightNumeric) {
        return leftNumeric - rightNumeric;
      }
      return left.resourceCd.localeCompare(right.resourceCd, 'ja');
    });

  return {
    targetLocation,
    resources
  };
}
