import crypto from 'crypto';
import { AlertChannel, AlertDeliveryStatus, AlertSeverity } from '@prisma/client';
import { logger } from '../../lib/logger.js';
import { loadAlertsDispatcherConfig, resolveRouteKey } from '../alerts/alerts-config.js';

import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';

import { resolveSiteKeyForScopeKey } from '../../lib/site-directory.js';
import { prisma } from '../../lib/prisma.js';
import { ApiError } from '../../lib/errors.js';
import { toUpperTrimmedCode as normalizeResourceCd } from '../../lib/string-normalize.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import {
  DEFAULT_CUTTING_EXCLUDED_RESOURCE_CDS,
  SHARED_RESOURCE_CATEGORY_LOCATION,
  normalizeProductionScheduleResourceCdList
} from './policies/resource-category-policy.service.js';

const normalizeLocation = (location: string): string => location.trim();
const normalizeSiteLocation = (location: string): string => resolveSiteKeyForScopeKey(normalizeLocation(location));
export const SHARED_DUE_MANAGEMENT_PASSWORD_LOCATION = 'shared';
export const ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT = 10;
export const ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT = 50;
export const ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS = 60_000;
const DEFAULT_PROCESSING_TYPE_OPTIONS = [
  { code: '塗装', label: '塗装', priority: 1, enabled: true },
  { code: 'カニゼン', label: 'カニゼン', priority: 2, enabled: true },
  { code: 'LSLH', label: 'LSLH', priority: 3, enabled: true },
  { code: 'その他01', label: 'その他01', priority: 4, enabled: true },
  { code: 'その他02', label: 'その他02', priority: 5, enabled: true }
] as const;

const normalizeGroupCd = (value: string): string => value.trim().toUpperCase();
const normalizeCsvHeader = (value: string): string => value.replace(/^\uFEFF/, '').trim().toUpperCase();

export async function getProductionScheduleResourceCategorySettings(location: string): Promise<{
  location: string;
  cuttingExcludedResourceCds: string[];
}> {
  const normalizedLocation = normalizeSiteLocation(location);
  const readConfigByLocation = (targetLocation: string) =>
    prisma.productionScheduleResourceCategoryConfig.findUnique({
      where: {
        csvDashboardId_location: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: targetLocation
        }
      },
      select: {
        cuttingExcludedResourceCds: true
      }
    });
  let config = await readConfigByLocation(normalizedLocation);
  if (!config && normalizedLocation !== SHARED_RESOURCE_CATEGORY_LOCATION) {
    config = await readConfigByLocation(SHARED_RESOURCE_CATEGORY_LOCATION);
  }

  return {
    location: normalizedLocation,
    cuttingExcludedResourceCds: normalizeProductionScheduleResourceCdList(
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
  const location = normalizeSiteLocation(params.location);
  const cuttingExcludedResourceCds = normalizeProductionScheduleResourceCdList(params.cuttingExcludedResourceCds);

  const updated = await prisma.$transaction(async (tx) => {
    const upsertByLocation = (targetLocation: string) =>
      tx.productionScheduleResourceCategoryConfig.upsert({
        where: {
          csvDashboardId_location: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            location: targetLocation
          }
        },
        create: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: targetLocation,
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

    const siteUpdated = await upsertByLocation(location);
    if (location !== SHARED_RESOURCE_CATEGORY_LOCATION) {
      await upsertByLocation(SHARED_RESOURCE_CATEGORY_LOCATION);
    }
    return siteUpdated;
  });

  return {
    location: updated.location,
    cuttingExcludedResourceCds: normalizeProductionScheduleResourceCdList(updated.cuttingExcludedResourceCds)
  };
}

export async function listProductionScheduleResourceCategorySettingsLocations(): Promise<string[]> {
  const [locations, configLocations, mappingLocations] = await Promise.all([
    prisma.clientDevice.findMany({
      select: { location: true }
    }),
    prisma.productionScheduleResourceCategoryConfig.findMany({
      where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID },
      select: { location: true }
    }),
    prisma.productionScheduleResourceCodeMapping.findMany({
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
  for (const row of mappingLocations) {
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

export type ProductionScheduleResourceCodeMappingItem = {
  fromResourceCd: string;
  toResourceCd: string;
  priority: number;
  enabled: boolean;
};

export type ResourceCodeMappingsCsvImportResult = {
  location: string;
  dryRun: boolean;
  totalRows: number;
  rowsWithGroupCd: number;
  generatedMappings: number;
  skippedEmptyRows: number;
  skippedDuplicateRows: number;
  skippedUnknownResourceCds: string[];
  settings?: {
    location: string;
    mappings: ProductionScheduleResourceCodeMappingItem[];
  };
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

const normalizeResourceCodeMappings = (
  mappings: ProductionScheduleResourceCodeMappingItem[]
): ProductionScheduleResourceCodeMappingItem[] => {
  const unique = new Set<string>();
  const next: ProductionScheduleResourceCodeMappingItem[] = [];
  for (const mapping of mappings) {
    const fromResourceCd = mapping.fromResourceCd.trim().toUpperCase();
    const toResourceCd = mapping.toResourceCd.trim().toUpperCase();
    if (!fromResourceCd || !toResourceCd) continue;
    const key = `${fromResourceCd}__${toResourceCd}`;
    if (unique.has(key)) continue;
    unique.add(key);
    next.push({
      fromResourceCd,
      toResourceCd,
      priority: Number.isFinite(mapping.priority) ? mapping.priority : 999,
      enabled: mapping.enabled
    });
  }
  return next.sort(
    (a, b) =>
      a.fromResourceCd.localeCompare(b.fromResourceCd) ||
      a.priority - b.priority ||
      a.toResourceCd.localeCompare(b.toResourceCd)
  );
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

export async function getProductionScheduleResourceCodeMappings(location: string): Promise<{
  location: string;
  mappings: ProductionScheduleResourceCodeMappingItem[];
}> {
  const normalizedLocation = normalizeLocation(location);
  const mappings = await prisma.productionScheduleResourceCodeMapping.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: normalizedLocation
    },
    orderBy: [{ fromResourceCd: 'asc' }, { priority: 'asc' }, { toResourceCd: 'asc' }],
    select: {
      fromResourceCd: true,
      toResourceCd: true,
      priority: true,
      enabled: true
    }
  });
  return {
    location: normalizedLocation,
    mappings: normalizeResourceCodeMappings(mappings)
  };
}

export async function upsertProductionScheduleResourceCodeMappings(params: {
  location: string;
  mappings: ProductionScheduleResourceCodeMappingItem[];
}): Promise<{ location: string; mappings: ProductionScheduleResourceCodeMappingItem[] }> {
  const location = normalizeLocation(params.location);
  const mappings = normalizeResourceCodeMappings(params.mappings);
  await prisma.$transaction(async (tx) => {
    await tx.productionScheduleResourceCodeMapping.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location
      }
    });
    if (mappings.length > 0) {
      await tx.productionScheduleResourceCodeMapping.createMany({
        data: mappings.map((mapping) => ({
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location,
          fromResourceCd: mapping.fromResourceCd,
          toResourceCd: mapping.toResourceCd,
          priority: mapping.priority,
          enabled: mapping.enabled
        }))
      });
    }
  });
  return getProductionScheduleResourceCodeMappings(location);
}

export async function importProductionScheduleResourceCodeMappingsFromCsv(params: {
  location: string;
  csvText: string;
  dryRun: boolean;
}): Promise<ResourceCodeMappingsCsvImportResult> {
  const location = normalizeLocation(params.location);
  const dryRun = params.dryRun;
  const parsedRows = parse(params.csvText, {
    columns: (headers: string[]) => headers.map((header) => normalizeCsvHeader(header)),
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true
  }) as Array<Record<string, string | undefined>>;

  let skippedEmptyRows = 0;
  let skippedDuplicateRows = 0;
  const unknownResourceCdSet = new Set<string>();
  const groupToResourceSetMap = new Map<string, Set<string>>();
  const csvPairs = new Set<string>();
  const resourceCdSet = new Set<string>();

  for (const row of parsedRows) {
    const resourceCd = normalizeResourceCd(row.FSIGENCD ?? '');
    const groupCd = normalizeGroupCd(row.GROUPCD ?? '');
    if (!resourceCd || !groupCd) {
      skippedEmptyRows += 1;
      continue;
    }
    const pairKey = `${resourceCd}__${groupCd}`;
    if (csvPairs.has(pairKey)) {
      skippedDuplicateRows += 1;
      continue;
    }
    csvPairs.add(pairKey);
    resourceCdSet.add(resourceCd);
    const currentSet = groupToResourceSetMap.get(groupCd) ?? new Set<string>();
    currentSet.add(resourceCd);
    groupToResourceSetMap.set(groupCd, currentSet);
  }

  const resourceCds = Array.from(resourceCdSet);
  const existingRows = await prisma.productionScheduleResourceMaster.findMany({
    where: {
      resourceCd: {
        in: resourceCds
      }
    },
    select: {
      resourceCd: true
    }
  });
  const existingResourceCdSet = new Set(existingRows.map((row) => normalizeResourceCd(row.resourceCd)));
  const validGroupToResourceMap = new Map<string, string[]>();
  groupToResourceSetMap.forEach((resourceSet, groupCd) => {
    const validResourceCds = Array.from(resourceSet)
      .filter((resourceCd) => {
        const isValid = existingResourceCdSet.has(resourceCd);
        if (!isValid) {
          unknownResourceCdSet.add(resourceCd);
        }
        return isValid;
      })
      .sort((a, b) => a.localeCompare(b));
    if (validResourceCds.length >= 2) {
      validGroupToResourceMap.set(groupCd, validResourceCds);
    }
  });

  const mappings: ProductionScheduleResourceCodeMappingItem[] = [];
  for (const resourceCdsInGroup of validGroupToResourceMap.values()) {
    for (const fromResourceCd of resourceCdsInGroup) {
      let priority = 1;
      for (const toResourceCd of resourceCdsInGroup) {
        if (fromResourceCd === toResourceCd) continue;
        mappings.push({
          fromResourceCd,
          toResourceCd,
          priority,
          enabled: true
        });
        priority += 1;
      }
    }
  }

  const normalizedMappings = normalizeResourceCodeMappings(mappings);
  if (dryRun) {
    return {
      location,
      dryRun: true,
      totalRows: parsedRows.length,
      rowsWithGroupCd: csvPairs.size,
      generatedMappings: normalizedMappings.length,
      skippedEmptyRows,
      skippedDuplicateRows,
      skippedUnknownResourceCds: Array.from(unknownResourceCdSet).sort((a, b) => a.localeCompare(b))
    };
  }

  const settings = await upsertProductionScheduleResourceCodeMappings({
    location,
    mappings: normalizedMappings
  });
  return {
    location,
    dryRun: false,
    totalRows: parsedRows.length,
    rowsWithGroupCd: csvPairs.size,
    generatedMappings: normalizedMappings.length,
    skippedEmptyRows,
    skippedDuplicateRows,
    skippedUnknownResourceCds: Array.from(unknownResourceCdSet).sort((a, b) => a.localeCompare(b)),
    settings
  };
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
    defaultPasswordActive: false
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
  const passwordChangedAt = new Date();
  await prisma.productionScheduleAccessPasswordConfig.upsert({
    where: { location },
    create: {
      location,
      dueManagementPasswordHash,
      passwordChangedAt
    },
    update: {
      dueManagementPasswordHash,
      passwordChangedAt
    }
  });
  return {
    location,
    configured: true,
    defaultPasswordActive: false
  };
}

export type AccessPasswordCaller = { clientDeviceId?: string | null; ip?: string };

const accessPasswordRateLimited = () => new ApiError(429, '操作パスワードの試行回数が上限に達しました。しばらくしてから再試行してください', undefined, 'ACCESS_PASSWORD_RATE_LIMITED');

// The column stores UTC wall-clock time, so compare against UTC regardless of the session time zone.
async function reserveAccessPasswordAttempt(location: string, scope: string) {
  return prisma.$transaction(async (tx) => {
    const reservations: Array<{ scope: string; windowEndsAt: Date }> = [];
    // Always lock global before device, and roll back both when either limit is reached.
    for (const [key, limit] of [['global', ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT], [scope, ACCESS_PASSWORD_FAILED_ATTEMPT_LIMIT]] as const) {
      const rows = await tx.$queryRaw<Array<{ count: number; windowEndsAt: Date }>>`
        INSERT INTO "ProductionScheduleAccessPasswordAttempt" ("location", "scope", "count", "windowEndsAt", "updatedAt", "notified")
        VALUES (${location}, ${key}, 1, (statement_timestamp() AT TIME ZONE 'UTC') + ${ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS} * interval '1 millisecond', (statement_timestamp() AT TIME ZONE 'UTC'), false)
        ON CONFLICT ("location", "scope") DO UPDATE SET
          "count" = CASE WHEN "ProductionScheduleAccessPasswordAttempt"."windowEndsAt" <= (statement_timestamp() AT TIME ZONE 'UTC') THEN 1 ELSE "ProductionScheduleAccessPasswordAttempt"."count" + 1 END,
          "notified" = CASE WHEN "ProductionScheduleAccessPasswordAttempt"."windowEndsAt" <= (statement_timestamp() AT TIME ZONE 'UTC') THEN false ELSE "ProductionScheduleAccessPasswordAttempt"."notified" END,
          "windowEndsAt" = CASE WHEN "ProductionScheduleAccessPasswordAttempt"."windowEndsAt" <= (statement_timestamp() AT TIME ZONE 'UTC') THEN (statement_timestamp() AT TIME ZONE 'UTC') + ${ACCESS_PASSWORD_FAILED_ATTEMPT_WINDOW_MS} * interval '1 millisecond' ELSE "ProductionScheduleAccessPasswordAttempt"."windowEndsAt" END,
          "updatedAt" = (statement_timestamp() AT TIME ZONE 'UTC')
        WHERE "ProductionScheduleAccessPasswordAttempt"."windowEndsAt" <= (statement_timestamp() AT TIME ZONE 'UTC') OR "ProductionScheduleAccessPasswordAttempt"."count" < ${limit}
        RETURNING "count", "windowEndsAt"
      `;
      const row = rows[0];
      if (!row) throw accessPasswordRateLimited();
      reservations.push({ scope: key, windowEndsAt: row.windowEndsAt });
    }
    return reservations;
  }, { maxWait: 10_000, timeout: 10_000 });
}

// Notify only after a failed comparison has left the global window at its limit.
async function notifyAccessPasswordLimitIfReached(location: string, windowEndsAt: Date): Promise<void> {
  const type = 'operation-password-global-limit';
  const where = { location, scope: 'global', windowEndsAt };
  const claimed = await prisma.productionScheduleAccessPasswordAttempt.updateMany({
    where: { ...where, count: { gte: ACCESS_PASSWORD_GLOBAL_FAILED_ATTEMPT_LIMIT }, notified: false },
    data: { notified: true }
  });
  if (claimed.count === 0) return;
  try {
    const config = await loadAlertsDispatcherConfig();
    const routeKey = resolveRouteKey(type, config.routing);
    await prisma.alert.create({
      data: {
        id: crypto.randomUUID(), type, severity: AlertSeverity.WARNING,
        message: '操作パスワードの全体試行回数が上限に達しました',
        timestamp: new Date(), acknowledged: false,
        deliveries: { create: { channel: AlertChannel.SLACK, routeKey, status: AlertDeliveryStatus.PENDING, attemptCount: 0 } }
      }
    });
  } catch {
    logger.warn({ type }, 'Failed to create operation password limit alert');
    // Let a later failure in the same window try again.
    await prisma.productionScheduleAccessPasswordAttempt.updateMany({ where: { ...where, notified: true }, data: { notified: false } }).catch(() => undefined);
  }
}

type AccessPasswordVerifyParams = AccessPasswordCaller & {
  location: string;
  password: string;
};

export async function verifyDueManagementAccessPassword(params: AccessPasswordVerifyParams): Promise<{ success: boolean }> {
  const { success } = await verifyDueManagementAccessPasswordForToken(params);
  return { success };
}

/**
 * 照合に使ったパスワードの変更時刻も返す。確認済みの印に入れ、後でパスワードが変わったら印を無効にするために使う。
 */
export async function verifyDueManagementAccessPasswordForToken(
  params: AccessPasswordVerifyParams
): Promise<{ success: boolean; passwordChangedAt: Date | null }> {
  const location = normalizeLocation(params.location);
  const password = params.password;
  if (password.trim().length === 0) {
    return { success: false, passwordChangedAt: null };
  }
  const config = await prisma.productionScheduleAccessPasswordConfig.findUnique({
    where: { location },
    select: { dueManagementPasswordHash: true, passwordChangedAt: true }
  });
  if (!config) {
    return { success: false, passwordChangedAt: null };
  }
  const scope = params.clientDeviceId ? `device:${params.clientDeviceId}` : `ip:${params.ip ?? 'unknown'}`;
  const reservations = await reserveAccessPasswordAttempt(location, scope);
  const success = await bcrypt.compare(password, config.dueManagementPasswordHash);
  if (!success) {
    const global = reservations.find((reservation) => reservation.scope === 'global');
    if (global) await notifyAccessPasswordLimitIfReached(location, global.windowEndsAt);
  }
  if (success) {
    await prisma.$transaction(reservations.map((reservation) =>
      prisma.productionScheduleAccessPasswordAttempt.updateMany({
        where: { location, scope: reservation.scope, windowEndsAt: reservation.windowEndsAt, count: { gt: 0 } },
        data: { count: { decrement: 1 } }
      })
    ));
  }
  return { success, passwordChangedAt: config.passwordChangedAt ?? null };
}
