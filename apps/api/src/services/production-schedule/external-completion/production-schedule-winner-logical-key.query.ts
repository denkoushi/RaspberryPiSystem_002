import { Prisma, type PrismaClient } from '@prisma/client';

import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../constants.js';
import { buildMaxProductNoWinnerCondition } from '../row-resolver/index.js';

/**
 * 生産日程ダッシュボードの MaxProductNo winner 行の論理キー一覧（FKOJUN \\t 資源CD \\t ProductNo）。
 */
export async function queryWinnerLogicalKeys(client: PrismaClient): Promise<string[]> {
  const rows = await client.$queryRaw<Array<{ k: string }>>(Prisma.sql`
    SELECT DISTINCT (
      BTRIM("cdr"."rowData"->>'FKOJUN')
      || E'\t'
      || UPPER(BTRIM("cdr"."rowData"->>'FSIGENCD'))
      || E'\t'
      || BTRIM("cdr"."rowData"->>'ProductNo')
    ) AS "k"
    FROM "CsvDashboardRow" AS "cdr"
    WHERE "cdr"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('cdr')}
    ORDER BY 1 ASC
  `);
  return rows.map((r) => r.k).filter((k) => k.length > 0);
}
