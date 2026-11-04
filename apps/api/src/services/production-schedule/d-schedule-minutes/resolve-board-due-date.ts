export type BoardDueSource = 'excel' | 'scaw';

export function resolveBoardDueDate(input: {
  source: BoardDueSource;
  itemOverride: string | null;
  splitDueDate: string | null;
  manualDueDate: string | null;
  manualUpdatedAt: Date | null;
  excelDueDate: string | null;
  excelChangedAt: Date | null;
  scawPlannedEndDate: string | null;
}): string | null {
  if (input.itemOverride !== null) return input.itemOverride;
  if (input.splitDueDate !== null) return input.splitDueDate;
  if (input.source === 'scaw' || input.excelDueDate === null) {
    return input.manualDueDate ?? input.scawPlannedEndDate;
  }
  if (input.manualDueDate !== null && input.manualUpdatedAt !== null &&
      (input.excelChangedAt === null || input.manualUpdatedAt > input.excelChangedAt)) {
    return input.manualDueDate;
  }
  return input.excelDueDate;
}
