import { prisma } from '../../lib/prisma.js';
import {
  listRegisteredDeviceScopeKeysForSite,
  MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY
} from '../../lib/manual-order-device-scope.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

/** キオスク上ペイン用の行スナップショット（集計・学習用の指標は resources 直下で従来どおり） */
export type ManualOrderOverviewRow = {
  orderNumber: number;
  fseiban: string;
  fhincd: string;
  processLabel: string;
  machineName: string;
  partName: string;
};

export type ManualOrderOverviewResource = {
  resourceCd: string;
  assignedCount: number;
  maxOrderNumber: number | null;
  avgGlobalRankGap: number | null;
  comparedCount: number;
  missingGlobalRankCount: number;
  lastUpdatedAt: string | null;
  lastUpdatedBy: string | null;
  rows: ManualOrderOverviewRow[];
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
  csvDashboardRow: {
    rowData: unknown;
    rowNotes: ReadonlyArray<{ processingType: string | null }>;
  };
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

const strField = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const isMachinePartCode = (fhincd: string): boolean => {
  const normalized = fhincd.trim().toUpperCase();
  return normalized.startsWith('MH') || normalized.startsWith('SH');
};

const buildSeibanToMachineName = (assignments: AssignmentRow[]): Map<string, string> => {
  const map = new Map<string, string>();
  for (const assignment of assignments) {
    const rowData = assignment.csvDashboardRow.rowData as Record<string, unknown>;
    const fhincd = strField(rowData.FHINCD);
    if (!isMachinePartCode(fhincd)) continue;
    const fseiban = strField(rowData.FSEIBAN);
    if (!fseiban) continue;
    const fhinmei = strField(rowData.FHINMEI);
    if (fhinmei.length === 0 || map.has(fseiban)) continue;
    map.set(fseiban, fhinmei);
  }
  return map;
};

const resolveProcessLabel = (
  rowData: Record<string, unknown>,
  rowNotes: ReadonlyArray<{ processingType: string | null }>
): string => {
  const fromNote = rowNotes[0]?.processingType;
  const trimmedNote = typeof fromNote === 'string' ? fromNote.trim() : '';
  if (trimmedNote.length > 0) return trimmedNote;
  const fkojun = rowData.FKOJUN;
  if (typeof fkojun === 'number' && Number.isFinite(fkojun)) return String(fkojun);
  if (typeof fkojun === 'string' && fkojun.trim().length > 0) return fkojun.trim();
  return '';
};

const assignmentToOverviewRow = (
  assignment: AssignmentRow,
  machineBySeiban: Map<string, string>
): ManualOrderOverviewRow => {
  const rowData = assignment.csvDashboardRow.rowData as Record<string, unknown>;
  const notes = assignment.csvDashboardRow.rowNotes;
  const fseiban = strField(rowData.FSEIBAN);
  const fhincd = strField(rowData.FHINCD);
  const fhinmei = strField(rowData.FHINMEI);
  const processLabel = resolveProcessLabel(rowData, notes);
  if (isMachinePartCode(fhincd)) {
    return {
      orderNumber: assignment.orderNumber,
      fseiban,
      fhincd,
      processLabel,
      machineName: fhinmei,
      partName: ''
    };
  }
  return {
    orderNumber: assignment.orderNumber,
    fseiban,
    fhincd,
    processLabel,
    machineName: machineBySeiban.get(fseiban) ?? '',
    partName: fhinmei
  };
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
  assignments: AssignmentRow[],
  globalRankMap: Map<string, number>,
  latestUpdateByResource: Map<string, { lastUpdatedAt: string; lastUpdatedBy: string | null }>
): ManualOrderOverviewResource[] => {
  const machineBySeiban = buildSeibanToMachineName(assignments);
  const byResource = new Map<string, AssignmentRow[]>();
  for (const assignment of assignments) {
    const list = byResource.get(assignment.resourceCd) ?? [];
    list.push(assignment);
    byResource.set(assignment.resourceCd, list);
  }

  return Array.from(byResource.entries())
    .map(([resourceCdValue, group]) => {
      const sorted = [...group].sort((left, right) => left.orderNumber - right.orderNumber);
      const rows = sorted.map((a) => assignmentToOverviewRow(a, machineBySeiban));

      let assignedCount = 0;
      let maxOrderNumber: number | null = null;
      let comparedCount = 0;
      let missingGlobalRankCount = 0;
      let totalGap = 0;
      let fallbackLatestUpdatedAt: string | null = null;

      for (const assignment of sorted) {
        assignedCount += 1;
        maxOrderNumber =
          maxOrderNumber === null ? assignment.orderNumber : Math.max(maxOrderNumber, assignment.orderNumber);
        if (!fallbackLatestUpdatedAt) {
          fallbackLatestUpdatedAt = assignment.updatedAt.toISOString();
        }
        const rowData = assignment.csvDashboardRow.rowData as Record<string, unknown>;
        const fseiban = typeof rowData.FSEIBAN === 'string' ? rowData.FSEIBAN.trim() : '';
        const autoRank = fseiban.length > 0 ? globalRankMap.get(fseiban) : undefined;
        if (typeof autoRank !== 'number') {
          missingGlobalRankCount += 1;
        } else {
          comparedCount += 1;
          totalGap += Math.abs(assignment.orderNumber - autoRank);
        }
      }

      const latest = latestUpdateByResource.get(resourceCdValue);
      return {
        resourceCd: resourceCdValue,
        assignedCount,
        maxOrderNumber,
        avgGlobalRankGap: comparedCount > 0 ? Number((totalGap / comparedCount).toFixed(2)) : null,
        comparedCount,
        missingGlobalRankCount,
        lastUpdatedAt: latest?.lastUpdatedAt ?? fallbackLatestUpdatedAt,
        lastUpdatedBy: latest?.lastUpdatedBy ?? null,
        rows
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
            rowData: true,
            rowNotes: {
              select: { processingType: true },
              take: 1
            }
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
            rowData: true,
            rowNotes: {
              select: { processingType: true },
              take: 1
            }
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
