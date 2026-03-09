import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';
import { buildMaxProductNoWinnerCondition } from './row-resolver/index.js';

export type GlobalSeibanRankSeed = {
  fseiban: string;
  priorityOrder: number;
};

export type GlobalRowRankTargetRow = {
  csvDashboardRowId: string;
  fseiban: string;
  fhincd: string;
  fkojun: string;
  productNo: string;
  isCompleted: boolean;
};

export type GlobalRowRankPartPriority = {
  fseiban: string;
  fhincd: string;
  priorityRank: number;
};

export async function listGlobalSeibanRankSeeds(locationKey: string): Promise<GlobalSeibanRankSeed[]> {
  return prisma.productionScheduleGlobalRank.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: locationKey
    },
    orderBy: [{ priorityOrder: 'asc' }, { fseiban: 'asc' }],
    select: {
      fseiban: true,
      priorityOrder: true
    }
  });
}

export async function listGlobalRowRankTargets(params: {
  locationKey: string;
  targetFseibans: string[];
}): Promise<GlobalRowRankTargetRow[]> {
  const targetFseibans = Array.from(new Set(params.targetFseibans.map((value) => value.trim()).filter(Boolean)));
  if (targetFseibans.length === 0) {
    return [];
  }

  return prisma.$queryRaw<GlobalRowRankTargetRow[]>`
    SELECT
      "CsvDashboardRow"."id" AS "csvDashboardRowId",
      ("CsvDashboardRow"."rowData"->>'FSEIBAN') AS "fseiban",
      COALESCE(("CsvDashboardRow"."rowData"->>'FHINCD'), '') AS "fhincd",
      COALESCE(("CsvDashboardRow"."rowData"->>'FKOJUN'), '') AS "fkojun",
      COALESCE(("CsvDashboardRow"."rowData"->>'ProductNo'), '') AS "productNo",
      COALESCE("p"."isCompleted", FALSE) AS "isCompleted"
    FROM "CsvDashboardRow"
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "CsvDashboardRow"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND ("CsvDashboardRow"."rowData"->>'FSEIBAN') IN (${Prisma.join(
        targetFseibans.map((fseiban) => Prisma.sql`${fseiban}`),
        ','
      )})
  `;
}

export async function listGlobalRowRankPartPriorities(params: {
  locationKey: string;
  targetFseibans: string[];
}): Promise<GlobalRowRankPartPriority[]> {
  const targetFseibans = Array.from(new Set(params.targetFseibans.map((value) => value.trim()).filter(Boolean)));
  if (targetFseibans.length === 0) {
    return [];
  }

  return prisma.productionSchedulePartPriority.findMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: params.locationKey,
      fseiban: { in: targetFseibans }
    },
    select: {
      fseiban: true,
      fhincd: true,
      priorityRank: true
    }
  });
}

export async function replaceGlobalRowRanks(params: {
  locationKey: string;
  sourceType: 'auto' | 'manual';
  rankedRows: Array<{
    csvDashboardRowId: string;
    fseiban: string;
    globalRank: number;
  }>;
}): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.productionScheduleGlobalRowRank.deleteMany({
      where: {
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: params.locationKey
      }
    });

    if (params.rankedRows.length === 0) {
      return;
    }

    await tx.productionScheduleGlobalRowRank.createMany({
      data: params.rankedRows.map((row) => ({
        csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
        location: params.locationKey,
        csvDashboardRowId: row.csvDashboardRowId,
        fseiban: row.fseiban,
        globalRank: row.globalRank,
        sourceType: params.sourceType
      }))
    });
  });
}
