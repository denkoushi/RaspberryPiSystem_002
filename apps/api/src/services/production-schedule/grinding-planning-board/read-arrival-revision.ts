import { prisma } from '../../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';

export async function readGrindingPlanningBoardArrivalRevision(siteKey: string): Promise<{ revision: string }> {
  // Both scans use the dashboard/site prefix of the existing unique indexes.
  // Hash every record so updating an older arrival also changes the revision.
  const [result] = await prisma.$queryRaw<[{ revision: string }]>`
    SELECT concat_ws(':', regular.count, regular.checksum, first_process.count, first_process.checksum) AS revision
    FROM (
      SELECT count(*), coalesce(sum(hashtextextended(ROW(id, "itemKey", "arrivalDate", "createdAt")::text, 0)), 0) AS checksum
      FROM "ProductionScheduleGrindingPlanningBoardArrival"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND "siteKey" = ${siteKey}
    ) AS regular CROSS JOIN (
      SELECT count(*), coalesce(sum(hashtextextended(ROW(id, "itemKey", state, "recordedAt")::text, 0)), 0) AS checksum
      FROM "ProductionScheduleGrindingPlanningBoardFirstProcessArrival"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID} AND "siteKey" = ${siteKey}
    ) AS first_process
  `;
  return result;
}
