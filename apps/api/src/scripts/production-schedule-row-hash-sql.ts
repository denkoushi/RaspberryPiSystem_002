/**
 * 生産日程の行ハッシュ(`calculateProductionScheduleDataHash`)を Postgres で再現する SQL 式。
 *
 * 移行 20261125110000_keep_all_manufacturing_orders_rehash の SQL と1文字も違わないこと
 * (テストが移行ファイルにこの式が含まれることを確かめる)。
 *
 * JS の `String(v).trim().toLowerCase()` との差の扱い:
 * - trim: JS は Unicode の空白(Zs と LineTerminator、BOM)を削る。Postgres の btrim は半角空白だけなので、
 *   同じ集合を正規表現で削る。
 * - lower: Postgres の lower() は DB の ctype に依存し(C だと ASCII だけ)、JS は常に Unicode の小文字化をする。
 *   ASCII と全角英字は translate で明示的に小文字化して ctype に依存しないようにする。
 *   それ以外の大小文字のある文字(ラテン拡張、ギリシャ、キリル、ローマ数字など)は JS との差が出うるので、
 *   値に含まれていたら移行は中止する(RISKY_CHAR_REGEX)。
 */
export const PRODUCTION_SCHEDULE_ROW_HASH_KEY_JSON_COLUMNS = [
  'FSEIBAN',
  'FHINCD',
  'FSIGENCD',
  'FKOJUN',
  'ProductNo',
] as const;

/** JS の String.prototype.trim が削る文字(WhiteSpace と LineTerminator)。 */
export const JS_TRIM_CHAR_CLASS =
  '[\\u0009-\\u000D\\u0020\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]';

/** 大小文字のあるブロック。JS の toLowerCase と Postgres の lower の差が出うるので、含まれていたら中止する。 */
export const RISKY_CHAR_REGEX =
  '[\\u00C0-\\u058F\\u10A0-\\u10FF\\u1E00-\\u1FFF\\u2126-\\u212B\\u2160-\\u2188\\u24B6-\\u24E9\\u2C00-\\u2DFF\\uA640-\\uA7FF]';

const ASCII_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ASCII_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const FULLWIDTH_UPPER = [...ASCII_UPPER].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('');
const FULLWIDTH_LOWER = [...ASCII_LOWER].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).join('');

/** rowData の1列を JS の `String(v).trim().toLowerCase()` と同じ文字列にする式(NULL は NULL のまま)。 */
export const buildProductionScheduleRowHashPartSql = (rowAlias: string, column: string): string =>
  `translate(lower(regexp_replace(${rowAlias}."rowData"->>'${column}', '^${JS_TRIM_CHAR_CLASS}+|${JS_TRIM_CHAR_CLASS}+$', '', 'g')), '${ASCII_UPPER}${FULLWIDTH_UPPER}', '${ASCII_LOWER}${FULLWIDTH_LOWER}')`;

/** 5要素のハッシュ式。NULL(キー無し/JSON null)は concat_ws が飛ばす。JS の undefined/null の除外と同じ。 */
export const buildProductionScheduleRowHashSql = (rowAlias: string): string =>
  `encode(sha256(convert_to(concat_ws('|', ${PRODUCTION_SCHEDULE_ROW_HASH_KEY_JSON_COLUMNS.map((column) =>
    buildProductionScheduleRowHashPartSql(rowAlias, column)).join(', ')}), 'UTF8')), 'hex')`;

/** ハッシュ式で扱えない値(文字列以外、JS との差が出うる文字)を持つ行の条件。 */
export const buildProductionScheduleRowHashUnsafeConditionSql = (rowAlias: string): string =>
  PRODUCTION_SCHEDULE_ROW_HASH_KEY_JSON_COLUMNS.map((column) =>
    `(jsonb_typeof(${rowAlias}."rowData"->'${column}') NOT IN ('string', 'null') OR ${rowAlias}."rowData"->>'${column}' ~ '${RISKY_CHAR_REGEX}')`).join('\n    OR ');
