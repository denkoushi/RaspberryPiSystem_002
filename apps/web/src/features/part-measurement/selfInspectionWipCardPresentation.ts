export type SelfInspectionWipCardPresentation = {
  productNo: string;
  metaLine: string;
  fseibanLine: string | null;
  participantNamesLine: string;
  participantNamesTitle: string | null;
  progressLine: string;
};

export function formatSelfInspectionSessionProgress(completed: number, required: number): string {
  return `${completed} / ${required} 件`;
}

export function presentSelfInspectionWipCard(input: {
  productNo: string;
  fhincd: string;
  fhinmei: string;
  resourceCd: string;
  plannedQuantity: number;
  fseiban: string | null;
  completedEntryCount: number;
  requiredEntryCount: number;
  participantEmployeeNames: readonly string[];
}): SelfInspectionWipCardPresentation {
  const metaLine = `${input.fhincd} / ${input.fhinmei} / ${input.resourceCd} / 指示数 ${input.plannedQuantity}`;
  const names = input.participantEmployeeNames.filter((name) => name.trim().length > 0);
  const participantNamesLine = names.length > 0 ? names.join(' / ') : '—';
  return {
    productNo: input.productNo,
    metaLine,
    fseibanLine: input.fseiban?.trim() ? `製番 ${input.fseiban.trim()}` : null,
    participantNamesLine,
    participantNamesTitle: names.length > 0 ? names.join(' / ') : null,
    progressLine: formatSelfInspectionSessionProgress(
      input.completedEntryCount,
      input.requiredEntryCount
    )
  };
}
