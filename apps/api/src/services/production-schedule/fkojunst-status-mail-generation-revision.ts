import { Prisma } from '@prisma/client';

import { PRODUCTION_SCHEDULE_FKOJUNST_STATUS_MAIL_DASHBOARD_ID } from './constants.js';

type FkojunstStatusMailGenerationRevisionRow = {
  revision: bigint;
};

/**
 * FKOJUNST_Status mail raw の公開revision（行・取り込み run の変更ごとにトリガーで増える）。
 * 世代トークン・residual evidence・メール同期の世代確認で共通に使い、raw 全件の集計を避ける。
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
