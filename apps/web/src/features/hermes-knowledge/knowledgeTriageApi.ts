import { api } from '../../api/http';

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

export type TriageDestination =
  | { procedureId: string }
  | { newTopic: { target: string; workType: string; detail?: string; partNumber?: string } };

/** Verifies the scanned tag and returns the poster's undecided posts. */
export async function fetchPendingTriage(posterTagUid: string, signal?: AbortSignal) {
  const { data } = await api.post<{ posterName: string; items: PendingTriageItem[] }>('/hermes-knowledge/triage/pending', { posterTagUid }, { signal });
  return data;
}

export async function decideTriage(intakeId: string, posterTagUid: string, destination: TriageDestination) {
  const { data } = await api.post<{ procedureId: string }>(`/hermes-knowledge/triage/${encodeURIComponent(intakeId)}/decide`, { posterTagUid, destination });
  return data;
}

export async function searchProcedureTopics(q: string, signal?: AbortSignal) {
  const { data } = await api.get<{ topics: ProcedureTopicView[] }>('/hermes-knowledge/procedure-topics', { params: { q }, signal });
  return data.topics;
}

export async function fetchWorkTypes(signal?: AbortSignal) {
  const { data } = await api.get<{ workTypes: string[] }>('/hermes-knowledge/work-types', { signal });
  return data.workTypes;
}
