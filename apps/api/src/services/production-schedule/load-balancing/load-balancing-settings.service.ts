import { randomUUID } from 'node:crypto';

import { resolveSiteKeyFromScopeKey } from '../../../lib/location-scope-resolver.js';
import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

const normalizeLocation = (location: string): string => location.trim();
const normalizeSiteKey = (location: string): string => resolveSiteKeyFromScopeKey(normalizeLocation(location));

const normalizeResourceCd = (value: string): string => value.trim().toUpperCase();

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

export async function listLoadBalancingCapacityBase(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingCapacityBaseItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
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
  return {
    siteKey,
    items: rows.map((row) => ({
      resourceCd: row.resourceCd,
      baseAvailableMinutes: row.baseAvailableMinutes
    }))
  };
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
  return {
    siteKey,
    yearMonth,
    items: rows.map((row) => ({
      resourceCd: row.resourceCd,
      availableMinutes: row.availableMinutes
    }))
  };
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

export async function listLoadBalancingClasses(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingClassItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
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
  return {
    siteKey,
    items: rows.map((row) => ({
      resourceCd: row.resourceCd,
      classCode: row.classCode.trim()
    }))
  };
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

export async function listLoadBalancingTransferRules(siteKeyInput: string): Promise<{
  siteKey: string;
  items: LoadBalancingTransferRuleItem[];
}> {
  const siteKey = normalizeSiteKey(siteKeyInput);
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
  return {
    siteKey,
    items: rows.map((row) => ({
      fromClassCode: row.fromClassCode.trim(),
      toClassCode: row.toClassCode.trim(),
      priority: row.priority,
      enabled: row.enabled,
      efficiencyRatio: row.efficiencyRatio
    }))
  };
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
