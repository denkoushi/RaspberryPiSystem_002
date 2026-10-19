import { parseAssemblyTemplateEditorRecovery, serializeAssemblyTemplateEditorRecovery } from './assemblyTemplateEditorRecovery';

import type { AssemblyTemplateEditorRecoveryV1 } from './assemblyTemplateEditorRecovery';

export function readAssemblyTemplateEditorRecovery(
  storage: Pick<Storage, 'getItem'>,
  key: string,
  now = new Date()
): AssemblyTemplateEditorRecoveryV1 | null {
  const raw = storage.getItem(key);
  return raw ? parseAssemblyTemplateEditorRecovery(raw, now) : null;
}

export function writeAssemblyTemplateEditorRecovery(
  storage: Pick<Storage, 'setItem'>,
  key: string,
  record: AssemblyTemplateEditorRecoveryV1
): void {
  storage.setItem(key, serializeAssemblyTemplateEditorRecovery(record));
}

export function clearAssemblyTemplateEditorRecovery(
  storage: Pick<Storage, 'removeItem'>,
  key: string
): void {
  storage.removeItem(key);
}
