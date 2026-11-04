import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';

/**
 * Same rows as Prisma `rowData: { path: ['ProductNo'], equals: <string> }` (jsonb string equality),
 * written as `->> = ANY(text[])` so one scan serves many orders instead of one OR branch per order.
 * The jsonb_typeof guard keeps numbers/arrays out, as jsonb equality against a string does.
 */
export function productionScheduleProductNoMatchSql(productNos: string[]): Prisma.Sql {
  return Prisma.sql`"csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
    AND "rowData"->>'ProductNo' = ANY(${productNos}::text[])
    AND jsonb_typeof("rowData"->'ProductNo') = 'string'`;
}
