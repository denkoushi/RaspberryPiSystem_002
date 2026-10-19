import { api } from '../../api/http';

import type {
  KnowledgeErrorReportRequest, KnowledgePendingReviewsResponse, KnowledgePositionRanksRequest,
  KnowledgePositionRanksResponse, KnowledgeReviewDetailResponse, KnowledgeReviewRequest, KnowledgeReturnRequest,
} from '@raspi-system/shared-types';

export async function listKnowledgePendingReviews(body: KnowledgeReviewRequest, signal?: AbortSignal) {
  const { data } = await api.post<KnowledgePendingReviewsResponse>('/hermes-knowledge/reviews/pending', body, { signal });
  return data;
}

export async function getKnowledgeReview(revisionId: string, body: KnowledgeReviewRequest) {
  const { data } = await api.post<KnowledgeReviewDetailResponse>(`/hermes-knowledge/reviews/${encodeURIComponent(revisionId)}/detail`, body);
  return data.procedure;
}

export async function approveKnowledgeReview(revisionId: string, body: KnowledgeReviewRequest) {
  await api.post(`/hermes-knowledge/reviews/${encodeURIComponent(revisionId)}/approve`, body);
}

export async function returnKnowledgeReview(revisionId: string, body: KnowledgeReturnRequest) {
  await api.post(`/hermes-knowledge/reviews/${encodeURIComponent(revisionId)}/return`, body);
}

export async function reportKnowledgeError(procedureId: string, body: KnowledgeErrorReportRequest) {
  await api.post(`/hermes-knowledge/procedures/${encodeURIComponent(procedureId)}/error-report`, body);
}

export async function getKnowledgeCapabilities(signal?: AbortSignal) {
  const { data } = await api.get<{ enabled: boolean }>('/hermes-knowledge/capabilities', { signal });
  return data;
}

export async function getKnowledgePositionRanks() {
  const { data } = await api.get<KnowledgePositionRanksResponse>('/hermes-knowledge/position-ranks');
  return data;
}

export async function saveKnowledgePositionRanks(body: KnowledgePositionRanksRequest) {
  await api.put('/hermes-knowledge/position-ranks', body);
}

export function knowledgeReviewImagePath(revisionId: string, imageId: string) {
  return `/api/hermes-knowledge/reviews/${encodeURIComponent(revisionId)}/images/${encodeURIComponent(imageId)}`;
}
