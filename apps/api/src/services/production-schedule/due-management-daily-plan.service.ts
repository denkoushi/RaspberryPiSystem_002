import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const normalizeFseibans = (items: string[]): string[] => {
  const unique = new Set<string>();
  const next: string[] = [];
  for (const raw of items) {
    const value = raw.trim();
    if (!value || unique.has(value)) continue;
    unique.add(value);
    next.push(value);
  }
  return next.slice(0, 2000);
};

const getTodayPlanDate = (): Date => {
  const now = new Date();
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS);
  const year = jstNow.getUTCFullYear();
  const month = `${jstNow.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${jstNow.getUTCDate()}`.padStart(2, '0');
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
};

const toDateKey = (date: Date): string => date.toISOString().slice(0, 10);

export type DueManagementDailyPlan = {
  planDate: string;
  status: string;
  confirmedAt: string | null;
  updatedAt: string | null;
  orderedFseibans: string[];
};

export async function getDueManagementDailyPlan(locationKey: string): Promise<DueManagementDailyPlan> {
  const planDate = getTodayPlanDate();
  const plan = await prisma.productionScheduleDailyPlan.findUnique({
    where: {
      csvDashboardId_location_planDate: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        planDate
      }
    },
    include: {
      items: {
        orderBy: [{ priorityOrder: 'asc' }, { fseiban: 'asc' }],
        select: { fseiban: true }
      }
    }
  });

  return {
    planDate: toDateKey(planDate),
    status: plan?.status ?? 'draft',
    confirmedAt: plan?.confirmedAt?.toISOString() ?? null,
    updatedAt: plan?.updatedAt?.toISOString() ?? null,
    orderedFseibans: plan?.items.map((item) => item.fseiban) ?? []
  };
}

export async function replaceDueManagementDailyPlan(params: {
  locationKey: string;
  orderedFseibans: string[];
}): Promise<DueManagementDailyPlan> {
  const { locationKey } = params;
  const orderedFseibans = normalizeFseibans(params.orderedFseibans);
  const planDate = getTodayPlanDate();

  const result = await prisma.$transaction(async (tx) => {
    const plan = await tx.productionScheduleDailyPlan.upsert({
      where: {
        csvDashboardId_location_planDate: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: locationKey,
          planDate
        }
      },
      create: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        planDate,
        status: 'draft'
      },
      update: {
        status: 'draft',
        confirmedAt: null
      },
      select: {
        id: true,
        status: true,
        confirmedAt: true,
        updatedAt: true
      }
    });

    await tx.productionScheduleDailyPlanItem.deleteMany({
      where: {
        planId: plan.id
      }
    });

    if (orderedFseibans.length > 0) {
      await tx.productionScheduleDailyPlanItem.createMany({
        data: orderedFseibans.map((fseiban, index) => ({
          planId: plan.id,
          fseiban,
          priorityOrder: index + 1
        }))
      });
    }

    return plan;
  });

  return {
    planDate: toDateKey(planDate),
    status: result.status,
    confirmedAt: result.confirmedAt?.toISOString() ?? null,
    updatedAt: result.updatedAt?.toISOString() ?? null,
    orderedFseibans
  };
}
