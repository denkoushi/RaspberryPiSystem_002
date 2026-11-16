import { Prisma, type PrismaClient } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from './constants.js';

export async function rebuildProductionSchedulePartNameLookup(db: Pick<PrismaClient, '$transaction'> = prisma): Promise<void> {
  await db.$transaction(async (tx) => {
    // Transaction-scoped lock also serializes rebuilds from other API processes.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(731426, 1)`;
    await tx.$executeRaw`DELETE FROM "ProductionSchedulePartNameLookup"`;
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "ProductionSchedulePartNameLookup" ("partNumberKey", "partName")
      SELECT UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC))),
             MIN(NULLIF(TRIM("rowData"->>'FHINMEI'), ''))
      FROM "CsvDashboardRow"
      WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
        AND UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC))) IS NOT NULL
      GROUP BY UPPER(TRIM(NORMALIZE("rowData"->>'FHINCD', NFKC)))
    `);
    await tx.$executeRaw`
      INSERT INTO "ProductionSchedulePartNameLookupState" ("id", "builtAt") VALUES (1, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE SET "builtAt" = EXCLUDED."builtAt"
    `;
  }, { timeout: 120_000, maxWait: 30_000 });
}
