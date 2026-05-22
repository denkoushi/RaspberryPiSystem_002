import type { LoanInspectionTableRow } from './display.types.js';

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * 表示順: 貸出ありを先頭、その中は件数降順、同値は氏名昇順。貸出なしは末尾（氏名昇順）。
 */
export function sortLoanInspectionRowsForDisplay(
  rows: readonly LoanInspectionTableRow[],
  activeCountColumn: string,
  employeeNameColumn = '従業員名',
): LoanInspectionTableRow[] {
  return [...rows].sort((a, b) => {
    const countA = toNumber(a[activeCountColumn], 0);
    const countB = toNumber(b[activeCountColumn], 0);
    const hasA = countA > 0;
    const hasB = countB > 0;
    if (hasA !== hasB) {
      return hasA ? -1 : 1;
    }
    if (hasA && hasB && countA !== countB) {
      return countB - countA;
    }
    const nameA = String(a[employeeNameColumn] ?? '');
    const nameB = String(b[employeeNameColumn] ?? '');
    return nameA.localeCompare(nameB, 'ja');
  });
}
