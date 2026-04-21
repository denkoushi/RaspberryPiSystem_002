import { Prisma } from '@prisma/client';

const SAFE_SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * `rowData.FHINCD` から照合キーを得る Postgres 式（TS の `normalizePurchaseFhinCdForMatching` と同一）。
 * `rowAlias` は SQL 識別子として信頼できる値のみ（例: `r`, `CsvDashboardRow`）。
 */
export function fhincdMatchKeyFromRowDataExpr(rowAlias: string): Prisma.Sql {
  if (!SAFE_SQL_IDENTIFIER.test(rowAlias)) {
    throw new Error(`Invalid SQL row alias: ${rowAlias}`);
  }
  return Prisma.raw(
    `trim(regexp_replace(regexp_replace(trim(COALESCE("${rowAlias}"."rowData"->>'FHINCD', '')), '\\([^)]*\\)', '', 'g'), '(-[0-9]+)+$', '', 'g'))`
  );
}
