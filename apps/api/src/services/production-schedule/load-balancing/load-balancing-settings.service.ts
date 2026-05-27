import { randomUUID } from 'node:crypto';

import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { logger } from '../../../lib/logger.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import {
  mergeLoadBalancingItemsByResourceCd,
  mergeLoadBalancingTransferRules,
  SHARED_LOAD_BALANCING_SITE_KEY,
  usedSharedFallbackByResourceCd,
  usedSharedFallbackByTransferRule
} from './load-balancing-settings-merge.js';
import { normalizeWorkCalendarMode, type WorkCalendarMode } from './work-calendar-policy.js';

export { SHARED_LOAD_BALANCING_SITE_KEY } from './load-balancing-settings-merge.js';

const normalizeLocation = (location: string): string => location.trim();
const normalizeSiteKey = (location: string): string => resolveSiteKeyFromScopeKey(normalizeLocation(location));

const normalizeResourceCd = (value: string): string => value.trim().toUpperCase();

function logLoadBalancingSiteSharedResolution(params: {
  siteKey: string;
  setting: string;
  siteItems: readonly unknown[];
  sharedItems: readonly unknown[];
  usedSharedSupplement: boolean;
  yearMonth?: string;
}): void {
  if (params.siteKey === SHARED_LOAD_BALANCING_SITE_KEY) {
    return;
  }
  if (params.siteItems.length === 0 && params.sharedItems.length === 0) {
    logger.warn(
      {
        siteKey: params.siteKey,
        fallbackSiteKey: SHARED_LOAD_BALANCING_SITE_KEY,
        setting: params.setting,
        yearMonth: params.yearMonth
      },
      'Load balancing settings missing for siteKey and shared'
    );
    return;
  }
  if (params.usedSharedSupplement) {
    logger.debug(
      {
        siteKey: params.siteKey,
        fallbackSiteKey: SHARED_LOAD_BALANCING_SITE_KEY,
        setting: params.setting,
        yearMonth: params.yearMonth
      },
      'Load balancing settings supplemented from shared siteKey'
    );
  }
}

export type LoadBalancingCapacityBaseItem = {
  resourceCd: string;
  baseAvailableMinutes: number;
};

export type LoadBalancingMonthlyCapacityItem = {
  resourceCd: string;
  availableMinutes: number;
};

export type LoadBalancingClassItem = {
  resourceCd: string;
  classCode: string;
};

export type LoadBalancingTransferRuleItem = {
  fromClassCode: string;
  toClassCode: string;
  priority: number;
  enabled: boolean;
  efficiencyRatio: number;
};

export type LoadBalancingWorkCalendarItem = {
  resourceCd: string;
  workCalendarMode: WorkCalendarMode;
};

async function fetchLoadBalancingCapacityBaseItems(siteKey: string): Promise<LoadBalancingCapacityBaseItem[]> {
  const rows = await prisma.productionScheduleResourceCapacityBase.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey
    },
    orderBy: [{ resourceCd: 'asc' }],
    select: {
      resourceCd: true,
      baseAvailableMinutes: true
    }
  });
  return rows.map((row) => ({
    resourceCd: row.resourceCd,
    baseAvailableMinutes: row.baseAvailableMinutes
  }));
}

export async function listLoadBalancingCapacityBase(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingCapacityBaseItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
  const items = await fetchLoadBalancingCapacityBaseItems(siteKey);
  return { siteKey, items };
}

export async function listLoadBalancingCapacityBaseResolved(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingCapacityBaseItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
  if (siteKey === SHARED_LOAD_BALANCING_SITE_KEY) {
    return listLoadBalancingCapacityBase(siteKey);
  }

  const [siteItems, sharedItems] = await Promise.all([
    fetchLoadBalancingCapacityBaseItems(siteKey),
    fetchLoadBalancingCapacityBaseItems(SHARED_LOAD_BALANCING_SITE_KEY)
  ]);
  const items = mergeLoadBalancingItemsByResourceCd(siteItems, sharedItems);
  logLoadBalancingSiteSharedResolution({
    siteKey,
    setting: 'capacity-base',
    siteItems,
    sharedItems,
    usedSharedSupplement: usedSharedFallbackByResourceCd(siteItems, items)
  });
  return { siteKey, items };
}

export async function replaceLoadBalancingCapacityBase(params: {
  siteKeyInput: string;
  items: LoadBalancingCapacityBaseItem[];
}): Promise<{ siteKey: string; items: LoadBalancingCapacityBaseItem[] }> {
  const siteKey = normalizeSiteKey(params.siteKeyInput);
  const items = params.items
    .map((item) => ({
      resourceCd: normalizeResourceCd(item.resourceCd),
      baseAvailableMinutes: Math.max(0, Math.floor(item.baseAvailableMinutes))
    }))
    .filter((item) => item.resourceCd.length > 0);

  await prisma.$transaction(async (tx) => {
    await tx.productionScheduleResourceCapacityBase.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey
      }
    });
    if (items.length === 0) return;
    await tx.productionScheduleResourceCapacityBase.createMany({
      data: items.map((item) => ({
        id: randomUUID(),
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey,
        resourceCd: item.resourceCd,
        baseAvailableMinutes: item.baseAvailableMinutes
      }))
    });
  });

  return listLoadBalancingCapacityBase(siteKey);
}

async function fetchLoadBalancingMonthlyCapacityItems(
  siteKey: string,
  yearMonth: string
): Promise<LoadBalancingMonthlyCapacityItem[]> {
  const rows = await prisma.productionScheduleResourceMonthlyCapacity.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey,
      yearMonth
    },
    orderBy: [{ resourceCd: 'asc' }],
    select: {
      resourceCd: true,
      availableMinutes: true
    }
  });
  return rows.map((row) => ({
    resourceCd: row.resourceCd,
    availableMinutes: row.availableMinutes
  }));
}

export async function listLoadBalancingMonthlyCapacity(params: {
  siteKeyInput: string;
  yearMonth: string;
}): Promise<{
  siteKey: string;
  yearMonth: string;
  items: LoadBalancingMonthlyCapacityItem[];
}> {
  const siteKey = normalizeSiteKey(params.siteKeyInput);
  const yearMonth = params.yearMonth.trim();
  const items = await fetchLoadBalancingMonthlyCapacityItems(siteKey, yearMonth);
  return { siteKey, yearMonth, items };
}

export async function listLoadBalancingMonthlyCapacityResolved(params: {
  siteKeyInput: string;
  yearMonth: string;
}): Promise<{
  siteKey: string;
  yearMonth: string;
  items: LoadBalancingMonthlyCapacityItem[];
}> {
  const siteKey = normalizeSiteKey(params.siteKeyInput);
  const yearMonth = params.yearMonth.trim();
  if (siteKey === SHARED_LOAD_BALANCING_SITE_KEY) {
    return listLoadBalancingMonthlyCapacity({ siteKeyInput: siteKey, yearMonth });
  }

  const [siteItems, sharedItems] = await Promise.all([
    fetchLoadBalancingMonthlyCapacityItems(siteKey, yearMonth),
    fetchLoadBalancingMonthlyCapacityItems(SHARED_LOAD_BALANCING_SITE_KEY, yearMonth)
  ]);
  const items = mergeLoadBalancingItemsByResourceCd(siteItems, sharedItems);
  logLoadBalancingSiteSharedResolution({
    siteKey,
    setting: 'monthly-capacity',
    siteItems,
    sharedItems,
    usedSharedSupplement: usedSharedFallbackByResourceCd(siteItems, items),
    yearMonth
  });
  return { siteKey, yearMonth, items };
}

export async function replaceLoadBalancingMonthlyCapacity(params: {
  siteKeyInput: string;
  yearMonth: string;
  items: LoadBalancingMonthlyCapacityItem[];
}): Promise<{
  siteKey: string;
  yearMonth: string;
  items: LoadBalancingMonthlyCapacityItem[];
}> {
  const siteKey = normalizeSiteKey(params.siteKeyInput);
  const yearMonth = params.yearMonth.trim();
  if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
    throw new Error('yearMonth は YYYY-MM 形式で指定してください');
  }

  const items = params.items
    .map((item) => ({
      resourceCd: normalizeResourceCd(item.resourceCd),
      availableMinutes: Math.max(0, Math.floor(item.availableMinutes))
    }))
    .filter((item) => item.resourceCd.length > 0);

  await prisma.$transaction(async (tx) => {
    await tx.productionScheduleResourceMonthlyCapacity.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey,
        yearMonth
      }
    });
    if (items.length === 0) return;
    await tx.productionScheduleResourceMonthlyCapacity.createMany({
      data: items.map((item) => ({
        id: randomUUID(),
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey,
        resourceCd: item.resourceCd,
        yearMonth,
        availableMinutes: item.availableMinutes
      }))
    });
  });

  return listLoadBalancingMonthlyCapacity({ siteKeyInput: siteKey, yearMonth });
}

async function fetchLoadBalancingClassItems(siteKey: string): Promise<LoadBalancingClassItem[]> {
  const rows = await prisma.productionScheduleLoadBalanceClass.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey
    },
    orderBy: [{ resourceCd: 'asc' }],
    select: {
      resourceCd: true,
      classCode: true
    }
  });
  return rows.map((row) => ({
    resourceCd: row.resourceCd,
    classCode: row.classCode.trim()
  }));
}

export async function listLoadBalancingClasses(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingClassItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
  const items = await fetchLoadBalancingClassItems(siteKey);
  return { siteKey, items };
}

export async function listLoadBalancingClassesResolved(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingClassItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
  if (siteKey === SHARED_LOAD_BALANCING_SITE_KEY) {
    return listLoadBalancingClasses(siteKey);
  }

  const [siteItems, sharedItems] = await Promise.all([
    fetchLoadBalancingClassItems(siteKey),
    fetchLoadBalancingClassItems(SHARED_LOAD_BALANCING_SITE_KEY)
  ]);
  const items = mergeLoadBalancingItemsByResourceCd(siteItems, sharedItems);
  logLoadBalancingSiteSharedResolution({
    siteKey,
    setting: 'classes',
    siteItems,
    sharedItems,
    usedSharedSupplement: usedSharedFallbackByResourceCd(siteItems, items)
  });
  return { siteKey, items };
}

export async function replaceLoadBalancingClasses(params: {
  siteKeyInput: string;
  items: LoadBalancingClassItem[];
}): Promise<{ siteKey: string; items: LoadBalancingClassItem[] }> {
  const siteKey = normalizeSiteKey(params.siteKeyInput);
  const unique = new Map<string, LoadBalancingClassItem>();
  for (const item of params.items) {
    const resourceCd = normalizeResourceCd(item.resourceCd);
    const classCode = item.classCode.trim();
    if (!resourceCd || !classCode) continue;
    unique.set(resourceCd, { resourceCd, classCode });
  }
  const items = [...unique.values()].sort((a, b) => a.resourceCd.localeCompare(b.resourceCd));

  await prisma.$transaction(async (tx) => {
    await tx.productionScheduleLoadBalanceClass.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey
      }
    });
    if (items.length === 0) return;
    await tx.productionScheduleLoadBalanceClass.createMany({
      data: items.map((item) => ({
        id: randomUUID(),
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey,
        resourceCd: item.resourceCd,
        classCode: item.classCode
      }))
    });
  });

  return listLoadBalancingClasses(siteKey);
}

async function fetchLoadBalancingTransferRuleItems(siteKey: string): Promise<LoadBalancingTransferRuleItem[]> {
  const rows = await prisma.productionScheduleLoadBalanceTransferRule.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey
    },
    orderBy: [{ fromClassCode: 'asc' }, { priority: 'asc' }, { toClassCode: 'asc' }],
    select: {
      fromClassCode: true,
      toClassCode: true,
      priority: true,
      enabled: true,
      efficiencyRatio: true
    }
  });
  return rows.map((row) => ({
    fromClassCode: row.fromClassCode.trim(),
    toClassCode: row.toClassCode.trim(),
    priority: row.priority,
    enabled: row.enabled,
    efficiencyRatio: row.efficiencyRatio
  }));
}

export async function listLoadBalancingTransferRules(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingTransferRuleItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
  const items = await fetchLoadBalancingTransferRuleItems(siteKey);
  return { siteKey, items };
}

export async function listLoadBalancingTransferRulesResolved(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingTransferRuleItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
  if (siteKey === SHARED_LOAD_BALANCING_SITE_KEY) {
    return listLoadBalancingTransferRules(siteKey);
  }

  const [siteItems, sharedItems] = await Promise.all([
    fetchLoadBalancingTransferRuleItems(siteKey),
    fetchLoadBalancingTransferRuleItems(SHARED_LOAD_BALANCING_SITE_KEY)
  ]);
  const items = mergeLoadBalancingTransferRules(siteItems, sharedItems);
  logLoadBalancingSiteSharedResolution({
    siteKey,
    setting: 'transfer-rules',
    siteItems,
    sharedItems,
    usedSharedSupplement: usedSharedFallbackByTransferRule(siteItems, items)
  });
  return { siteKey, items };
}

export async function replaceLoadBalancingTransferRules(params: {
  siteKeyInput: string;
  items: LoadBalancingTransferRuleItem[];
}): Promise<{ siteKey: string; items: LoadBalancingTransferRuleItem[] }> {
  const siteKey = normalizeSiteKey(params.siteKeyInput);
  const normalized = params.items
    .map((item) => ({
      fromClassCode: item.fromClassCode.trim(),
      toClassCode: item.toClassCode.trim(),
      priority: Number.isFinite(item.priority) ? Math.floor(item.priority) : 1,
      enabled: Boolean(item.enabled),
      efficiencyRatio: Number.isFinite(item.efficiencyRatio) && item.efficiencyRatio > 0 ? item.efficiencyRatio : 1
    }))
    .filter((item) => item.fromClassCode.length > 0 && item.toClassCode.length > 0);

  await prisma.$transaction(async (tx) => {
    await tx.productionScheduleLoadBalanceTransferRule.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey
      }
    });
    if (normalized.length === 0) return;
    await tx.productionScheduleLoadBalanceTransferRule.createMany({
      data: normalized.map((item) => ({
        id: randomUUID(),
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey,
        fromClassCode: item.fromClassCode,
        toClassCode: item.toClassCode,
        priority: item.priority,
        enabled: item.enabled,
        efficiencyRatio: item.efficiencyRatio
      }))
    });
  });

  return listLoadBalancingTransferRules(siteKey);
}

async function fetchLoadBalancingWorkCalendarItems(siteKey: string): Promise<LoadBalancingWorkCalendarItem[]> {
  const rows = await prisma.productionScheduleResourceWorkCalendar.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey
    },
    orderBy: [{ resourceCd: 'asc' }],
    select: {
      resourceCd: true,
      workCalendarMode: true
    }
  });
  return rows.map((row) => ({
    resourceCd: row.resourceCd,
    workCalendarMode: normalizeWorkCalendarMode(row.workCalendarMode)
  }));
}

export async function listLoadBalancingWorkCalendars(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingWorkCalendarItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
  const items = await fetchLoadBalancingWorkCalendarItems(siteKey);
  return { siteKey, items };
}

export async function listLoadBalancingWorkCalendarsResolved(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingWorkCalendarItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
  if (siteKey === SHARED_LOAD_BALANCING_SITE_KEY) {
    return listLoadBalancingWorkCalendars(siteKey);
  }

  const [siteItems, sharedItems] = await Promise.all([
    fetchLoadBalancingWorkCalendarItems(siteKey),
    fetchLoadBalancingWorkCalendarItems(SHARED_LOAD_BALANCING_SITE_KEY)
  ]);
  const items = mergeLoadBalancingItemsByResourceCd(siteItems, sharedItems);
  logLoadBalancingSiteSharedResolution({
    siteKey,
    setting: 'work-calendars',
    siteItems,
    sharedItems,
    usedSharedSupplement: usedSharedFallbackByResourceCd(siteItems, items)
  });
  return { siteKey, items };
}

export async function replaceLoadBalancingWorkCalendars(params: {
  siteKeyInput: string;
  items: LoadBalancingWorkCalendarItem[];
}): Promise<{ siteKey: string; items: LoadBalancingWorkCalendarItem[] }> {
  const siteKey = normalizeSiteKey(params.siteKeyInput);
  const unique = new Map<string, LoadBalancingWorkCalendarItem>();
  for (const item of params.items) {
    const resourceCd = normalizeResourceCd(item.resourceCd);
    if (!resourceCd) continue;
    unique.set(resourceCd, {
      resourceCd,
      workCalendarMode: normalizeWorkCalendarMode(item.workCalendarMode)
    });
  }
  const items = [...unique.values()].sort((a, b) => a.resourceCd.localeCompare(b.resourceCd));

  await prisma.$transaction(async (tx) => {
    await tx.productionScheduleResourceWorkCalendar.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey
      }
    });
    if (items.length === 0) return;
    await tx.productionScheduleResourceWorkCalendar.createMany({
      data: items.map((item) => ({
        id: randomUUID(),
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        siteKey,
        resourceCd: item.resourceCd,
        workCalendarMode: item.workCalendarMode
      }))
    });
  });

  return listLoadBalancingWorkCalendars(siteKey);
}

export function buildWorkCalendarModeMap(items: LoadBalancingWorkCalendarItem[]): Map<string, WorkCalendarMode> {
  return new Map(items.map((item) => [item.resourceCd, item.workCalendarMode]));
}
