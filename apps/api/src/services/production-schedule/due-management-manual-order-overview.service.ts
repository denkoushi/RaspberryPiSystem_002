import { prisma } from '../../lib/prisma.js';
import {
  listRegisteredDeviceScopeKeysForSite,
  MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY
} from '../../lib/manual-order-device-scope.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { fetchSeibanProgressRows } from './seiban-progress.service.js';

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

/**
 * 製番ごとの機種名（同一製番の MH/SH 行の FHINMEI）。
 * 手動順番の割当行だけでは部品行のみのことがあり得るため、生産スケジュール一覧と同様に
 * CsvDashboardRow 全体から解決する（fetchSeibanProgressRows と整合）。
 */
const buildMachineNameBySeibanFromDashboard = async (assignments: AssignmentRow[]): Promise<Map<string, string>> => {
  const fseibans = [
    ...new Set(
      assignments
        .map((a) => strField((a.csvDashboardRow.rowData as Record<string, unknown>).FSEIBAN))
        .filter((s) => s.length > 0)
    )
  ];
  const progressRows = await fetchSeibanProgressRows(fseibans);
  const map = new Map<string, string>();
  for (const row of progressRows) {
    const fb = row.fseiban?.trim();
    if (!fb) continue;
    const mn = row.machineName?.trim();
    if (mn && mn.length > 0) map.set(fb, mn);
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
  const machineFromDashboard = machineBySeiban.get(fseiban) ?? '';
  if (isMachinePartCode(fhincd)) {
    return {
      orderNumber: assignment.orderNumber,
      fseiban,
      fhincd,
      processLabel,
      machineName: fhinmei.length > 0 ? fhinmei : machineFromDashboard,
      partName: ''
    };
  }
  return {
    orderNumber: assignment.orderNumber,
    fseiban,
    fhincd,
    processLabel,
    machineName: machineFromDashboard,
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
  latestUpdateByResource: Map<string, { lastUpdatedAt: string; lastUpdatedBy: string | null }>,
  machineBySeiban: Map<string, string>
): ManualOrderOverviewResource[] => {
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

/**
 * 手動順番カードの資源割り当て順を反映する。
 * 1) assignmentOrder の順を優先 2) 割当先だが行が無い資源は空行 3) 割当外の既存集計は末尾
 */
export function mergeManualOrderOverviewResourcesWithAssignmentOrder(
  assignmentOrder: string[],
  derived: ManualOrderOverviewResource[]
): ManualOrderOverviewResource[] {
  const byCd = new Map(derived.map((r) => [r.resourceCd, r]));
  const used = new Set<string>();
  const result: ManualOrderOverviewResource[] = [];
  for (const cd of assignmentOrder) {
    const existing = byCd.get(cd);
    if (existing) {
      result.push(existing);
    } else {
      result.push({
        resourceCd: cd,
        assignedCount: 0,
        maxOrderNumber: null,
        avgGlobalRankGap: null,
        comparedCount: 0,
        missingGlobalRankCount: 0,
        lastUpdatedAt: null,
        lastUpdatedBy: null,
        rows: []
      });
    }
    used.add(cd);
  }
  for (const r of derived) {
    if (!used.has(r.resourceCd)) result.push(r);
  }
  return result;
}

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
  const machineBySeiban = await buildMachineNameBySeibanFromDashboard(assignments);
  const resources = buildManualOrderOverviewResources(assignments, globalRankMap, latestUpdateByResource, machineBySeiban);

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

  const [assignments, globalRanks, recentEvents, manualResourceAssignmentRows] = await Promise.all([
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
    }),
    prisma.productionScheduleManualOrderResourceAssignment.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey
      },
      orderBy: [{ deviceScopeKey: 'asc' }, { priority: 'asc' }],
      select: {
        deviceScopeKey: true,
        resourceCd: true
      }
    })
  ]);

  const globalRankMap = new Map<string, number>();
  globalRanks.forEach((item) => {
    const fseiban = item.fseiban.trim();
    if (!fseiban) return;
    globalRankMap.set(fseiban, item.priorityOrder);
  });

  const eventRows = recentEvents as EventRow[];
  const assignmentRows = assignments as AssignmentRow[];
  const machineBySeiban = await buildMachineNameBySeibanFromDashboard(assignmentRows);

  const byLocation = new Map<string, AssignmentRow[]>();
  for (const a of assignmentRows) {
    const list = byLocation.get(a.location) ?? [];
    list.push(a);
    byLocation.set(a.location, list);
  }

  const assignmentOrderByDevice = new Map<string, string[]>();
  for (const row of manualResourceAssignmentRows) {
    const key = row.deviceScopeKey.trim();
    const list = assignmentOrderByDevice.get(key) ?? [];
    list.push(row.resourceCd.trim());
    assignmentOrderByDevice.set(key, list);
  }

  const devices: ManualOrderOverviewDeviceSlice[] = [];

  const legacyAssignmentOrder = assignmentOrderByDevice.get(MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY) ?? [];
  const showLegacy =
    byLocation.has(siteKey) || legacyAssignmentOrder.length > 0;
  if (showLegacy) {
    const sliceAssignments = byLocation.get(siteKey) ?? [];
    const latestMap = collectLatestUpdateByResource(eventRows, siteKey);
    const resources =
      legacyAssignmentOrder.length === 0
        ? buildManualOrderOverviewResources(sliceAssignments, globalRankMap, latestMap, machineBySeiban)
        : mergeManualOrderOverviewResourcesWithAssignmentOrder(
            legacyAssignmentOrder,
            buildManualOrderOverviewResources(sliceAssignments, globalRankMap, latestMap, machineBySeiban)
          );
    devices.push({
      deviceScopeKey: MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY,
      label: 'レガシー（サイト単位・旧データ）',
      resources
    });
  }

  const sortDeviceKeys = (keys: string[]): string[] =>
    [...keys].sort((a, b) => a.localeCompare(b, 'ja'));

  for (const loc of sortDeviceKeys(registeredDeviceScopeKeys)) {
    const sliceAssignments = byLocation.get(loc) ?? [];
    const latestMap = collectLatestUpdateByResource(eventRows, loc);
    const assignmentOrder = assignmentOrderByDevice.get(loc) ?? [];
    const resources =
      assignmentOrder.length === 0
        ? []
        : mergeManualOrderOverviewResourcesWithAssignmentOrder(
            assignmentOrder,
            buildManualOrderOverviewResources(sliceAssignments, globalRankMap, latestMap, machineBySeiban)
          );
    devices.push({
      deviceScopeKey: loc,
      label: loc,
      resources
    });
  }

  return {
    siteKey,
    deviceScopeKey: deviceScopeKeyFilter ?? null,
    registeredDeviceScopeKeys,
    devices
  };
}
