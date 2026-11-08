import type { Prisma } from '@prisma/client';
import type {
  GrindingPlanningBoardResourceMinutesResponse,
  GrindingPlanningBoardResourceMinutesSourceRequest,
  GrindingPlanningBoardResourcePartMinutesRequest
} from '@raspi-system/shared-types';
import { z } from 'zod';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

// MachinePalletItem already stores production-schedule FHINCD in VARCHAR(120).
const resourceCdSchema = z.string().trim().min(1).max(20);
export const resourceMinutesSourceSchema = z.object({
  resourceCd: resourceCdSchema,
  source: z.enum(['original', 'own'])
});
export const resourcePartMinutesSchema = z.object({
  resourceCd: resourceCdSchema,
  fhincd: z.string().trim().min(1).max(120),
  perUnitMinutes: z.number().finite().min(0).max(100000).nullable(),
  setupMinutes: z.number().int().min(0).max(100000)
});

type MinutesClient = Pick<Prisma.TransactionClient,
  'productionScheduleGrindingPlanningBoardResourceMinutesSource' | 'productionScheduleGrindingPlanningBoardResourcePartMinutes'>;

export async function getGrindingPlanningBoardResourceMinutes(
  params: { siteKey: string }, client: MinutesClient = prisma
): Promise<GrindingPlanningBoardResourceMinutesResponse> {
  const where = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey };
  const [sources, values] = await Promise.all([
    client.productionScheduleGrindingPlanningBoardResourceMinutesSource.findMany({
      where, select: { resourceCd: true }, orderBy: { resourceCd: 'asc' }
    }),
    client.productionScheduleGrindingPlanningBoardResourcePartMinutes.findMany({
      where, select: { resourceCd: true, fhincd: true, perUnitMinutes: true, setupMinutes: true },
      orderBy: [{ resourceCd: 'asc' }, { fhincd: 'asc' }]
    })
  ]);
  return { ownSourceResourceCds: sources.map((row) => row.resourceCd), values };
}

export async function updateGrindingPlanningBoardResourceMinutesSource(
  params: GrindingPlanningBoardResourceMinutesSourceRequest & { siteKey: string }
): Promise<GrindingPlanningBoardResourceMinutesResponse> {
  const { resourceCd, source } = resourceMinutesSourceSchema.parse(params);
  const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, resourceCd };
  if (source === 'original') {
    await prisma.productionScheduleGrindingPlanningBoardResourceMinutesSource.deleteMany({ where: key });
  } else {
    await prisma.productionScheduleGrindingPlanningBoardResourceMinutesSource.upsert({
      where: { csvDashboardId_siteKey_resourceCd: key }, create: { ...key, source }, update: { source }
    });
  }
  return getGrindingPlanningBoardResourceMinutes(params);
}

export async function updateGrindingPlanningBoardResourcePartMinutes(
  params: GrindingPlanningBoardResourcePartMinutesRequest & { siteKey: string }
): Promise<GrindingPlanningBoardResourceMinutesResponse> {
  const { resourceCd, fhincd, perUnitMinutes, setupMinutes } = resourcePartMinutesSchema.parse(params);
  const key = { csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID, siteKey: params.siteKey, resourceCd, fhincd };
  if (perUnitMinutes === null) {
    await prisma.productionScheduleGrindingPlanningBoardResourcePartMinutes.deleteMany({ where: key });
  } else {
    await prisma.productionScheduleGrindingPlanningBoardResourcePartMinutes.upsert({
      where: { csvDashboardId_siteKey_resourceCd_fhincd: key },
      create: { ...key, perUnitMinutes, setupMinutes }, update: { perUnitMinutes, setupMinutes }
    });
  }
  return getGrindingPlanningBoardResourceMinutes(params);
}
