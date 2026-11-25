import { createHash } from 'node:crypto';

export const PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS = [
  'FSEIBAN',
  'FHINCD',
  'FSIGENCD',
  'FKOJUN',
] as const;

export const PRODUCTION_SCHEDULE_PRODUCT_NO_COLUMN = 'ProductNo';

/** 行の識別(製造オーダー番号まで含む5要素)。番号が違えば別注文として全部残す。 */
export const PRODUCTION_SCHEDULE_ROW_KEY_COLUMNS = [
  ...PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS,
  PRODUCTION_SCHEDULE_PRODUCT_NO_COLUMN,
] as const;

export const PRODUCTION_SCHEDULE_HASH_KEY_COLUMNS = [...PRODUCTION_SCHEDULE_ROW_KEY_COLUMNS];

export const PRODUCTION_SCHEDULE_UNASSIGNED_SEIBAN = '********';

export const isUnassignedProductionSeiban = (value: unknown): boolean =>
  String(value ?? '').trim() === PRODUCTION_SCHEDULE_UNASSIGNED_SEIBAN;

export const productionScheduleKeyColumnsForRow = (): readonly string[] =>
  PRODUCTION_SCHEDULE_ROW_KEY_COLUMNS;

export const calculateProductionScheduleDataHash = (row: Record<string, unknown>): string => {
  const source = productionScheduleKeyColumnsForRow()
    .map((column) => row[column])
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim().toLowerCase())
    .join('|');
  return createHash('sha256').update(source).digest('hex');
};
