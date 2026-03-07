import bcrypt from 'bcryptjs';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import {
  DEFAULT_CUTTING_EXCLUDED_RESOURCE_CDS
} from './policies/resource-category-policy.service.js';

const normalizeLocation = (location: string): string => location.trim();
const LEGACY_DUE_MANAGEMENT_PASSWORD = '2520';
export const SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION = 'shared';
const DEFAULT_PROCESSING_TYPE_OPTIONS = [
  { code: '塗装', label: '塗装', priority: 1, enabled: true },
  { code: 'カニゼン', label: 'カニゼン', priority: 2, enabled: true },
  { code: 'LSLH', label: 'LSLH', priority: 3, enabled: true },
  { code: 'その他01', label: 'その他01', priority: 4, enabled: true },
  { code: 'その他02', label: 'その他02', priority: 5, enabled: true }
] as const;

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

type ProcessingTypeOption = {
  code: string;
  label: string;
  priority: number;
  enabled: boolean;
};

const normalizeProcessingTypeOptions = (options: ProcessingTypeOption[]): ProcessingTypeOption[] => {
  const unique = new Set<string>();
  const next: ProcessingTypeOption[] = [];
  for (const option of options) {
    const code = option.code.trim();
    if (code.length === 0 || unique.has(code)) continue;
    unique.add(code);
    next.push({
      code,
      label: option.label.trim() || code,
      priority: Number.isFinite(option.priority) ? option.priority : 999,
      enabled: option.enabled
    });
  }
  return next.sort((a, b) => a.priority - b.priority || a.code.localeCompare(b.code));
};

export async function getProductionScheduleProcessingTypeOptions(location: string): Promise<{
  location: string;
  options: ProcessingTypeOption[];
}> {
  const normalizedLocation = normalizeLocation(location);
  const options = await prisma.productionScheduleProcessingTypeOption.findMany({
    where: { location: normalizedLocation },
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
    select: { code: true, label: true, priority: true, enabled: true }
  });
  const normalizedOptions = normalizeProcessingTypeOptions(
    (options.length > 0 ? options : [...DEFAULT_PROCESSING_TYPE_OPTIONS]).map((option) => ({
      code: option.code,
      label: option.label,
      priority: option.priority,
      enabled: option.enabled
    }))
  );
  return {
    location: normalizedLocation,
    options: normalizedOptions
  };
}

export async function upsertProductionScheduleProcessingTypeOptions(params: {
  location: string;
  options: ProcessingTypeOption[];
}): Promise<{ location: string; options: ProcessingTypeOption[] }> {
  const location = normalizeLocation(params.location);
  const options = normalizeProcessingTypeOptions(params.options);

  await prisma.$transaction(async (tx) => {
    for (const option of options) {
      await tx.productionScheduleProcessingTypeOption.upsert({
        where: {
          location_code: {
            location,
            code: option.code
          }
        },
        create: {
          location,
          code: option.code,
          label: option.label,
          priority: option.priority,
          enabled: option.enabled
        },
        update: {
          label: option.label,
          priority: option.priority,
          enabled: option.enabled
        }
      });
    }
  });

  return getProductionScheduleProcessingTypeOptions(location);
}

export async function getDueManagementAccessPasswordSettings(location: string): Promise<{
  location: string;
  configured: boolean;
  defaultPasswordActive: boolean;
}> {
  const normalizedLocation = normalizeLocation(location);
  const config = await prisma.productionScheduleAccessPasswordConfig.findUnique({
    where: { location: normalizedLocation },
    select: { id: true }
  });
  return {
    location: normalizedLocation,
    configured: Boolean(config),
    defaultPasswordActive: !config
  };
}

export async function upsertDueManagementAccessPassword(params: {
  location: string;
  password: string;
}): Promise<{ location: string; configured: boolean; defaultPasswordActive: boolean }> {
  const location = normalizeLocation(params.location);
  const password = params.password.trim();
  if (password.length === 0) {
    throw new Error('パスワードは必須です');
  }
  const dueManagementPasswordHash = await bcrypt.hash(password, 10);
  await prisma.productionScheduleAccessPasswordConfig.upsert({
    where: { location },
    create: {
      location,
      dueManagementPasswordHash
    },
    update: {
      dueManagementPasswordHash
    }
  });
  return {
    location,
    configured: true,
    defaultPasswordActive: false
  };
}

export async function verifyDueManagementAccessPassword(params: {
  location: string;
  password: string;
}): Promise<{ success: boolean }> {
  const location = normalizeLocation(params.location);
  const password = params.password;
  if (password.trim().length === 0) {
    return { success: false };
  }
  const config = await prisma.productionScheduleAccessPasswordConfig.findUnique({
    where: { location },
    select: { dueManagementPasswordHash: true }
  });
  if (!config) {
    return { success: password === LEGACY_DUE_MANAGEMENT_PASSWORD };
  }
  const success = await bcrypt.compare(password, config.dueManagementPasswordHash);
  return { success };
}
