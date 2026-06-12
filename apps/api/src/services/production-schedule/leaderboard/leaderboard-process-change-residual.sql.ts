import { Prisma } from '@prisma/client';

import {
  buildProcessChangeResidualSqlTextKey,
  parseProcessChangeResidualStrongEvidenceKey
} from './leaderboard-process-change-residual.keys.js';
import type { ProcessChangeResidualMode } from './leaderboard-process-change-residual.types.js';

const CURRENT_PRODUCT_NO_EXPR = Prisma.sql`NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'ProductNo'), '')`;
const CURRENT_FKOJUN_EXPR = Prisma.sql`NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FKOJUN'), '')`;
const CURRENT_RESOURCE_EXPR = Prisma.sql`UPPER(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'))`;

/** キー欠損行は疑い対象外。 */
export function buildLeaderboardProcessChangeResidualKeyPresentSql(): Prisma.Sql {
  return Prisma.sql`
    ${CURRENT_PRODUCT_NO_EXPR} IS NOT NULL
    AND ${CURRENT_FKOJUN_EXPR} IS NOT NULL
    AND NULLIF(BTRIM("CsvDashboardRow"."rowData"->>'FSIGENCD'), '') IS NOT NULL
  `;
}

function buildLeaderboardProcessChangeResidualStrongEvidenceMatchSql(keys: readonly string[]): Prisma.Sql {
  if (keys.length === 0) {
    return Prisma.sql`FALSE`;
  }

  return Prisma.sql`
    concat(
      length(${CURRENT_PRODUCT_NO_EXPR})::text,
      ':',
      ${CURRENT_PRODUCT_NO_EXPR},
      '|',
      length(${CURRENT_FKOJUN_EXPR})::text,
      ':',
      ${CURRENT_FKOJUN_EXPR},
      '|',
      length(${CURRENT_RESOURCE_EXPR})::text,
      ':',
      ${CURRENT_RESOURCE_EXPR}
    )
      = ANY(${keys}::text[])
  `;
}

function buildLeaderboardProcessChangeResidualSqlTextKeys(keys: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const parsed = parseProcessChangeResidualStrongEvidenceKey(key);
    if (parsed == null) continue;
    out.push(buildProcessChangeResidualSqlTextKey(parsed));
  }
  return out;
}

/**
 * mode に応じた shell / count 用 WHERE 断片。
 * `strongEvidenceKeys` はリクエスト内 1 回 materialize した集合を渡す。
 * マッチは text[] の `ANY` で行い、候補行ごとの `unnest` 評価とキー数比例の bind 増加を避ける。
 */
export function buildLeaderboardProcessChangeResidualFilterWhereSql(
  mode: ProcessChangeResidualMode | undefined,
  strongEvidenceKeys?: ReadonlySet<string>
): Prisma.Sql {
  if (mode === 'include' || mode == null) {
    return Prisma.empty;
  }

  const keys = strongEvidenceKeys ?? new Set<string>();
  const keyList = buildLeaderboardProcessChangeResidualSqlTextKeys(keys);
  const keyPresentSql = buildLeaderboardProcessChangeResidualKeyPresentSql();
  const matchSql = buildLeaderboardProcessChangeResidualStrongEvidenceMatchSql(keyList);

  if (mode === 'only') {
    if (keys.size === 0) {
      return Prisma.sql`AND FALSE`;
    }
    return Prisma.sql`AND ${keyPresentSql} AND ${matchSql}`;
  }

  if (keys.size === 0) {
    return Prisma.empty;
  }

  return Prisma.sql`AND NOT (${keyPresentSql} AND ${matchSql})`;
}
