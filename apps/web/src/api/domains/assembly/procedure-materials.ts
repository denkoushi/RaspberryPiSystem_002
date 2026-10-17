import { api } from '../../http';

import { procedureEditHeaders } from './shared';

import type { AssemblyProcedureOverlayAssetDto } from '../../../features/assembly/types';
import type { AssemblyProcedureOverlayElement } from '@raspi-system/shared-types';

export async function listProcedureMaterials(params: { state?: import('../../../features/assembly/procedure-manuals/procedure-material-types').ProcedureMaterialState; q?: string; limit?: number } = {}) {
  const { data } = await api.get<{ materials: import('../../../features/assembly/procedure-manuals/procedure-material-types').ProcedureMaterialDto[] }>('/assembly/procedure-materials', { params });
  return data.materials;
}

export async function semanticSearchProcedureMaterials(input: { q: string; state: 'unplaced' | 'placed'; limit?: number }) {
  const { data } = await api.post<{ available: boolean; mode: string; items: import('../../../features/assembly/procedure-manuals/procedure-material-types').ProcedureMaterialDto[] }>('/assembly/procedure-materials/semantic-search', input);
  return data;
}

export async function getProcedureMaterialFile(id: string) {
  const { data } = await api.get<Blob>(`/assembly/procedure-materials/${encodeURIComponent(id)}/file`, { responseType: 'blob' });
  return data;
}

export async function ingestProcedureMaterialsGmail() {
  const { data } = await api.post<import('../../../features/assembly/procedure-manuals/procedure-material-types').ProcedureMaterialIngestResult>('/assembly/procedure-materials/ingest-gmail');
  return data;
}

export async function getProcedureMaterialSplitSuggestions(ids: string[]) {
  const { data } = await api.post<import('../../../features/assembly/procedure-manuals/procedure-material-types').ProcedureMaterialSplitSuggestions>('/assembly/procedure-materials/split-suggestions', { ids });
  return data;
}

export async function createProcedureMaterialDocument(id: string) {
  const { data } = await api.post<{ document: { id: string; name: string } }>(`/assembly/procedure-materials/${encodeURIComponent(id)}/create-document`);
  return data.document;
}

export async function discardProcedureMaterial(id: string) {
  await api.post(`/assembly/procedure-materials/${encodeURIComponent(id)}/discard`);
}

export async function restoreProcedureMaterial(id: string) {
  await api.post(`/assembly/procedure-materials/${encodeURIComponent(id)}/restore`);
}

export async function placeProcedureMaterial(input: { holderToken?: string | null; id: string; materialId: string; pageIndex: number; accessPassword: string }) {
  const { data } = await api.post<{ element: AssemblyProcedureOverlayElement; asset?: AssemblyProcedureOverlayAssetDto }>(`/assembly/procedure-documents/${encodeURIComponent(input.id)}/materials/${encodeURIComponent(input.materialId)}/place`, { pageIndex: input.pageIndex, accessPassword: input.accessPassword }, procedureEditHeaders(input.holderToken));
  return data;
}

export async function unplaceProcedureMaterial(id: string) {
  await api.post(`/assembly/procedure-materials/${encodeURIComponent(id)}/unplace`);
}

export async function listProcedureKnowledgeCandidates(params: { q?: string; limit?: number } = {}) {
  const { data } = await api.get<import('../../../features/assembly/procedure-manuals/procedure-material-types').ProcedureKnowledgeCandidatesResult>('/assembly/procedure-materials/knowledge-candidates', { params });
  return data;
}

export async function getProcedureKnowledgeImage(imageId: string) {
  const { data } = await api.get<Blob>(`/assembly/procedure-materials/knowledge-candidates/images/${encodeURIComponent(imageId)}`, { responseType: 'blob' });
  return data;
}

export async function importProcedureKnowledge(candidateKeys: string[]) {
  const { data } = await api.post<import('../../../features/assembly/procedure-manuals/procedure-material-types').ProcedureKnowledgeImportResult>('/assembly/procedure-materials/import-knowledge', { candidateKeys });
  return data;
}

export async function listProcedureWorkInstructionCandidates(params: { q?: string; limit?: number } = {}) {
  const { data } = await api.get<import('../../../features/assembly/procedure-manuals/procedure-material-types').ProcedureWorkInstructionCandidatesResult>('/assembly/procedure-materials/work-instruction-candidates', { params });
  return data;
}

export async function getProcedureWorkInstructionImage(assetId: string) {
  const { data } = await api.get<Blob>(`/work-instructions/assets/${encodeURIComponent(assetId)}`, { responseType: 'blob' });
  return data;
}

export async function importProcedureWorkInstructions(items: Array<{ candidateKey: string; partNumber: string; shootingTarget: string }>) {
  const { data } = await api.post<import('../../../features/assembly/procedure-manuals/procedure-material-types').ProcedureWorkInstructionImportResult>('/assembly/procedure-materials/import-work-instructions', { items });
  return data;
}

export async function getProcedureMaterialThumbnail(id: string) {
  const { data } = await api.get<Blob>(`/assembly/procedure-materials/${encodeURIComponent(id)}/thumbnail`, { responseType: 'blob' });
  return data;
}

export async function getProcedureKnowledgeThumbnail(imageId: string) {
  const { data } = await api.get<Blob>(`/assembly/procedure-materials/knowledge-candidates/images/${encodeURIComponent(imageId)}/thumbnail`, { responseType: 'blob' });
  return data;
}

export async function getProcedureWorkInstructionThumbnail(assetId: string) {
  const { data } = await api.get<Blob>(`/assembly/procedure-materials/work-instruction-candidates/images/${encodeURIComponent(assetId)}/thumbnail`, { responseType: 'blob' });
  return data;
}
