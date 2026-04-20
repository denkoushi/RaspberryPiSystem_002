import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';

/**
 * 正規化 FHINCD で生産日程本体（winner 行）から FHINMEI（既存DB品名）を1件探す。
 */
export async function findMasterFhinmeiByNormalizedFhinCd(normalizedFhinCd: string): Promise<string | null> {
  const batch = await findMasterFhinmeisByNormalizedFhinCd([normalizedFhinCd]);
  return batch[normalizedFhinCd.trim()] ?? null;
}

/**
 * 正規化 FHINCD 集合で生産日程本体（winner 行）から FHINMEI をまとめて引く。
 */
export async function findMasterFhinmeisByNormalizedFhinCd(
  normalizedFhinCds: string[]
): Promise<Record<string, string | null>> {
  const keys = Array.from(new Set(normalizedFhinCds.map((value) => value.trim()).filter((value) => value.length > 0)));
  if (keys.length === 0) {
    return {};
  }

  const rows = await prisma.$queryRaw<Array<{ normalizedFhinCd: string; fhinmei: string | null }>>`
    SELECT
      regexp_replace(
        trim(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')),
        '\\([^)]*\\)',
        '',
        'g'
      ) AS "normalizedFhinCd",
      MIN(("CsvDashboardRow"."rowData"->>'FHINMEI')) FILTER (
        WHERE ("CsvDashboardRow"."rowData"->>'FHINMEI') IS NOT NULL
          AND ("CsvDashboardRow"."rowData"->>'FHINMEI') <> ''
      ) AS "fhinmei"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      AND regexp_replace(
        trim(COALESCE("CsvDashboardRow"."rowData"->>'FHINCD', '')),
        '\\([^)]*\\)',
        '',
        'g'
      ) IN (${Prisma.join(keys.map((key) => Prisma.sql`${key}`), ',')})
    GROUP BY "normalizedFhinCd"
  `;

  const result: Record<string, string | null> = {};
  for (const key of keys) {
    result[key] = null;
  }
  for (const row of rows) {
    const key = row.normalizedFhinCd.trim();
    result[key] = row.fhinmei?.trim() || null;
  }
  return result;
}
