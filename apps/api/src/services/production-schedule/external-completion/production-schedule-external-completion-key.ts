import type { NormalizedRowData } from '../../csv-dashboard/csv-dashboard.types.js';
import { normalizeProductionScheduleResourceCd } from '../policies/resource-category-policy.service.js';

const normalizeToken = (value: unknown): string => String(value ?? '').trim();

export function buildProductionScheduleExternalCompletionKey(parts: {
  fkojun: unknown;
  resourceCd: unknown;
  productNo: unknown;
}): string {
  return [
    normalizeToken(parts.fkojun),
    normalizeProductionScheduleResourceCd(normalizeToken(parts.resourceCd)),
    normalizeToken(parts.productNo),
  ].join('\t');
}

export function buildProductionScheduleExternalCompletionKeyFromRowData(
  rowData: NormalizedRowData
): string {
  return buildProductionScheduleExternalCompletionKey({
    fkojun: rowData.FKOJUN,
    resourceCd: rowData.FSIGENCD,
    productNo: rowData.ProductNo,
  });
}

export function extractProductionScheduleExternalCompletionKeysFromRows(
  rows: ReadonlyArray<{ data: NormalizedRowData }>
): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const row of rows) {
    const key = buildProductionScheduleExternalCompletionKeyFromRowData(row.data);
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }

  return keys.sort((a, b) => a.localeCompare(b));
}
