export type BoardDueSource = 'excel' | 'scaw';

export function resolveBoardDueDate(input: {
  source: BoardDueSource;
  itemOverride: string | null;
  manualDueDate: string | null;
  manualUpdatedAt: Date | null;
  excelDueDate: string | null;
  excelChangedAt: Date | null;
  scawPlannedEndDate: string | null;
}): string | null {
  if (input.itemOverride !== null) return input.itemOverride;
  if (input.source === 'scaw' || input.excelDueDate === null) {
    return input.manualDueDate ?? input.scawPlannedEndDate;
  }
  if (input.manualDueDate !== null && input.manualUpdatedAt !== null &&
      (input.excelChangedAt === null || input.manualUpdatedAt > input.excelChangedAt)) {
    return input.manualDueDate;
  }
  return input.excelDueDate;
}

/** A planning-board due override wins over Excel only when entered after the last Excel date change. */
export function isGrindingPlanningBoardDueOverrideActive(params: {
  excelDueDate?: Date | null;
  excelChangedAt?: Date | null;
  dueSource?: BoardDueSource;
  overrideDueDateSetAt?: Date | null;
}): boolean {
  return params.excelDueDate == null || params.dueSource === 'scaw'
    || (params.overrideDueDateSetAt != null
      && (params.excelChangedAt == null || params.overrideDueDateSetAt > params.excelChangedAt));
}
