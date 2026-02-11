import { Prisma } from '@prisma/client';
import { PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS } from './constants.js';

const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

const quoteIdentifier = (identifier: string): string => {
  if (!SQL_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
};

export const buildMaxProductNoWinnerCondition = (rowAlias: string): Prisma.Sql => {
  const rowAliasQuoted = quoteIdentifier(rowAlias);
  const logicalKeyConditions = PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS.map(
    (column) =>
      `COALESCE("r2"."rowData"->>'${column}', '') = COALESCE(${rowAliasQuoted}."rowData"->>'${column}', '')`
  ).join('\n      AND ');

  return Prisma.raw(`
    ${rowAliasQuoted}."id" = (
      SELECT "r2"."id"
      FROM "CsvDashboardRow" AS "r2"
      WHERE "r2"."csvDashboardId" = ${rowAliasQuoted}."csvDashboardId"
        AND ${logicalKeyConditions}
      ORDER BY
        CASE
          WHEN ("r2"."rowData"->>'ProductNo') ~ '^[0-9]+$' THEN (("r2"."rowData"->>'ProductNo'))::bigint
          ELSE -1
        END DESC,
        "r2"."createdAt" DESC,
        "r2"."id" DESC
      LIMIT 1
    )
  `);
};
