import { resolveBoardDueDate, type BoardDueSource } from './resolve-board-due-date.js';

export function resolveBoardDueFields<T extends {
  dueDate: Date | null;
  manualUpdatedAt?: Date | null;
  excelDueDate?: Date | null;
  excelChangedAt?: Date | null;
  plannedEndDate: Date | null;
}>(row: T, source: BoardDueSource = 'excel'): T & { boardDueDate: Date | null } {
  const due = resolveBoardDueDate({
    source, itemOverride: null, splitDueDate: null,
    manualDueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
    manualUpdatedAt: row.manualUpdatedAt ?? null,
    excelDueDate: row.excelDueDate?.toISOString().slice(0, 10) ?? null,
    excelChangedAt: row.excelChangedAt ?? null,
    scawPlannedEndDate: row.plannedEndDate?.toISOString().slice(0, 10) ?? null
  });
  return { ...row, boardDueDate: due ? new Date(`${due}T00:00:00.000Z`) : null };
}
