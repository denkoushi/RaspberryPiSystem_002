import { Prisma } from '@prisma/client';
import { PART_SEARCH_SOKUON_COMPARABLE_REPLACEMENTS } from '@raspi-system/part-search-core';

/**
 * JSON 抽出式を、部品名検索の「促音→ツ」比較用に包む。
 * {@link PART_SEARCH_SOKUON_COMPARABLE_REPLACEMENTS} と必ず同期すること。
 */
export function wrapJsonTextFieldForPartSearchComparable(fieldExpr: Prisma.Sql): Prisma.Sql {
  return PART_SEARCH_SOKUON_COMPARABLE_REPLACEMENTS.reduce(
    (acc, { from, to }) => Prisma.sql`REPLACE(${acc}, ${from}, ${to})`,
    fieldExpr
  );
}
