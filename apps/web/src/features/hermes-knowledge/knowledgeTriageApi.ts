import { api } from '../../api/http';

import type { KnowledgeDestination, KnowledgeFieldsResponse, KnowledgeSubjectsResponse } from '@raspi-system/shared-types';


export type TriageSuggestionsView = {
  candidates: { procedureId: string; title: string; reason: string }[];
  proposal: {
    parts: { target: string; workType: string; detail?: string }; title: string;
    identifiers: { partNumber?: string; drawingNumber?: string; processName?: string }; reviewTier: string; reason: string;
  } | null;
  confidence: number;
};

export type TriageView = { state: 'suggesting' | 'awaiting' | 'decided'; suggestions: TriageSuggestionsView | null; decidedProcedureId: string | null };

export type PendingTriageItem = {
  intakeId: string; text: string; createdAt: string; scannedPartNumber: string | null;
  files: { filename: string; kind: 'image' | 'pdf' }[]; state: TriageView['state']; suggestions: TriageSuggestionsView | null;
};

export type ProcedureTopicView = { procedureId: string; title: string; parts: { target: string; workType: string; detail?: string } | null };

export type TriageDestination = KnowledgeDestination;

/** Verifies the scanned tag and returns the poster's undecided posts. */
export async function fetchPendingTriage(posterTagUid: string, signal?: AbortSignal) {
  const { data } = await api.post<{ posterName: string; items: PendingTriageItem[] }>('/hermes-knowledge/triage/pending', { posterTagUid }, { signal });
  return data;
}

export async function decideTriage(intakeId: string, posterTagUid: string, destination: TriageDestination) {
  const { data } = await api.post<{ procedureId: string }>(`/hermes-knowledge/triage/${encodeURIComponent(intakeId)}/decide`, { posterTagUid, destination });
  return data;
}

export async function searchProcedureTopics(q: string, signal?: AbortSignal, target?: string) {
  const { data } = await api.get<{ topics: ProcedureTopicView[] }>('/hermes-knowledge/procedure-topics', { params: { q, ...(target !== undefined ? { target } : {}) }, signal });
  return data.topics;
}

export async function fetchWorkTypes(signal?: AbortSignal) {
  const { data } = await api.get<{ workTypes: string[] }>('/hermes-knowledge/work-types', { signal });
  return data.workTypes;
}

export async function fetchFields(signal?: AbortSignal) {
  const { data } = await api.get<KnowledgeFieldsResponse>('/hermes-knowledge/fields', { signal });
  return data.fields;
}
export async function searchSubjects(q: string, signal?: AbortSignal) {
  const { data } = await api.get<KnowledgeSubjectsResponse>('/hermes-knowledge/subjects', { params: { q }, signal });
  return data.subjects;
}
export async function recentSubjects(posterTagUid: string, signal?: AbortSignal) {
  const { data } = await api.post<KnowledgeSubjectsResponse>('/hermes-knowledge/subjects/recent', { posterTagUid }, { signal });
  return data.subjects;
}
