import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

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

export async function getDueManagementTriageSelections(locationKey: string): Promise<string[]> {
  const rows = await prisma.productionScheduleTriageSelection.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey
    },
    orderBy: [{ selectedAt: 'desc' }, { fseiban: 'asc' }],
    select: {
      fseiban: true
    }
  });
  return rows.map((row) => row.fseiban);
}

export async function replaceDueManagementTriageSelections(params: {
  locationKey: string;
  selectedFseibans: string[];
}): Promise<string[]> {
  const { locationKey } = params;
  const selectedFseibans = normalizeFseibans(params.selectedFseibans);

  await prisma.$transaction(async (tx) => {
    await tx.productionScheduleTriageSelection.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: locationKey,
        ...(selectedFseibans.length > 0 ? { fseiban: { notIn: selectedFseibans } } : {})
      }
    });

    for (const fseiban of selectedFseibans) {
      await tx.productionScheduleTriageSelection.upsert({
        where: {
          csvDashboardId_location_fseiban: {
            csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
            location: locationKey,
            fseiban
          }
        },
        create: {
          csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
          location: locationKey,
          fseiban
        },
        update: {
          selectedAt: new Date()
        }
      });
    }
  });

  return selectedFseibans;
}
