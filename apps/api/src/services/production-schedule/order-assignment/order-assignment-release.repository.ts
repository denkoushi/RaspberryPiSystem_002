import type { PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildProductionScheduleEffectiveCompletedSql } from '../production-schedule-effective-completion.sql.js';
import { buildFkojunstProductionScheduleListVisibleScalarSql } from '../policies/fkojunst-production-schedule-list-visibility.policy.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';

export type StaleOrderAssignmentCandidate = {
  csvDashboardRowId: string;
  location: string;
  resourceCd: string;
  orderNumber: number;
};

export type OrderAssignmentReleaseTarget = {
  csvDashboardRowId: string;
  location: string;
};

export type PrismaOrderAssignmentExecutor = Pick<PrismaClient, '$queryRaw'> & {
  productionScheduleOrderAssignment: Pick<
    PrismaClient['productionScheduleOrderAssignment'],
    'findUnique' | 'delete' | 'updateMany'
  >;
};

export async function findStaleOrderAssignmentCandidates(
  executor: Pick<PrismaClient, '$queryRaw'>
): Promise<StaleOrderAssignmentCandidate[]> {
  return executor.$queryRaw<StaleOrderAssignmentCandidate[]>`
    SELECT
      "a"."csvDashboardRowId" AS "csvDashboardRowId",
      "a"."location" AS "location",
      "a"."resourceCd" AS "resourceCd",
      "a"."orderNumber" AS "orderNumber"
    FROM "ProductionScheduleOrderAssignment" AS "a"
    INNER JOIN "CsvDashboardRow" AS "cdr"
      ON "cdr"."id" = "a"."csvDashboardRowId"
      AND "cdr"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleProgress" AS "p"
      ON "p"."csvDashboardRowId" = "cdr"."id"
      AND "p"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleExternalCompletion" AS "ext"
      ON "ext"."csvDashboardRowId" = "cdr"."id"
      AND "ext"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    LEFT JOIN "ProductionScheduleFkojunstMailStatus" AS "fkmail"
      ON "fkmail"."csvDashboardRowId" = "cdr"."id"
      AND "fkmail"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    WHERE "a"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND (
        NOT ${buildMaxProductNoWinnerCondition('cdr')}
        OR (
        ${buildProductionScheduleEffectiveCompletedSql()}
          OR NOT ${buildFkojunstProductionScheduleListVisibleScalarSql()}
        )
      )
    ORDER BY "a"."location" ASC, "a"."resourceCd" ASC, "a"."orderNumber" DESC
  `;
}

export async function releaseOrderAssignmentAtLocation(
  executor: PrismaOrderAssignmentExecutor,
  target: OrderAssignmentReleaseTarget
): Promise<{
  released: boolean;
  resourceCd: string | null;
  orderNumber: number | null;
  shiftCount: number;
}> {
  const currentAssignment = await executor.productionScheduleOrderAssignment.findUnique({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: target.csvDashboardRowId,
        location: target.location
      }
    },
    select: {
      orderNumber: true,
      resourceCd: true
    }
  });

  if (!currentAssignment) {
    return { released: false, resourceCd: null, orderNumber: null, shiftCount: 0 };
  }

  await executor.productionScheduleOrderAssignment.delete({
    where: {
      csvDashboardRowId_location: {
        csvDashboardRowId: target.csvDashboardRowId,
        location: target.location
      }
    }
  });

  const shiftResult = await executor.productionScheduleOrderAssignment.updateMany({
    where: {
      csvDashboardId: PRODUCTION_SCHEDULE_DASHBOARD_ID,
      location: target.location,
      resourceCd: currentAssignment.resourceCd,
      orderNumber: { gt: currentAssignment.orderNumber }
    },
    data: { orderNumber: { decrement: 1 } }
  });

  return {
    released: true,
    resourceCd: currentAssignment.resourceCd,
    orderNumber: currentAssignment.orderNumber,
    shiftCount: shiftResult.count
  };
}

export type OrderAssignmentReconciliationResult = {
  scanned: number;
  released: number;
};

export function groupStaleCandidatesForRelease(
  candidates: readonly StaleOrderAssignmentCandidate[]
): StaleOrderAssignmentCandidate[] {
  const seen = new Set<string>();
  const ordered: StaleOrderAssignmentCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.location}\t${candidate.resourceCd}\t${candidate.csvDashboardRowId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(candidate);
  }

  return ordered.sort((left, right) => {
    const locationCmp = left.location.localeCompare(right.location, 'ja');
    if (locationCmp !== 0) return locationCmp;
    const resourceCmp = left.resourceCd.localeCompare(right.resourceCd, 'ja');
    if (resourceCmp !== 0) return resourceCmp;
    return right.orderNumber - left.orderNumber;
  });
}
