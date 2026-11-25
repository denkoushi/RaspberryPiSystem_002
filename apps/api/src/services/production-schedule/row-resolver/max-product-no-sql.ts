import { Prisma } from '@prisma/client';

import {
  buildMaxProductNoLogicalKeyMatchAndSql,
  buildMaxProductNoWinnerSelectionOrderBySql,
  quoteSqlIdentifierOrThrow,
} from './max-product-no-winner-spec.js';

/**
 * 「見える行」の条件。キー(4列 + ProductNo)ごとに1行 = 印(supersededAt)の無い全行。
 * 名前は旧仕様(ProductNo 最大だけ残す)の名残で、公開名は変えない。
 */
export const buildMaxProductNoWinnerCondition = (rowAlias: string): Prisma.Sql => {
  const rowAliasQuoted = quoteSqlIdentifierOrThrow(rowAlias);
  const logicalKeyConditions = buildMaxProductNoLogicalKeyMatchAndSql('r2', rowAlias);
  const orderByInner = buildMaxProductNoWinnerSelectionOrderBySql('r2');

  return Prisma.raw(`
    ${rowAliasQuoted}."supersededAt" IS NULL
    AND ${rowAliasQuoted}."id" = (
      SELECT "r2"."id"
      FROM "CsvDashboardRow" AS "r2"
      WHERE "r2"."csvDashboardId" = ${rowAliasQuoted}."csvDashboardId"
        AND "r2"."supersededAt" IS NULL
        AND ${logicalKeyConditions}
      ORDER BY
        ${orderByInner}
      LIMIT 1
    )
  `);
};
