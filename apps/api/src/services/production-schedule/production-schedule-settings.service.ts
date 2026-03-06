import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import {
  DEFAULT_CUTTING_EXCLUDED_RESOURCE_CDS
} from './policies/resource-category-policy.service.js';

const normalizeLocation = (location: string): string => location.trim();

const normalizeResourceCdList = (values: string[]): string[] => {
  const unique = new Set<string>();
  for (const raw of values) {
    const normalized = raw.trim();
    if (normalized.length === 0) continue;
    unique.add(normalized);
  }
  return Array.from(unique).sort((a, b) => a.localeCompare(b));
};

export async function getProductionScheduleResourceCategorySettings(location: string): Promise<{
  location: string;
  cuttingExcludedResourceCds: string[];
}> {
  const normalizedLocation = normalizeLocation(location);
  const config = await prisma.productionScheduleResourceCategoryConfig.findUnique({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: normalizedLocation
      }
    },
    select: {
      cuttingExcludedResourceCds: true
    }
  });

  return {
    location: normalizedLocation,
    cuttingExcludedResourceCds: normalizeResourceCdList(
      config?.cuttingExcludedResourceCds?.length
        ? config.cuttingExcludedResourceCds
        : [...DEFAULT_CUTTING_EXCLUDED_RESOURCE_CDS]
    )
  };
}

export async function upsertProductionScheduleResourceCategorySettings(params: {
  location: string;
  cuttingExcludedResourceCds: string[];
}): Promise<{ location: string; cuttingExcludedResourceCds: string[] }> {
  const location = normalizeLocation(params.location);
  const cuttingExcludedResourceCds = normalizeResourceCdList(params.cuttingExcludedResourceCds);

  const updated = await prisma.productionScheduleResourceCategoryConfig.upsert({
    where: {
      csvDashboardId_location: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location
      }
    },
    create: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location,
      cuttingExcludedResourceCds
    },
    update: {
      cuttingExcludedResourceCds
    },
    select: {
      location: true,
      cuttingExcludedResourceCds: true
    }
  });

  return {
    location: updated.location,
    cuttingExcludedResourceCds: normalizeResourceCdList(updated.cuttingExcludedResourceCds)
  };
}

export async function listProductionScheduleResourceCategorySettingsLocations(): Promise<string[]> {
  const [locations, configLocations] = await Promise.all([
    prisma.clientDevice.findMany({
      select: { location: true }
    }),
    prisma.productionScheduleResourceCategoryConfig.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { location: true }
    })
  ]);

  const values = new Set<string>();
  for (const row of locations) {
    const value = normalizeLocation(row.location ?? '');
    if (value.length > 0) values.add(value);
  }
  for (const row of configLocations) {
    const value = normalizeLocation(row.location);
    if (value.length > 0) values.add(value);
  }

  return Array.from(values).sort((a, b) => a.localeCompare(b));
}
