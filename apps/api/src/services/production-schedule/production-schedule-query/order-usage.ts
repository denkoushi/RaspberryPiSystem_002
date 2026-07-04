import { Prisma } from '@prisma/client';

import { prisma } from '../../../lib/prisma.js';
import {
  PRODUCTION_SCHEDULE_DASHBOARD_ID,
} from '../constants.js';

export type ProductionScheduleOrderUsageParams = {
  locationKey: string;
  resourceCds: string[];
};

export async function getProductionScheduleOrderUsage(
  params: ProductionScheduleOrderUsageParams
): Promise<Record<string, number[]>> {
  const { locationKey, resourceCds } = params;
  const resourceCdFilter =
    resourceCds.length > 0
      ? Prisma.sql`AND "resourceCd" IN (${Prisma.join(
          resourceCds.map((cd) => Prisma.sql`${cd}`),
          ','
        )})`
      : Prisma.empty;
  const splitAssignmentUnion = Prisma.sql`
      UNION ALL
      SELECT
        "resourceCd",
        "orderNumber"
      FROM "ProductionScheduleOrderSplitAssignment"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND (
          "location" = ${locationKey}
          OR "siteKey" = ${locationKey}
        )
        ${resourceCdFilter}
    `;

  const usageRows = await prisma.$queryRaw<Array<{ resourceCd: string; orderNumbers: number[] }>>`
    WITH scoped AS (
      SELECT
        "resourceCd",
        "orderNumber"
      FROM "ProductionScheduleOrderAssignment"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND (
          "location" = ${locationKey}
          OR "siteKey" = ${locationKey}
        )
        ${resourceCdFilter}
      ${splitAssignmentUnion}
    )
    SELECT
      "resourceCd" AS "resourceCd",
      array_agg(DISTINCT "orderNumber" ORDER BY "orderNumber") AS "orderNumbers"
    FROM scoped
    GROUP BY "resourceCd"
  `;

  return usageRows.reduce<Record<string, number[]>>((acc, row) => {
    acc[row.resourceCd] = row.orderNumbers ?? [];
    return acc;
  }, {});
}
