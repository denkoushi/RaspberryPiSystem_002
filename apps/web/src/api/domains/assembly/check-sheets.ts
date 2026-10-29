import { api } from '../../http';

import type {
  AssemblyCheckSheetImportPayload,
  AssemblyCheckSheetRevisionPayload,
  AssemblyCheckSheetSavePayload
} from '@raspi-system/shared-types';

export async function listAssemblyCheckSheetRevisions() {
  const { data } = await api.get<AssemblyCheckSheetRevisionPayload[]>('/assembly/check-sheets/revisions');
  return data;
}

export async function importAssemblyCheckSheet(file: File) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<AssemblyCheckSheetImportPayload>('/assembly/check-sheets/imports', form);
  return data;
}

export async function saveAssemblyCheckSheetRevision(payload: AssemblyCheckSheetSavePayload) {
  const { data } = await api.post<AssemblyCheckSheetRevisionPayload>('/assembly/check-sheets/revisions', payload);
  return data;
}
