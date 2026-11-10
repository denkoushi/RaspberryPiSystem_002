import {
  GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS,
  GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS,
  type GrindingPlanningBoardResourceCapacityResponse,
  type GrindingPlanningBoardResourceDailyHours
} from '@raspi-system/shared-types';

import type { Prisma } from '@prisma/client';
import { z } from 'zod';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { defaultUnitSplitEnabled } from './sessaku-pieces/unit-split-policy.js';

export const resourceCdSchema = z.string().trim().min(1).max(20);
export const resourceCapacityBodySchema = z.object({
  resourceCd: resourceCdSchema,
  dailyHours: z.union([z.literal(8), z.literal(10), z.literal(24)]).optional(),
  runsThroughBreaks: z.boolean().optional(),
  unitSplitEnabled: z.boolean().nullable().optional()
}).refine((body) => body.dailyHours !== undefined || body.runsThroughBreaks !== undefined || body.unitSplitEnabled !== undefined,
  { message: '稼働時間、休憩設定または1台ずつ設定を指定してください' });

export async function getGrindingPlanningBoardResourceCapacity(params: {
  siteKey: string;
}, client: Pick<Prisma.TransactionClient, 'productionScheduleGrindingPlanningBoardResourceCapacity'> = prisma): Promise<GrindingPlanningBoardResourceCapacityResponse> {
  const rows = await client.productionScheduleGrindingPlanningBoardResourceCapacity.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey },
    select: { resourceCd: true, dailyHours: true, runsThroughBreaks: true, unitSplitEnabled: true }
  });
  return {
    unitSplitEnabledByResource: { '021': true, '022': true, ...Object.fromEntries(rows.map((row) => [row.resourceCd, row.unitSplitEnabled ?? defaultUnitSplitEnabled(row.resourceCd)])) },
    dailyHoursByResource: Object.fromEntries(rows.filter((row) =>
      row.dailyHours !== GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS
      && GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.includes(row.dailyHours as GrindingPlanningBoardResourceDailyHours)
    ).map((row) => [row.resourceCd, row.dailyHours as GrindingPlanningBoardResourceDailyHours])),
    runsThroughBreaksResources: rows.filter((row) => row.runsThroughBreaks).map((row) => row.resourceCd)
  };
}

export async function updateGrindingPlanningBoardResourceCapacity(params: {
  siteKey: string;
  resourceCd: string;
  dailyHours?: GrindingPlanningBoardResourceDailyHours;
  runsThroughBreaks?: boolean;
  unitSplitEnabled?: boolean | null;
}): Promise<GrindingPlanningBoardResourceCapacityResponse> {
  const parsed = resourceCapacityBodySchema.safeParse(params);
  if (!parsed.success) throw new ApiError(400, '資源設定が不正です');
  const resourceCd = parsed.data.resourceCd;
  const unitSplitEnabled = params.unitSplitEnabled === defaultUnitSplitEnabled(resourceCd) ? null : params.unitSplitEnabled;
  const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, resourceCd };
  await prisma.productionScheduleGrindingPlanningBoardResourceCapacity.upsert({
    where: { csvDashboardId_siteKey_resourceCd: key },
    create: { ...key, dailyHours: params.dailyHours ?? GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS,
      runsThroughBreaks: params.runsThroughBreaks ?? false, unitSplitEnabled: unitSplitEnabled ?? null },
    update: { ...(params.dailyHours !== undefined ? { dailyHours: params.dailyHours } : {}),
      ...(params.runsThroughBreaks !== undefined ? { runsThroughBreaks: params.runsThroughBreaks } : {}),
      ...(unitSplitEnabled !== undefined ? { unitSplitEnabled } : {}) }
  });
  await prisma.productionScheduleGrindingPlanningBoardResourceCapacity.deleteMany({
    where: { ...key, dailyHours: GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS, runsThroughBreaks: false,
      OR: [{ unitSplitEnabled: null }, { unitSplitEnabled: defaultUnitSplitEnabled(resourceCd) }] }
  });
  return getGrindingPlanningBoardResourceCapacity({ siteKey: params.siteKey });
}
