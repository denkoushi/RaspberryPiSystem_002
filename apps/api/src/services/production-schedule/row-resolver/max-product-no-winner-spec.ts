import { PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS, PRODUCTION_SCHEDULE_UNASSIGNED_SEIBAN } from './constants.js';

const SQL_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** @internal */
export const quoteSqlIdentifierOrThrow = (identifier: string): string => {
  if (!SQL_IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
};

/**
 * 「同一論理キー」を `COALESCE(rowData->>'col','')` 列の並びとして表現（ PARTITION / 結合キー共通）。
 *
 * NOTE: `buildMaxProductNoWinnerCondition` の相関サブクエリと完全一致させることが契約。
 */
export const buildMaxProductNoLogicalKeyPartitionExprs = (rowAlias: string): string => {
  const rowAliasQuoted = quoteSqlIdentifierOrThrow(rowAlias);
  const columns = PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS.map(
    (column) => `COALESCE(${rowAliasQuoted}."rowData"->>'${column}', '')`
  ).join(', ');
  return `${columns}, CASE WHEN BTRIM(COALESCE(${rowAliasQuoted}."rowData"->>'FSEIBAN', '')) = '${PRODUCTION_SCHEDULE_UNASSIGNED_SEIBAN}' THEN BTRIM(COALESCE(${rowAliasQuoted}."rowData"->>'ProductNo', '')) ELSE '' END`;
};

/**
 * winner 行の ORDER BY（ProductNo 数値降順 → createdAt 降順 → id 降順）。
 * `buildMaxProductNoWinnerCondition` 内のサブクエリと一致。
 */
export const buildMaxProductNoWinnerSelectionOrderBySql = (rowAlias: string): string => {
  const rowAliasQuoted = quoteSqlIdentifierOrThrow(rowAlias);
  return `
    CASE
      WHEN (${rowAliasQuoted}."rowData"->>'ProductNo') ~ '^[0-9]+$' THEN ((${rowAliasQuoted}."rowData"->>'ProductNo'))::bigint
      ELSE -1
    END DESC,
    ${rowAliasQuoted}."createdAt" DESC,
    ${rowAliasQuoted}."id" DESC
  `.trim();
};

/**
 * 相関サブクエリの ON 条件（内側行と外側行の論理キー一致）を組み立てる。
 */
export const buildMaxProductNoLogicalKeyMatchAndSql = (
  innerAlias: string,
  outerAlias: string
): string => {
  const inner = quoteSqlIdentifierOrThrow(innerAlias);
  const outer = quoteSqlIdentifierOrThrow(outerAlias);
  const conditions = PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS.map(
    (column) =>
      `COALESCE(${inner}."rowData"->>'${column}', '') = COALESCE(${outer}."rowData"->>'${column}', '')`
  ).join('\n      AND ');
  return `${conditions}\n      AND (BTRIM(COALESCE(${outer}."rowData"->>'FSEIBAN', '')) <> '${PRODUCTION_SCHEDULE_UNASSIGNED_SEIBAN}' OR BTRIM(COALESCE(${inner}."rowData"->>'ProductNo', '')) = BTRIM(COALESCE(${outer}."rowData"->>'ProductNo', '')))`;
};
