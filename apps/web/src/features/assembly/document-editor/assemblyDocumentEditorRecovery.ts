import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export type AssemblyDocumentEditorRecoveryRecord = {
  version: 1;
  documentId: string;
  baseUpdatedAt: string | null;
  editVersion: number;
  savedAt: string;
  elements: AssemblyProcedureOverlayElement[];
};

export type AssemblyDocumentEditorRecoveryMatch = Pick<
  AssemblyDocumentEditorRecoveryRecord,
  'documentId' | 'baseUpdatedAt' | 'editVersion'
>;

export function assemblyDocumentEditorRecoveryKey(documentId: string): string {
  return `kiosk-assembly-procedure-document-editor:${documentId}`;
}

export function readAssemblyDocumentEditorRecovery(
  storage: Storage,
  documentId: string,
  expected?: Pick<AssemblyDocumentEditorRecoveryRecord, 'baseUpdatedAt' | 'editVersion'>
): AssemblyDocumentEditorRecoveryRecord | null {
  const raw = storage.getItem(assemblyDocumentEditorRecoveryKey(documentId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AssemblyDocumentEditorRecoveryRecord>;
    if (
      value.version !== 1 ||
      value.documentId !== documentId ||
      !Array.isArray(value.elements) ||
      typeof value.editVersion !== 'number'
    ) {
      return null;
    }
    if (
      expected &&
      (value.editVersion !== expected.editVersion || value.baseUpdatedAt !== expected.baseUpdatedAt)
    ) {
      return null;
    }
    return value as AssemblyDocumentEditorRecoveryRecord;
  } catch {
    return null;
  }
}

export function writeAssemblyDocumentEditorRecovery(
  storage: Storage,
  record: AssemblyDocumentEditorRecoveryRecord
): void {
  storage.setItem(assemblyDocumentEditorRecoveryKey(record.documentId), JSON.stringify(record));
}

export function clearAssemblyDocumentEditorRecovery(storage: Storage, documentId: string): void {
  storage.removeItem(assemblyDocumentEditorRecoveryKey(documentId));
}
