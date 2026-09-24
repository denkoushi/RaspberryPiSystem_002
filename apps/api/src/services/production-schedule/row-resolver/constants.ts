import { createHash } from 'node:crypto';

export const PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS = [
  'FSEIBAN',
  'FHINCD',
  'FSIGENCD',
  'FKOJUN',
] as const;

export const PRODUCTION_SCHEDULE_HASH_KEY_COLUMNS = [...PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS];

export const PRODUCTION_SCHEDULE_PRODUCT_NO_COLUMN = 'ProductNo';

export const PRODUCTION_SCHEDULE_UNASSIGNED_SEIBAN = '********';

export const isUnassignedProductionSeiban = (value: unknown): boolean =>
  String(value ?? '').trim() === PRODUCTION_SCHEDULE_UNASSIGNED_SEIBAN;

export const productionScheduleKeyColumnsForRow = (row: Record<string, unknown>): readonly string[] =>
  isUnassignedProductionSeiban(row.FSEIBAN)
    ? [...PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS, PRODUCTION_SCHEDULE_PRODUCT_NO_COLUMN]
    : PRODUCTION_SCHEDULE_LOGICAL_KEY_COLUMNS;

export const calculateProductionScheduleDataHash = (row: Record<string, unknown>): string => {
  const source = productionScheduleKeyColumnsForRow(row)
    .map((column) => row[column])
    .filter((value) => value !== undefined && value !== null)
    .map((value) => String(value).trim().toLowerCase())
    .join('|');
  return createHash('sha256').update(source).digest('hex');
};
