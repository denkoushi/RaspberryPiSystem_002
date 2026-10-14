import {
  GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS,
  GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS,
  type GrindingPlanningBoardResourceCapacityResponse,
  type GrindingPlanningBoardResourceDailyHours
} from '@raspi-system/shared-types';

import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

export async function getGrindingPlanningBoardResourceCapacity(params: {
  siteKey: string;
}): Promise<GrindingPlanningBoardResourceCapacityResponse> {
  const rows = await prisma.productionScheduleGrindingPlanningBoardResourceCapacity.findMany({
    where: { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey },
    select: { resourceCd: true, dailyHours: true }
  });
  return {
    dailyHoursByResource: Object.fromEntries(rows.filter((row) =>
      row.dailyHours !== GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS
      && GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.includes(row.dailyHours as GrindingPlanningBoardResourceDailyHours)
    ).map((row) => [row.resourceCd, row.dailyHours as GrindingPlanningBoardResourceDailyHours]))
  };
}

export async function updateGrindingPlanningBoardResourceCapacity(params: {
  siteKey: string;
  resourceCd: string;
  dailyHours: GrindingPlanningBoardResourceDailyHours;
}): Promise<GrindingPlanningBoardResourceCapacityResponse> {
  const resourceCd = params.resourceCd.trim();
  if (!resourceCd || resourceCd.length > 20) {
    throw new ApiError(400, '資源コードは1〜20文字で指定してください');
  }
  if (!GRINDING_PLANNING_BOARD_RESOURCE_DAILY_HOURS.includes(params.dailyHours)) {
    throw new ApiError(400, '日次稼働時間は8、10、24のいずれかで指定してください');
  }
  const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, resourceCd };
  if (params.dailyHours === GRINDING_PLANNING_BOARD_DEFAULT_RESOURCE_DAILY_HOURS) {
    await prisma.productionScheduleGrindingPlanningBoardResourceCapacity.deleteMany({ where: key });
  } else {
    await prisma.productionScheduleGrindingPlanningBoardResourceCapacity.upsert({
      where: { csvDashboardId_siteKey_resourceCd: key },
      create: { ...key, dailyHours: params.dailyHours },
      update: { dailyHours: params.dailyHours }
    });
  }
  return getGrindingPlanningBoardResourceCapacity({ siteKey: params.siteKey });
}
