import { sortLoanInspectionRowsForDisplay } from '../../shared/loan-inspection-card/row-priority.js';
import type { MiLoanInspectionTableRow } from './mi-instrument-display.types.js';

export type { MiLoanInspectionTableRow };

export function sortRowsForDisplay(rows: readonly MiLoanInspectionTableRow[]): MiLoanInspectionTableRow[] {
  return sortLoanInspectionRowsForDisplay(rows, '貸出中計測機器数');
}
