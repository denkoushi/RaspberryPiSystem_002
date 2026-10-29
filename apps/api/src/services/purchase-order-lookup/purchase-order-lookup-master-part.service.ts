import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { fhincdMatchKeyFromRowDataExpr } from './purchase-fhincd-match-sql.js';
import { PRODUCTION_SCHEDULE_DASHBOARD_ID } from '../production-schedule/constants.js';
import { buildMaxProductNoWinnerCondition } from '../production-schedule/row-resolver/index.js';

function normalizedFhincdFromRowDataExpr(rowAlias: string): Prisma.Sql {
  return Prisma.raw(
    `regexp_replace(trim(COALESCE("${rowAlias}"."rowData"->>'FHINCD', '')), '\\([^)]*\\)', '', 'g')`
  );
}

/**
 * 照合キー FHINCD で生産日程本体（winner 行）から FHINMEI（既存DB品名）を1件探す。
 */
export async function findMasterFhinmeiByMatchKey(matchKeyFhinCd: string): Promise<string | null> {
  const batch = await findMasterFhinmeisByMatchKey([matchKeyFhinCd]);
  return batch[matchKeyFhinCd.trim()] ?? null;
}

/**
 * 照合キー FHINCD 集合で生産日程本体（winner 行）から FHINMEI をまとめて引く。
 * （括弧除去 + 末尾数値枝番除去 — `normalizePurchaseFhinCdForMatching` と同一）
 */
export async function findMasterFhinmeisByMatchKey(matchKeyFhinCds?: string[]): Promise<Record<string, string | null>> {
  const keys = Array.from(new Set((matchKeyFhinCds ?? []).map((value) => value.trim()).filter((value) => value.length > 0)));
  if (matchKeyFhinCds && keys.length === 0) {
    return {};
  }

  const matchExpr = fhincdMatchKeyFromRowDataExpr('CsvDashboardRow');
  const rows = await prisma.$queryRaw<Array<{ matchKeyFhinCd: string; fhinmei: string | null }>>`
    SELECT
      ${matchExpr} AS "matchKeyFhinCd",
      MIN(("CsvDashboardRow"."rowData"->>'FHINMEI')) FILTER (
        WHERE ("CsvDashboardRow"."rowData"->>'FHINMEI') IS NOT NULL
          AND ("CsvDashboardRow"."rowData"->>'FHINMEI') <> ''
      ) AS "fhinmei"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      ${matchKeyFhinCds ? Prisma.sql`AND ${matchExpr} IN (${Prisma.join(keys)})` : Prisma.empty}
    GROUP BY 1
  `;

  const result: Record<string, string | null> = {};
  for (const key of keys) {
    result[key] = null;
  }
  for (const row of rows) {
    const key = row.matchKeyFhinCd.trim();
    // Same exact-comparison guard as the normalized dictionary below.
    if (row.matchKeyFhinCd !== key) continue;
    result[key] = row.fhinmei?.trim() || null;
  }
  return result;
}

/**
 * 段階移行フォールバック用: 括弧除去のみの正規化 FHINCD で FHINMEI を1件探す。
 */
export async function findMasterFhinmeiByNormalizedFhinCd(normalizedFhinCd: string): Promise<string | null> {
  const batch = await findMasterFhinmeisByNormalizedFhinCd([normalizedFhinCd]);
  return batch[normalizedFhinCd.trim()] ?? null;
}

/**
 * 段階移行フォールバック用: 括弧除去のみの正規化 FHINCD 集合で FHINMEI をまとめて引く。
 */
export async function findMasterFhinmeisByNormalizedFhinCd(
  normalizedFhinCds?: string[]
): Promise<Record<string, string | null>> {
  const keys = Array.from(new Set((normalizedFhinCds ?? []).map((value) => value.trim()).filter((value) => value.length > 0)));
  if (normalizedFhinCds && keys.length === 0) {
    return {};
  }

  const normalizedExpr = normalizedFhincdFromRowDataExpr('CsvDashboardRow');
  const rows = await prisma.$queryRaw<Array<{ normalizedFhinCd: string; fhinmei: string | null }>>`
    SELECT
      ${normalizedExpr} AS "normalizedFhinCd",
      MIN(("CsvDashboardRow"."rowData"->>'FHINMEI')) FILTER (
        WHERE ("CsvDashboardRow"."rowData"->>'FHINMEI') IS NOT NULL
          AND ("CsvDashboardRow"."rowData"->>'FHINMEI') <> ''
      ) AS "fhinmei"
    FROM "CsvDashboardRow"
    WHERE "CsvDashboardRow"."csvDashboardId" = ${PRODUCTION_SCHEDULE_DASHBOARD_ID}
      AND ${buildMaxProductNoWinnerCondition('CsvDashboardRow')}
      ${normalizedFhinCds ? Prisma.sql`AND ${normalizedExpr} IN (${Prisma.join(keys)})` : Prisma.empty}
    GROUP BY 1
  `;

  const result: Record<string, string | null> = {};
  for (const key of keys) {
    result[key] = null;
  }
  for (const row of rows) {
    const key = row.normalizedFhinCd.trim();
    // Filtered lookups compare against trimmed input; a global dictionary must not
    // introduce groups that that exact SQL comparison would have excluded.
    if (row.normalizedFhinCd !== key) continue;
    result[key] = row.fhinmei?.trim() || null;
  }
  return result;
}
