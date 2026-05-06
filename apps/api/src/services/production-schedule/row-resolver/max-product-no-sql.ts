import { Prisma } from '@prisma/client';

import {
  buildMaxProductNoLogicalKeyMatchAndSql,
  buildMaxProductNoWinnerSelectionOrderBySql,
  quoteSqlIdentifierOrThrow,
} from './max-product-no-winner-spec.js';

export const buildMaxProductNoWinnerCondition = (rowAlias: string): Prisma.Sql => {
  const rowAliasQuoted = quoteSqlIdentifierOrThrow(rowAlias);
  const logicalKeyConditions = buildMaxProductNoLogicalKeyMatchAndSql('r2', rowAlias);
  const orderByInner = buildMaxProductNoWinnerSelectionOrderBySql('r2');

  return Prisma.raw(`
    ${rowAliasQuoted}."id" = (
      SELECT "r2"."id"
      FROM "CsvDashboardRow" AS "r2"
      WHERE "r2"."csvDashboardId" = ${rowAliasQuoted}."csvDashboardId"
        AND ${logicalKeyConditions}
      ORDER BY
        ${orderByInner}
      LIMIT 1
    )
  `);
};
