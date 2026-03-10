import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { listDueManagementGlobalRank } from './due-management-global-rank.service.js';

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeFseibans = (items: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of items) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= 2000) break;
  }
  return normalized;
};

const getJstDate = (offsetDays = 0): Date => {
  const now = new Date();
  const jstNow = new Date(now.getTime() + JST_OFFSET_MS + offsetDays * DAY_MS);
  const year = jstNow.getUTCFullYear();
  const month = `${jstNow.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${jstNow.getUTCDate()}`.padStart(2, '0');
  return new Date(`${year}-${month}-${day}T00:00:00.000Z`);
};

type CarryoverItem = {
  fseiban: string;
  isInTodayTriage: boolean;
  isCarryover: boolean;
};

export async function buildDueManagementDailyPlanSeed(params: {
  locationKey: string;
  selectedFseibans: string[];
}): Promise<{ orderedFseibans: string[]; items: CarryoverItem[] }> {
  const selected = normalizeFseibans(params.selectedFseibans);
  const selectedSet = new Set<string>(selected);

  const yesterdayPlanDate = getJstDate(-1);
  const yesterdayPlan = await prisma.productionScheduleDailyPlan.findUnique({
    where: {
      csvDashboardId_location_planDate: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: params.locationKey,
        planDate: yesterdayPlanDate
      }
    },
    include: {
      items: {
        orderBy: [{ priorityOrder: 'asc' }, { fseiban: 'asc' }],
        select: { fseiban: true }
      }
    }
  });

  const previousOrdered = yesterdayPlan?.items.map((item) => item.fseiban) ?? [];
  const globalOrdered = await listDueManagementGlobalRank({
    locationKey: params.locationKey,
    targetLocation: params.locationKey,
    scope: 'globalShared'
  });
  const base = normalizeFseibans([
    ...previousOrdered,
    ...globalOrdered,
    ...selected
  ]);

  const selectedOrdered = base.filter((fseiban) => selectedSet.has(fseiban));
  const carryovers = base.filter((fseiban) => !selectedSet.has(fseiban));
  const orderedFseibans = [...selectedOrdered, ...carryovers];

  const items = orderedFseibans.map((fseiban) => ({
    fseiban,
    isInTodayTriage: selectedSet.has(fseiban),
    isCarryover: !selectedSet.has(fseiban)
  }));

  return { orderedFseibans, items };
}
