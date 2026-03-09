import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { regenerateProductionScheduleGlobalRowRank } from './row-global-rank-generator.service.js';

const MAX_ITEMS = 2000;

const normalizeFseibans = (items: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of items) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= MAX_ITEMS) break;
  }
  return normalized;
};

async function replaceGlobalRankInternal(params: {
  locationKey: string;
  orderedFseibans: string[];
  sourceType?: 'auto' | 'manual';
}): Promise<string[]> {
  const orderedFseibans = normalizeFseibans(params.orderedFseibans);
  const sourceType = params.sourceType ?? 'manual';
  await prisma.$transaction(async (tx) => {
    await tx.productionScheduleGlobalRank.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: params.locationKey
      }
    });
    if (orderedFseibans.length > 0) {
      await tx.productionScheduleGlobalRank.createMany({
        data: orderedFseibans.map((fseiban, index) => ({
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: params.locationKey,
          fseiban,
          priorityOrder: index + 1,
          sourceType
        }))
      });
    }
  });
  await regenerateProductionScheduleGlobalRowRank({
    locationKey: params.locationKey,
    sourceType
  });
  return orderedFseibans;
}

export async function listDueManagementGlobalRank(locationKey: string): Promise<string[]> {
  const rows = await prisma.productionScheduleGlobalRank.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey
    },
    orderBy: [{ priorityOrder: 'asc' }, { fseiban: 'asc' }],
    select: { fseiban: true }
  });
  return rows.map((row) => row.fseiban);
}

export async function replaceDueManagementGlobalRank(params: {
  locationKey: string;
  orderedFseibans: string[];
  sourceType?: 'auto' | 'manual';
}): Promise<string[]> {
  return replaceGlobalRankInternal(params);
}

export async function mergeDueManagementGlobalRank(params: {
  locationKey: string;
  prioritizedFseibans: string[];
}): Promise<string[]> {
  const prioritized = normalizeFseibans(params.prioritizedFseibans);
  const existing = await listDueManagementGlobalRank(params.locationKey);
  const merged = [...prioritized, ...existing.filter((fseiban) => !prioritized.includes(fseiban))];
  return replaceGlobalRankInternal({
    locationKey: params.locationKey,
    orderedFseibans: merged,
    sourceType: 'manual'
  });
}
