import { api } from '../../http';

import type {
  AssemblyCheckSheetImportPayload,
  AssemblyCheckSheetPayload,
  AssemblyCheckSheetPaperLayout,
  AssemblyCheckSheetStampInput,
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

export async function openAssemblyCheckSheet(workUnitId: string, revisionRootId?: string) {
  const { data } = await api.post<AssemblyCheckSheetPayload>('/assembly/check-sheets', { workUnitId, revisionRootId });
  return data;
}
export async function getAssemblyCheckSheet(id: string) {
  const { data } = await api.get<AssemblyCheckSheetPayload>(`/assembly/check-sheets/${id}`);
  return data;
}
export async function changeAssemblyCheckSheetRevision(id: string, revisionRootId: string) {
  const { data } = await api.put<AssemblyCheckSheetPayload>(`/assembly/check-sheets/${id}/revision`, { revisionRootId });
  return data;
}
export async function stampAssemblyCheckSheet(id: string, input: AssemblyCheckSheetStampInput) {
  const { data } = await api.post<AssemblyCheckSheetPayload>(`/assembly/check-sheets/${id}/stamps`, input);
  return data;
}
export async function skipAssemblyCheckSheetCondition(id: string, conditionKey: string, nfcTagUid: string) {
  const { data } = await api.post<AssemblyCheckSheetPayload>(`/assembly/check-sheets/${id}/conditions`, { conditionKey, applies: false, nfcTagUid });
  return data;
}
export async function transitionAssemblyCheckSheet(id: string, action: 'pause' | 'resume' | 'complete', nfcTagUid: string) {
  const { data } = await api.post<AssemblyCheckSheetPayload>(`/assembly/check-sheets/${id}/${action}`, { nfcTagUid });
  return data;
}

export async function getAssemblyCheckSheetPaperLayout(id: string) {
  const { data } = await api.get<AssemblyCheckSheetPaperLayout>(`/assembly/check-sheets/${id}/paper-layout`);
  return data;
}
