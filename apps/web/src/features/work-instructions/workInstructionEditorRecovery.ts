import type { WorkInstructionOverlayElement } from '../../api/domains/work-instructions';

export type WorkInstructionEditorRecoveryRecord = {
  version: 1;
  groupKey: string;
  revisionId: string;
  sourceVersionId: string;
  sourceContentHash: string;
  editVersion: number;
  savedAt: string;
  elements: WorkInstructionOverlayElement[];
};

export function workInstructionEditorRecoveryKey(groupKey: string, revisionId: string): string {
  return `kiosk-work-instruction-editor:${groupKey}:${revisionId}`;
}

export function readWorkInstructionEditorRecovery(
  storage: Storage,
  groupKey: string,
  revisionId: string,
  expected: Pick<WorkInstructionEditorRecoveryRecord, 'sourceVersionId' | 'sourceContentHash' | 'editVersion'>
): WorkInstructionEditorRecoveryRecord | null {
  const raw = storage.getItem(workInstructionEditorRecoveryKey(groupKey, revisionId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<WorkInstructionEditorRecoveryRecord>;
    if (
      value.version !== 1 ||
      value.groupKey !== groupKey ||
      value.revisionId !== revisionId ||
      value.sourceVersionId !== expected.sourceVersionId ||
      value.sourceContentHash !== expected.sourceContentHash ||
      value.editVersion !== expected.editVersion ||
      !Array.isArray(value.elements)
    ) return null;
    return value as WorkInstructionEditorRecoveryRecord;
  } catch {
    return null;
  }
}

export function writeWorkInstructionEditorRecovery(
  storage: Storage,
  record: WorkInstructionEditorRecoveryRecord
): void {
  storage.setItem(
    workInstructionEditorRecoveryKey(record.groupKey, record.revisionId),
    JSON.stringify(record)
  );
}

export function clearWorkInstructionEditorRecovery(
  storage: Storage,
  groupKey: string,
  revisionId: string
): void {
  storage.removeItem(workInstructionEditorRecoveryKey(groupKey, revisionId));
}
