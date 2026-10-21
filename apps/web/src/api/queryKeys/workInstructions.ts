export const workInstructionsQueryKeys = {
  groups: (partNumber: string) => ['work-instructions', 'groups', partNumber] as const,
  group: (partNumber: string, shootingTarget: string) => ['work-instructions', 'group', partNumber, shootingTarget] as const,
  editorGroup: (partNumber: string, shootingTarget: string) => ['work-instructions', 'editor-group', partNumber, shootingTarget] as const,
  procedureManualsByPart: (key: string) => ['procedure-manuals', 'by-part', key] as const,
};
