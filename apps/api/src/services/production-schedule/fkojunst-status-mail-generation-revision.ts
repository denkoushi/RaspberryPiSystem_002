import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';

type FkojunstStatusMailGenerationRevisionRow = {
  revision: bigint;
};

/**
 * Board generation専用のraw公開revision。count/MAXで全rawを集約する既存signal契約とは分離する。
 * migrationが作るrevision行が無い場合は、初期値に丸めず運用不整合として失敗させる。
 */
export async function fetchFkojunstStatusMailGenerationRevision(
  client: { $queryRaw<T>(query: Prisma.Sql): Promise<T> }
): Promise<string> {
  const rows = await client.$queryRaw<FkojunstStatusMailGenerationRevisionRow[]>(Prisma.sql`
    SELECT "revision"
    FROM "CsvDashboardRawRevision"
    WHERE "csvDashboardId" = ${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}
  `);
  const revision = rows[0]?.revision;
  if (revision == null) {
    throw new Error(
      `[FkojunstStatusMailGenerationRevision] raw revision row is missing for dashboard ${PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID}`
    );
  }
  return String(revision);
}
