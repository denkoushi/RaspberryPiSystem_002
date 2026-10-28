import { Prisma } from '@prisma/client';
import { PART_SEARCH_KANA_FOLD_DELETE, PART_SEARCH_KANA_FOLD_TRANSLATION, PART_SEARCH_SOKUON_COMPARABLE_REPLACEMENTS } from '@raspi-system/part-search-core';

/**
 * JSON 抽出式を促音・濁点・半濁点・長音の比較用に包む。
 * 写像と削除文字は検索コアを正本とする。
 */
export function wrapJsonTextFieldForPartSearchComparable(fieldExpr: Prisma.Sql): Prisma.Sql {
  const sokuon = PART_SEARCH_SOKUON_COMPARABLE_REPLACEMENTS.reduce(
    (acc, { from, to }) => Prisma.sql`REPLACE(${acc}, ${from}, ${to})`,
    fieldExpr
  );
  const { from, to } = PART_SEARCH_KANA_FOLD_TRANSLATION;
  return Prisma.sql`translate(${sokuon}, ${from + PART_SEARCH_KANA_FOLD_DELETE}, ${to})`;
}
