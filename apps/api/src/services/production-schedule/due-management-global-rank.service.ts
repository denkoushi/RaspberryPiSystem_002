import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { regenerateProductionScheduleGlobalRowRank } from './row-global-rank-generator.service.js';
import {
  GLOBAL_SHARED_LOCATION_KEY,
  LOCAL_TEMPORARY_OVERRIDE_TTL_MINUTES,
  type RankingScope
} from './due-management-ranking-scope-policy.service.js';

const MAX_ITEMS = 2000;
const fallbackTemporaryOverrides = new Map<
  string,
  { orderedFseibans: string[]; expiresAt: Date }
>();

const isMissingTemporaryOverrideTableError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2021';

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

export async function listDueManagementGlobalRank(params: {
  locationKey: string;
  targetLocation?: string;
  scope?: RankingScope;
}): Promise<string[]> {
  const scope = params.scope ?? 'globalShared';
  if (scope === 'localTemporary') {
    const key = `${PRODUCTION_SCHEDULE_DASHBOARD_ID}::${params.targetLocation ?? params.locationKey}`;
    const now = new Date();
    const fallback = fallbackTemporaryOverrides.get(key);
    if (fallback && fallback.expiresAt > now) {
      return normalizeFseibans(fallback.orderedFseibans);
    }
    fallbackTemporaryOverrides.delete(key);
    try {
      await prisma.productionScheduleGlobalRankTemporaryOverride.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          expiresAt: { lte: now }
        }
      });
      const override = await prisma.productionScheduleGlobalRankTemporaryOverride.findUnique({
        where: {
          csvDashboardId_targetLocation: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            targetLocation: params.targetLocation ?? params.locationKey
          }
        },
        select: { orderedFseibans: true }
      });
      if (override) {
        return normalizeFseibans(override.orderedFseibans);
      }
    } catch (error) {
      if (!isMissingTemporaryOverrideTableError(error)) {
        throw error;
      }
    }
  }

  const readLocation =
    scope === 'locationScoped'
      ? params.locationKey
      : params.locationKey;
  const rows = await prisma.productionScheduleGlobalRank.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: readLocation
    },
    orderBy: [{ priorityOrder: 'asc' }, { fseiban: 'asc' }],
    select: { fseiban: true }
  });
  if (rows.length === 0 && scope === 'globalShared' && readLocation !== GLOBAL_SHARED_LOCATION_KEY) {
    const legacyRows = await prisma.productionScheduleGlobalRank.findMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: GLOBAL_SHARED_LOCATION_KEY
      },
      orderBy: [{ priorityOrder: 'asc' }, { fseiban: 'asc' }],
      select: { fseiban: true }
    });
    return legacyRows.map((row) => row.fseiban);
  }
  return rows.map((row) => row.fseiban);
}

export async function replaceDueManagementGlobalRank(params: {
  locationKey: string;
  targetLocation?: string;
  actorClientKey?: string | null;
  scope?: RankingScope;
  temporaryTtlMinutes?: number;
  orderedFseibans: string[];
  sourceType?: 'auto' | 'manual';
}): Promise<string[]> {
  const scope = params.scope ?? 'globalShared';
  if (scope === 'localTemporary') {
    const orderedFseibans = normalizeFseibans(params.orderedFseibans);
    const ttlMinutes = params.temporaryTtlMinutes ?? LOCAL_TEMPORARY_OVERRIDE_TTL_MINUTES;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const targetLocation = params.targetLocation ?? params.locationKey;
    try {
      await prisma.productionScheduleGlobalRankTemporaryOverride.upsert({
        where: {
          csvDashboardId_targetLocation: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            targetLocation
          }
        },
        create: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          targetLocation,
          orderedFseibans,
          actorClientKey: params.actorClientKey ?? null,
          expiresAt
        },
        update: {
          orderedFseibans,
          actorClientKey: params.actorClientKey ?? null,
          expiresAt
        }
      });
    } catch (error) {
      if (!isMissingTemporaryOverrideTableError(error)) {
        throw error;
      }
      fallbackTemporaryOverrides.set(`${PRODUCTION_SCHEDULE_DASHBOARD_ID}::${targetLocation}`, {
        orderedFseibans,
        expiresAt
      });
    }
    return orderedFseibans;
  }
  const writeLocation =
    scope === 'locationScoped'
      ? params.locationKey
      : params.locationKey;
  return replaceGlobalRankInternal({
    locationKey: writeLocation,
    orderedFseibans: params.orderedFseibans,
    sourceType: params.sourceType
  });
}

export async function mergeDueManagementGlobalRank(params: {
  locationKey: string;
  targetLocation?: string;
  scope?: RankingScope;
  prioritizedFseibans: string[];
}): Promise<string[]> {
  const prioritized = normalizeFseibans(params.prioritizedFseibans);
  const existing = await listDueManagementGlobalRank({
    locationKey: params.locationKey,
    targetLocation: params.targetLocation,
    scope: params.scope
  });
  const merged = [...prioritized, ...existing.filter((fseiban) => !prioritized.includes(fseiban))];
  return replaceGlobalRankInternal({
    locationKey:
      (params.scope ?? 'globalShared') === 'locationScoped'
        ? params.locationKey
        : params.locationKey,
    orderedFseibans: merged,
    sourceType: 'manual'
  });
}
