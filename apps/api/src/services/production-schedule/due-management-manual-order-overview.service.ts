import { prisma } from '../../lib/prisma.js';
import {
  listRegisteredDeviceScopeKeysForSite,
  MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY
} from '../../lib/manual-order-device-scope.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

export type ManualOrderOverviewResource = {
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

type AssignmentRow = {
  resourceCd: string;
  orderNumber: number;
  updatedAt: Date;
  location: string;
  csvDashboardRow: { rowData: unknown };
};

type EventRow = {
  occurredAt: Date;
  location: string;
  payload: unknown;
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const collectLatestUpdateByResource = (
  events: EventRow[],
  eventLocationKey: string
): Map<string, { lastUpdatedAt: string; lastUpdatedBy: string | null }> => {
  const latestUpdateByResource = new Map<string, { lastUpdatedAt: string; lastUpdatedBy: string | null }>();
  for (const event of events) {
    if (event.location !== eventLocationKey) continue;
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
  return latestUpdateByResource;
};

const buildManualOrderOverviewResources = (
  assignments: Array<{
    resourceCd: string;
    orderNumber: number;
    updatedAt: Date;
    csvDashboardRow: { rowData: unknown };
  }>,
  globalRankMap: Map<string, number>,
  latestUpdateByResource: Map<string, { lastUpdatedAt: string; lastUpdatedBy: string | null }>
): ManualOrderOverviewResource[] => {
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

  return Array.from(buckets.entries())
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
        location: true,
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
        priorityOrder: true
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
        location: true,
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
    globalRankMap.set(fseiban, item.priorityOrder);
  });

  const latestUpdateByResource = collectLatestUpdateByResource(recentEvents as EventRow[], targetLocation);
  const resources = buildManualOrderOverviewResources(assignments, globalRankMap, latestUpdateByResource);

  return {
    targetLocation,
    resources
  };
}

export type ManualOrderOverviewDeviceSlice = {
  deviceScopeKey: string;
  label: string;
  resources: ManualOrderOverviewResource[];
};

export async function listDueManagementManualOrderOverviewV2(params: {
  siteKey: string;
  deviceScopeKey?: string;
  resourceCd?: string;
}): Promise<{
  siteKey: string;
  deviceScopeKey: string | null;
  registeredDeviceScopeKeys: string[];
  devices: ManualOrderOverviewDeviceSlice[];
}> {
  const siteKey = params.siteKey.trim();
  const resourceCd = params.resourceCd?.trim();
  const deviceScopeKeyFilter = params.deviceScopeKey?.trim();

  const registeredDeviceScopeKeys = await listRegisteredDeviceScopeKeysForSite(siteKey);

  const assignmentWhere: {
    csvDashboardId: string;
    siteKey: string;
    resourceCd?: string;
    location?: string;
  } = {
    csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
    siteKey,
    ...(resourceCd ? { resourceCd } : {})
  };

  if (deviceScopeKeyFilter) {
    if (deviceScopeKeyFilter === MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY) {
      assignmentWhere.location = siteKey;
    } else {
      assignmentWhere.location = deviceScopeKeyFilter;
    }
  }

  const [assignments, globalRanks, recentEvents] = await Promise.all([
    prisma.productionScheduleOrderAssignment.findMany({
      where: assignmentWhere,
      select: {
        resourceCd: true,
        orderNumber: true,
        updatedAt: true,
        location: true,
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
        location: siteKey
      },
      select: {
        fseiban: true,
        priorityOrder: true
      }
    }),
    prisma.dueManagementOutcomeEvent.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        eventType: 'manual_order_update',
        OR: [{ location: siteKey }, { location: { startsWith: `${siteKey} - ` } }]
      },
      select: {
        occurredAt: true,
        location: true,
        payload: true
      },
      orderBy: {
        occurredAt: 'desc'
      },
      take: 800
    })
  ]);

  const globalRankMap = new Map<string, number>();
  globalRanks.forEach((item) => {
    const fseiban = item.fseiban.trim();
    if (!fseiban) return;
    globalRankMap.set(fseiban, item.priorityOrder);
  });

  const eventRows = recentEvents as EventRow[];

  const byLocation = new Map<string, AssignmentRow[]>();
  for (const a of assignments as AssignmentRow[]) {
    const list = byLocation.get(a.location) ?? [];
    list.push(a);
    byLocation.set(a.location, list);
  }

  const sortLocationKeys = (keys: string[]): string[] => {
    const legacyKeys = keys.filter((k) => k === siteKey);
    const deviceKeys = keys.filter((k) => k !== siteKey).sort((a, b) => a.localeCompare(b, 'ja'));
    return [...legacyKeys, ...deviceKeys];
  };

  const devices: ManualOrderOverviewDeviceSlice[] = sortLocationKeys([...byLocation.keys()]).map((loc) => {
    const sliceAssignments = byLocation.get(loc) ?? [];
    const latestMap = collectLatestUpdateByResource(eventRows, loc);
    const resources = buildManualOrderOverviewResources(sliceAssignments, globalRankMap, latestMap);
    const isLegacySiteRow = loc === siteKey;
    return {
      deviceScopeKey: isLegacySiteRow ? MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY : loc,
      label: isLegacySiteRow ? 'レガシー（サイト単位・旧データ）' : loc,
      resources
    };
  });

  return {
    siteKey,
    deviceScopeKey: deviceScopeKeyFilter ?? null,
    registeredDeviceScopeKeys,
    devices
  };
}
