import { procedureLayoutSuggestionRequestSchema, procedureLayoutSuggestionResponseSchema } from '@raspi-system/shared-types';

import { api } from '../../http';

import { procedureEditHeaders } from './shared';

import type { AssemblyProcedureDocumentDto, AssemblyProcedureDocumentSummaryDto, AssemblyProcedureOverlayAssetDto, AssemblyProcedureTextCandidateDto, AssemblyProcedureGmailImportResultDto } from '../../../features/assembly/types';
import type { AssemblyProcedureOverlayElement, OverlayRegionImage, ProcedureLayoutSuggestionRequest } from '@raspi-system/shared-types';

export async function suggestAssemblyProcedureLayout(input: ProcedureLayoutSuggestionRequest & { id: string; accessPassword: string; holderToken?: string | null; signal: AbortSignal }) {
  const { data } = await api.post(
    `/assembly/procedure-documents/${encodeURIComponent(input.id)}/layout-suggestions`,
    { ...procedureLayoutSuggestionRequestSchema.parse({ pageIndex: input.pageIndex, elements: input.elements }), accessPassword: input.accessPassword },
    { ...procedureEditHeaders(input.holderToken), signal: input.signal }
  );
  return procedureLayoutSuggestionResponseSchema.parse(data);
}

export async function listAssemblyProcedureDocuments(params?: { q?: string; includeInactive?: boolean }) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.includeInactive) qs.set('includeInactive', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await api.get<{ documents: AssemblyProcedureDocumentDto[] }>(`/assembly/procedure-documents${suffix}`);
  return data.documents;
}

export async function getAssemblyProcedureDocument(id: string) {
  const { data } = await api.get<{ document: AssemblyProcedureDocumentDto }>(
    `/assembly/procedure-documents/${encodeURIComponent(id)}`
  );
  return data.document;
}

export async function createAssemblyProcedureDocumentRevision(id: string, accessPassword: string) {
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto }>(
    `/assembly/procedure-documents/${encodeURIComponent(id)}/revisions`,
    { accessPassword }
  );
  return data.document;
}

export async function saveAssemblyProcedureDocumentOverlays(input: {
  holderToken?: string | null;
  id: string;
  accessPassword: string;
  expectedEditVersion: number;
  elements: AssemblyProcedureOverlayElement[];
  appliedCaptionElementIds?: string[];
}) {
  const { data } = await api.put<{ document: AssemblyProcedureDocumentDto }>(
    `/assembly/procedure-documents/${encodeURIComponent(input.id)}/overlays`,
    {
      accessPassword: input.accessPassword,
      expectedEditVersion: input.expectedEditVersion,
      elements: input.elements,
      ...(input.appliedCaptionElementIds ? { appliedCaptionElementIds: input.appliedCaptionElementIds } : {})
    },
    procedureEditHeaders(input.holderToken)
  );
  return data.document;
}

export async function uploadAssemblyProcedureOverlayImage(input: {
  holderToken?: string | null;
  id: string;
  accessPassword: string;
  file: File;
}) {
  const formData = new FormData();
  formData.append('accessPassword', input.accessPassword);
  formData.append('file', input.file);
  const { data } = await api.post<{ asset: AssemblyProcedureOverlayAssetDto }>(
    `/assembly/procedure-documents/${encodeURIComponent(input.id)}/assets`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data', ...procedureEditHeaders(input.holderToken).headers } }
  );
  return data.asset;
}

export async function createAssemblyProcedureImageRegion(input: {
  holderToken?: string | null;
  id: string;
  accessPassword: string;
  pageIndex: number;
  bbox: AssemblyProcedureOverlayElement['bbox'];
  overlays?: OverlayRegionImage[];
}) {
  const { data } = await api.post<{ asset: AssemblyProcedureOverlayAssetDto }>(
    `/assembly/procedure-documents/${encodeURIComponent(input.id)}/regions/image`,
    {
      accessPassword: input.accessPassword,
      pageIndex: input.pageIndex,
      bbox: input.bbox,
      ...(input.overlays ? { overlays: input.overlays } : {})
    },
    procedureEditHeaders(input.holderToken)
  );
  return data.asset;
}

export async function findAssemblyProcedureTextCandidates(input: {
  id: string;
  accessPassword: string;
  pageIndex: number;
  bbox: AssemblyProcedureOverlayElement['bbox'];
  overlays?: OverlayRegionImage[];
}) {
  const { data } = await api.post<{ candidates: AssemblyProcedureTextCandidateDto[] }>(
    `/assembly/procedure-documents/${encodeURIComponent(input.id)}/regions/text`,
    {
      accessPassword: input.accessPassword,
      pageIndex: input.pageIndex,
      bbox: input.bbox,
      ...(input.overlays ? { overlays: input.overlays } : {})
    }
  );
  return data.candidates;
}

export async function discardAssemblyProcedureDocumentRevision(input: {
  holderToken?: string | null;
  id: string;
  accessPassword: string;
  expectedEditVersion?: number;
}) {
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto }>(
    `/assembly/procedure-documents/${encodeURIComponent(input.id)}/discard-revision`,
    {
      accessPassword: input.accessPassword,
      expectedEditVersion: input.expectedEditVersion
    },
    procedureEditHeaders(input.holderToken)
  );
  return data.document;
}

export async function listAssemblyProcedureDocumentSummaries(params?: {
  q?: string;
  includeInactive?: boolean;
  limit?: number;
}) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.includeInactive) qs.set('includeInactive', 'true');
  if (params?.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  const { data } = await api.get<{ documents: AssemblyProcedureDocumentSummaryDto[] }>(
    `/assembly/procedure-documents/summary${suffix}`
  );
  // 配布途中の古い API は manualAssignments を返さない
  return data.documents.map(document => ({ ...document, manualAssignments: document.manualAssignments ?? [] }));
}

export async function uploadAssemblyProcedureDocument(input: { name: string; file: File }) {
  const formData = new FormData();
  formData.append('name', input.name);
  formData.append('file', input.file);
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto }>('/assembly/procedure-documents', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  return data.document;
}

export async function previewAssemblyProcedureDocument(file: File): Promise<Blob> {
  const formData = new FormData();
  formData.append('file', file);
  const { data } = await api.post<Blob>('/assembly/procedure-documents/preview', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    responseType: 'blob'
  });
  return data;
}

export async function ingestAssemblyProcedureDocumentsFromGmail() {
  const { data } = await api.post<{ result: AssemblyProcedureGmailImportResultDto }>(
    '/assembly/procedure-documents/ingest-gmail',
    undefined,
    { timeout: 600_000 }
  );
  return data.result;
}

export async function renameAssemblyProcedureDocument(id: string, name: string, holderToken?: string | null) {
  const { data } = await api.patch<{ document: AssemblyProcedureDocumentDto }>(`/assembly/procedure-documents/${id}`, { name }, procedureEditHeaders(holderToken));
  return data.document;
}

export async function deleteAssemblyProcedureDocument(id: string, holderToken?: string | null) {
  await api.delete(`/assembly/procedure-documents/${id}`, procedureEditHeaders(holderToken));
}

export async function publishAssemblyProcedureDocument(input: {
  holderToken?: string | null;
  id: string;
  accessPassword: string;
  expectedEditVersion?: number;
}) {
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto }>(
    `/assembly/procedure-documents/${encodeURIComponent(input.id)}/publish`,
    {
      accessPassword: input.accessPassword,
      expectedEditVersion: input.expectedEditVersion
    },
    procedureEditHeaders(input.holderToken)
  );
  return data.document;
}

export async function resolveProcedureManualApprover(reviewerTagUid: string) {
  const { data } = await api.post<{ reviewer: { displayName: string; positionName: string | null; rank: string } }>(
    '/assembly/procedure-documents/approval-reviewer', { reviewerTagUid }
  );
  return data.reviewer;
}

export async function approvePublishAssemblyProcedureDocument(input: {
  holderToken?: string | null;
  id: string; reviewerTagUid: string; expectedEditVersion: number; comment?: string;
}) {
  const { id, holderToken, ...body } = input;
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto }>(
    `/assembly/procedure-documents/${encodeURIComponent(id)}/approve-publish`, body, procedureEditHeaders(holderToken)
  );
  return data.document;
}

export async function unpublishAssemblyProcedureDocument(id: string) {
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto }>(
    `/assembly/procedure-documents/${id}/unpublish`
  );
  return data.document;
}

export async function getAssemblyProcedureDocumentRevisions(id: string) {
  const { data } = await api.get<{ revisions: AssemblyProcedureDocumentDto[] }>(
    `/assembly/procedure-documents/${encodeURIComponent(id)}/revisions`
  );
  return data.revisions;
}

export async function createBlankAssemblyProcedureDocument(name: string, assignment?: { modelCode: string; processId: string }) {
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto; assignmentError?: string | null }>('/assembly/procedure-documents/blank', { name, assignment });
  return { ...data.document, assignmentError: data.assignmentError };
}

export async function addBlankAssemblyProcedurePage(input: { holderToken?: string | null; id: string; accessPassword: string; expectedEditVersion: number }) {
  const { data } = await api.post<{ document: AssemblyProcedureDocumentDto }>(`/assembly/procedure-documents/${encodeURIComponent(input.id)}/pages/blank`, { accessPassword: input.accessPassword, expectedEditVersion: input.expectedEditVersion }, procedureEditHeaders(input.holderToken));
  return data.document;
}
