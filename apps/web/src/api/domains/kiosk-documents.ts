import { api } from '../http';

export type KioskDocumentSource = 'MANUAL' | 'GMAIL';
export type KioskDocumentOcrStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface KioskDocumentSummary {
  id: string;
  title: string;
  displayTitle: string | null;
  filename: string;
  extractedText: string | null;
  ocrStatus: KioskDocumentOcrStatus;
  ocrEngine: string | null;
  ocrStartedAt: string | null;
  ocrFinishedAt: string | null;
  ocrRetryCount: number;
  ocrFailureReason: string | null;
  candidateFhincd: string | null;
  candidateDrawingNumber: string | null;
  candidateProcessName: string | null;
  candidateResourceCd: string | null;
  candidateDocumentNumber: string | null;
  summaryCandidate1: string | null;
  summaryCandidate2: string | null;
  summaryCandidate3: string | null;
  confidenceFhincd: number | null;
  confidenceDrawingNumber: number | null;
  confidenceProcessName: number | null;
  confidenceResourceCd: number | null;
  confidenceDocumentNumber: number | null;
  confirmedFhincd: string | null;
  confirmedDrawingNumber: string | null;
  confirmedProcessName: string | null;
  confirmedResourceCd: string | null;
  confirmedDocumentNumber: string | null;
  confirmedSummaryText: string | null;
  documentCategory: string | null;
  sourceType: KioskDocumentSource;
  gmailMessageId: string | null;
  sourceAttachmentName: string | null;
  pageCount: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface KioskDocumentDetailResponse {
  document: KioskDocumentSummary;
  pageUrls: string[];
}

export async function getKioskDocuments(params?: {
  q?: string;
  sourceType?: KioskDocumentSource;
  ocrStatus?: KioskDocumentOcrStatus;
  includeCandidates?: boolean;
  hideDisabled?: boolean;
}) {
  const { data } = await api.get<{ documents: KioskDocumentSummary[] }>('/kiosk-documents', {
    params: {
      q: params?.q,
      sourceType: params?.sourceType,
      ocrStatus: params?.ocrStatus,
      includeCandidates: params?.includeCandidates,
      hideDisabled: params?.hideDisabled,
    },
  });
  return data.documents;
}

export async function getKioskDocumentDetail(id: string) {
  const { data } = await api.get<KioskDocumentDetailResponse>(`/kiosk-documents/${id}`);
  return data;
}

export async function uploadKioskDocument(payload: { file: File; title?: string }) {
  const formData = new FormData();
  formData.append('file', payload.file);
  if (payload.title?.trim()) {
    formData.append('title', payload.title.trim());
  }
  const { data } = await api.post<KioskDocumentDetailResponse>('/kiosk-documents', formData);
  return data;
}

export async function deleteKioskDocument(id: string) {
  await api.delete(`/kiosk-documents/${id}`);
}

export async function patchKioskDocumentEnabled(id: string, enabled: boolean) {
  const { data } = await api.patch<{ document: KioskDocumentSummary }>(`/kiosk-documents/${id}`, { enabled });
  return data.document;
}

export async function patchKioskDocumentMetadata(
  id: string,
  payload: {
    displayTitle?: string | null;
    confirmedFhincd?: string | null;
    confirmedDrawingNumber?: string | null;
    confirmedProcessName?: string | null;
    confirmedResourceCd?: string | null;
    confirmedDocumentNumber?: string | null;
    confirmedSummaryText?: string | null;
    documentCategory?: string | null;
  }
) {
  const { data } = await api.patch<{ document: KioskDocumentSummary }>(`/kiosk-documents/${id}/metadata`, payload);
  return data.document;
}

export async function triggerKioskDocumentGmailIngest(params?: { scheduleId?: string }) {
  const { data } = await api.post<{ results: unknown[] }>('/kiosk-documents/ingest-gmail', params ?? {});
  return data.results;
}

export async function reprocessKioskDocument(id: string) {
  const { data } = await api.post<KioskDocumentDetailResponse>(`/kiosk-documents/${id}/reprocess`, {});
  return data;
}
