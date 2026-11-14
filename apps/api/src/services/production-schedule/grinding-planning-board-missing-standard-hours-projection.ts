import type { GrindingPlanningBoardProjectionInput, GrindingPlanningBoardRowData } from './grinding-planning-board-projection.js';
import { missingStandardHoursItemId } from './missing-standard-hours-process.js';

export function asRowData(value: GrindingPlanningBoardRowData): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Donor contributes display and parent-due inputs, never item overrides, completion, ranks or splits. */
export function buildMissingStandardHoursProjectionInput(params: GrindingPlanningBoardProjectionInput): GrindingPlanningBoardProjectionInput {
  const evidence = params.missingStandardHoursRows ?? [];
  const rows = evidence.map((row) => ({ id: missingStandardHoursItemId(row), updatedAt: row.sourceUpdatedAt,
    rowData: { ...asRowData(row.rowData), ProductNo: row.fsezono, FKOJUN: row.fkojun, FSIGENCD: row.fkoteicd, FSIGENSHOYORYO: null } }));
  const details = new Map(evidence.map((row) => [missingStandardHoursItemId(row), {
    updatedAt: row.sourceUpdatedAt, rowNotes: [{ dueDate: row.dueDate }],
    excelDueDate: row.excelDueDate, excelChangedAt: row.excelChangedAt, manualUpdatedAt: row.manualUpdatedAt,
    orderSupplements: [{ plannedQuantity: row.plannedQuantity, plannedEndDate: row.plannedEndDate }],
    productionScheduleProgress: null, productionScheduleExternalCompletion: null
  }]));
  return { ...params, rows, details, dueSource: params.dueSource, resourceMinutes: undefined, pieceSets: undefined,
    overrides: new Map(), ranks: { rows: new Map() } };
}
