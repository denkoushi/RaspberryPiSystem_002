import type { NormalizedRowData } from '../../csv-dashboard/csv-dashboard.types.js';
import {
  PRODUCTION_SCHEDULE_PRODUCT_NO_COLUMN,
  productionScheduleKeyColumnsForRow,
} from './constants.js';

const normalizeValue = (value: unknown): string => String(value ?? '').trim();

const toLogicalKey = (row: NormalizedRowData): string =>
  JSON.stringify(productionScheduleKeyColumnsForRow(row).map((column) => normalizeValue(row[column])));

const toProductNo = (row: NormalizedRowData): string => normalizeValue(row[PRODUCTION_SCHEDULE_PRODUCT_NO_COLUMN]);

const compareProductNo = (a: string, b: string): number => {
  const numA = /^\d+$/.test(a) ? parseInt(a, 10) : -1;
  const numB = /^\d+$/.test(b) ? parseInt(b, 10) : -1;
  return numA - numB;
};

export function resolveToMaxProductNoPerLogicalKey<T extends { data: NormalizedRowData }>(rows: T[]): T[] {
  const winnerByKey = new Map<string, T>();

  for (const row of rows) {
    const logicalKey = toLogicalKey(row.data);
    const currentWinner = winnerByKey.get(logicalKey);
    if (!currentWinner) {
      winnerByKey.set(logicalKey, row);
      continue;
    }

    const incomingProductNo = toProductNo(row.data);
    const currentProductNo = toProductNo(currentWinner.data);
    if (compareProductNo(incomingProductNo, currentProductNo) > 0) {
      winnerByKey.set(logicalKey, row);
    }
  }

  return [...winnerByKey.values()];
}
