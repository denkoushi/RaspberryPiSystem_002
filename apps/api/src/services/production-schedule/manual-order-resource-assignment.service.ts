import { Prisma } from '@prisma/client';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import {
  assertRegisteredDeviceScopeKey,
  MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY
} from '../../lib/manual-order-device-scope.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

const MAX_ASSIGNMENTS_PER_DEVICE = 80;

export type ManualOrderResourceAssignmentDevicePayload = {
  deviceScopeKey: string;
  resourceCds: string[];
};

export async function listManualOrderResourceAssignmentsForSite(siteKey: string): Promise<ManualOrderResourceAssignmentDevicePayload[]> {
  const normalizedSite = siteKey.trim();
  if (!normalizedSite) {
    return [];
  }

  const rows = await prisma.productionScheduleManualOrderResourceAssignment.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      siteKey: normalizedSite
    },
    orderBy: [{ deviceScopeKey: 'asc' }, { priority: 'asc' }],
    select: {
      deviceScopeKey: true,
      resourceCd: true,
      priority: true
    }
  });

  const byDevice = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.deviceScopeKey.trim();
    const list = byDevice.get(key) ?? [];
    list.push(row.resourceCd.trim());
    byDevice.set(key, list);
  }

  return Array.from(byDevice.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'ja'))
    .map(([deviceScopeKey, resourceCds]) => ({ deviceScopeKey, resourceCds }));
}

function normalizeResourceCdList(resourceCds: unknown): string[] {
  if (!Array.isArray(resourceCds)) {
    throw new ApiError(400, 'resourceCds は配列で指定してください', undefined, 'RESOURCE_CDS_INVALID');
  }
  if (resourceCds.length > MAX_ASSIGNMENTS_PER_DEVICE) {
    throw new ApiError(
      400,
      `資源の割り当ては1端末あたり最大${MAX_ASSIGNMENTS_PER_DEVICE}件です`,
      undefined,
      'RESOURCE_CDS_TOO_MANY'
    );
  }
  const normalized: string[] = [];
  for (const item of resourceCds) {
    if (typeof item !== 'string') {
      throw new ApiError(400, 'resourceCds の要素は文字列である必要があります', undefined, 'RESOURCE_CDS_INVALID');
    }
    const t = item.trim();
    if (!t) continue;
    if (t.length > 40) {
      throw new ApiError(400, '資源CDが長すぎます', undefined, 'RESOURCE_CD_INVALID');
    }
    normalized.push(t);
  }
  const uniq = new Set(normalized);
  if (uniq.size !== normalized.length) {
    throw new ApiError(400, '同一資源CDを重複して指定できません', undefined, 'RESOURCE_CDS_DUPLICATE');
  }
  return normalized;
}

export async function replaceManualOrderResourceAssignmentsForDevice(params: {
  siteKey: string;
  deviceScopeKey: string;
  resourceCds: unknown;
}): Promise<ManualOrderResourceAssignmentDevicePayload> {
  const siteKey = params.siteKey.trim();
  const deviceScopeKey = params.deviceScopeKey.trim();
  if (!siteKey) {
    throw new ApiError(400, 'siteKey が不正です', undefined, 'SITE_KEY_INVALID');
  }
  if (!deviceScopeKey) {
    throw new ApiError(400, 'deviceScopeKey が不正です', undefined, 'DEVICE_SCOPE_KEY_INVALID');
  }

  if (deviceScopeKey !== MANUAL_ORDER_LEGACY_SITE_BUCKET_KEY) {
    await assertRegisteredDeviceScopeKey(deviceScopeKey);
  }

  const resourceCds = normalizeResourceCdList(params.resourceCds);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.productionScheduleManualOrderResourceAssignment.deleteMany({
        where: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          siteKey,
          deviceScopeKey
        }
      });

      for (let i = 0; i < resourceCds.length; i++) {
        const resourceCd = resourceCds[i]!;
        const priority = i + 1;
        const takenElsewhere = await tx.productionScheduleManualOrderResourceAssignment.findFirst({
          where: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            siteKey,
            resourceCd,
            deviceScopeKey: { not: deviceScopeKey }
          },
          select: { id: true }
        });
        if (takenElsewhere) {
          throw new ApiError(
            409,
            '指定した資源CDは他の端末に割り当て済みです',
            { resourceCd },
            'RESOURCE_ALREADY_ASSIGNED'
          );
        }
        await tx.productionScheduleManualOrderResourceAssignment.create({
          data: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            siteKey,
            deviceScopeKey,
            resourceCd,
            priority
          }
        });
      }
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ApiError(
        409,
        '指定した資源CDは他の端末に割り当て済みです',
        undefined,
        'RESOURCE_ALREADY_ASSIGNED'
      );
    }
    throw err;
  }

  return { deviceScopeKey, resourceCds };
}
