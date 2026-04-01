export type EffectiveDueDisplaySource = 'manual' | 'csv' | null;

export function resolveEffectiveDueDisplay(params: {
  manualDue: Date | null | undefined;
  plannedEndDate: Date | null | undefined;
}): { displayDueDate: Date | null; source: EffectiveDueDisplaySource } {
  const manual = params.manualDue ?? null;
  if (manual) {
    return { displayDueDate: manual, source: 'manual' };
  }
  const csv = params.plannedEndDate ?? null;
  if (csv) {
    return { displayDueDate: csv, source: 'csv' };
  }
  return { displayDueDate: null, source: null };
}
