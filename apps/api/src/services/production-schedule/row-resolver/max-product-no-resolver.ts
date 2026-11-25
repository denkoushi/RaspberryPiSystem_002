import type { NormalizedRowData } from '../../csv-dashboard/csv-dashboard.types.js';
import { productionScheduleKeyColumnsForRow } from './constants.js';

const normalizeValue = (value: unknown): string => String(value ?? '').trim();

const toLogicalKey = (row: NormalizedRowData): string =>
  JSON.stringify(productionScheduleKeyColumnsForRow().map((column) => normalizeValue(row[column])));

/**
 * 完全に同じキー(4列 + ProductNo の5要素)の重複だけを除く。ProductNo が違う行は別注文なので全部残す。
 * 同じキーが複数あるときは、先に来た行を残す(元の挙動と同じ)。
 */
export function resolveToMaxProductNoPerLogicalKey<T extends { data: NormalizedRowData }>(rows: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = toLogicalKey(row.data);
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}
