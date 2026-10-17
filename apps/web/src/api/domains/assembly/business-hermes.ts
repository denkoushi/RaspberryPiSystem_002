import { api } from '../../http';

import type { A2uiMessage } from '@a2ui/web_core/v0_9';

export type BusinessHermesGuideResponse = {
  status: 'ready' | 'unavailable' | 'unknown';
  uiRevision: string;
  message: string | null;
  targetKey: 'current-bolt' | null;
  evidence: Array<{
    sourceKind: 'kiosk_document' | 'assembly_procedure_step' | 'assembly_procedure_page_ocr';
    documentId: string;
    documentTitle: string;
    pageIndex: number;
    bodyAvailable: boolean;
    documentUpdatedAt: string;
    bodyScope: 'document' | 'page';
  }>;
  reasonCode?: string;
};

export async function getBusinessHermesAssemblyGuide(
  sessionId: string,
  payload: { uiRevision: string; eventCode: 'USER_REQUEST' | 'TORQUE_NG' | 'PROCEDURE_LOAD_ERROR' | 'CHECK_REQUIRED' },
  signal?: AbortSignal
): Promise<BusinessHermesGuideResponse> {
  const { data } = await api.post<BusinessHermesGuideResponse>(
    `/assembly/work-sessions/${encodeURIComponent(sessionId)}/hermes-guide`,
    payload,
    { signal }
  );
  return data;
}

export type BusinessHermesChatScope = 'nonconformity' | 'work_instruction' | 'both';

export type BusinessHermesChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type BusinessHermesChatEvidence = {
  kind: 'nonconformity' | 'work_instruction';
  id: string;
  title: string;
  partNumber: string;
  originDepartmentCode?: string | null;
  originDepartmentName?: string | null;
  originDepartmentMeaning?: string;
  shootingTarget?: string;
  step?: number;
  sourceStep?: number;
  text: string;
  effectiveText?: string;
  sourceVersionDate?: string;
  source?: Record<string, unknown>;
  sourceUrl?: string;
  publishedVersionId?: string;
  publishedVersionCreatedAt?: string;
  publishedRevisionId?: string | null;
  publishedRevisionCreatedAt?: string | null;
  rawImageLabel?: string;
  imageAssetId?: string;
  imageUrl?: string;
  imageMimeType?: string;
  displayFields?: {
    summary: Array<{ key: string; label: string; value: string }>;
    detail: Array<{ key: string; label: string; value: string }>;
  };
};

export type BusinessHermesChatRequest = {
  scope?: BusinessHermesChatScope;
  partNumber?: string;
  shootingTarget?: string;
  messages: BusinessHermesChatMessage[];
};

export type BusinessHermesChatResponse = {
  status: 'ready' | 'unavailable';
  message: string | null;
  reasonCode?: string;
  evidence: BusinessHermesChatEvidence[];
  partNumber: string | null;
  shootingTarget: string | null;
  needsClarification: boolean;
  clarificationMessage: string | null;
};

export type HermesSearchTrialScope = {
  enabled: boolean;
  snapshotCount?: number;
  organizedCount?: number;
  snapshotId?: string;
};

export type HermesRecordRefine = { axis: 'organization' | 'month' | 'cause'; field: string; value: string };

export type HermesRecordAnswerDisplay = {
  records: Array<{
    sourceLabel: string;
    fields: Array<{ label: string; value: string; role: 'identifier' | 'date' | 'organization' | 'body' }>;
  }>;
  notices: string[];
  groups?: Array<{
    axis: HermesRecordRefine['axis'];
    field: string;
    label: string;
    buckets: Array<{ value: string; label: string; count: number }>;
    otherCount: number;
    otherLabel?: string;
  }>;
  coverage?: { total: number; shown: number };
  dataAsOf: string | null;
};

export type HermesSearchTrialAnswer = {
  status: string;
  answer: string;
  display?: HermesRecordAnswerDisplay;
  recordIds: string[];
  elapsedMs: number;
  confirmationPending?: {
    request: string;
    question: string;
    purpose: string | null;
    requiredItems: Array<{ id: string; label: string; type: string; candidates: unknown[] }>;
    confirmedInfo: Record<string, unknown>;
    unresolvedItems: string[];
  } | null;
};

export type BusinessHermesConsultationItem = {
  id: string;
  title: string;
  relatedIdentifiers: string[];
  confirmedFacts: string[];
  openQuestions: string[];
  summary: string;
  updatedAt: string;
};

export type BusinessHermesConsultationConfirmation = {
  prompt: string;
  options?: string[];
  title?: string;
  relatedIdentifiers?: string[];
  signageProposal?: BusinessHermesSignageProposal;
};

export type BusinessHermesSignageCanvasElement = {
  id: string;
  kind: 'text' | 'visualization';
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  title?: string;
  style?: {
    fontSize?: number;
    fontWeight?: 'normal' | '600' | '700';
    color?: string;
    align?: 'start' | 'middle' | 'end';
    verticalAlign?: 'top' | 'middle' | 'bottom';
  };
  dataSourceType?: 'production_schedule' | 'measuring_instruments' | 'pallet_visualization_board';
  dataSourceConfig?: Record<string, unknown>;
  rendererType?: 'kpi_cards' | 'table' | 'bar_chart' | 'progress_list' | 'pallet_visualization_board';
  rendererConfig?: Record<string, unknown>;
};

export type BusinessHermesSignageProposal = {
  scheduleName?: string;
  scheduleId?: string;
  deviceScopeKey?: string;
  dayOfWeek?: number[];
  startTime?: string;
  endTime?: string;
  priority?: number;
  slideIntervalSeconds?: number;
  seibanPerPage?: number;
  targetClientDeviceIds?: string[];
  enabled?: boolean;
  canvas?: {
    width: number;
    height: number;
    backgroundColor: string;
    elements: BusinessHermesSignageCanvasElement[];
  };
  a2ui?: {
    layoutMessage: A2uiMessage;
    dataMessage: A2uiMessage;
    bindings?: Array<{
      path: string;
      source: { kind: 'visualization' | 'self_inspection' | 'part_measurement'; id: string } | { kind: 'work_instruction'; partNumber: string; shootingTarget: string };
      select: string;
      format: 'text' | 'series' | 'image';
      labelField?: string;
      valueField?: string;
    }>;
  };
};

export type BusinessHermesScanMatch = {
  kind: 'manufacturing_order' | 'part_number' | 'other';
  source: 'production_schedule' | 'nonconformity' | 'work_instruction';
  matchField: 'ProductNo' | 'FSEIBAN' | 'FHINCD' | 'ScawStFutekigoCurrent.partNumber' | 'WorkInstruction.partNumber' | 'WorkInstructionPartAlias.canonicalPartNumber';
  matchedValue: string;
  productNo?: string;
  partNumber?: string;
  serialNumber?: string;
  partName?: string;
};

export type BusinessHermesScanResolution = {
  rawValue: string;
  kind: 'manufacturing_order' | 'part_number' | 'other' | 'unknown';
  ambiguous: boolean;
  candidateCount: number;
  truncated: boolean;
  matches: BusinessHermesScanMatch[];
};

export type BusinessHermesOperationGuideDisplay = {
  screen: string;
  note?: string;
  sections: Array<{ heading: string; body: string }>;
};

export type BusinessHermesConsultationMessage = {
  feedback?: 'pending' | 'helpful' | 'unhelpful';
  id: string;
  role: 'user' | 'assistant';
  content: string;
  evidence: BusinessHermesChatEvidence[];
  evidenceVisible?: boolean;
  evidenceVisibleIds?: string[];
  recordIds?: string[];
  recordView?: 'summary' | 'detail';
  guide?: BusinessHermesOperationGuideDisplay;
  confirmation?: BusinessHermesConsultationConfirmation;
  selection?: { prompt: string; option: string };
  scan?: BusinessHermesScanResolution;
  createdAt: string;
};

export type BusinessHermesConsultationDetail = BusinessHermesConsultationItem & {
  messages: BusinessHermesConsultationMessage[];
  messagesNextCursor?: string | null;
};

export type BusinessHermesConsultationPatch = {
  title?: string;
  relatedIdentifiers?: string[];
};

export type BusinessHermesConsultationChatResponse = {
  status: 'ready' | 'unavailable';
  message: string | null;
  reasonCode?: string;
  evidence: BusinessHermesChatEvidence[];
  evidenceVisible?: boolean;
  evidenceVisibleIds?: string[];
  recordIds?: string[];
  recordView?: 'summary' | 'detail';
  guide?: BusinessHermesOperationGuideDisplay;
  needsClarification: boolean;
  clarificationMessage: string | null;
  consultationId: string;
  consultation: BusinessHermesConsultationDetail;
  /** Present only when Hermes explicitly asks the user to confirm a candidate. */
  confirmation?: BusinessHermesConsultationConfirmation;
};

type BusinessHermesConsultationEnvelope = {
  consultation: BusinessHermesConsultationDetail;
};

export type BusinessHermesConsultationListResponse = {
  consultations: BusinessHermesConsultationItem[];
  enabled: boolean;
};

export async function getHermesSearchTrialScope(signal?: AbortSignal): Promise<HermesSearchTrialScope> {
  const { data } = await api.get<HermesSearchTrialScope>('/assembly/hermes-search-trial/scope', { signal });
  return data;
}

export type HermesPageContext = {
  path: string;
  entity: {
    kind: 'partNumber' | 'drawingNumber' | 'nonconformityNo' | 'procedureId';
    value: string;
  };
};

export async function sendHermesSearchTrialAnswer(
  payload: { question: string; sessionId: string; pageContext?: HermesPageContext; refine?: HermesRecordRefine },
  signal?: AbortSignal
): Promise<HermesSearchTrialAnswer> {
  const { data } = await api.post<HermesSearchTrialAnswer>(
    '/assembly/hermes-search-trial/answer',
    payload,
    { signal, timeout: 35_000 }
  );
  return data;
}

function unwrapBusinessHermesConsultation(
  data: BusinessHermesConsultationEnvelope
): BusinessHermesConsultationDetail {
  return data.consultation;
}

function unwrapBusinessHermesConsultationList(
  data: BusinessHermesConsultationListResponse
): BusinessHermesConsultationListResponse {
  return data;
}

export async function listBusinessHermesConsultations(signal?: AbortSignal): Promise<BusinessHermesConsultationListResponse> {
  const { data } = await api.get<BusinessHermesConsultationListResponse>(
    '/assembly/business-hermes/consultations',
    { signal }
  );
  return unwrapBusinessHermesConsultationList(data);
}

export async function createBusinessHermesConsultation(signal?: AbortSignal): Promise<BusinessHermesConsultationDetail> {
  const { data } = await api.post<BusinessHermesConsultationEnvelope>(
    '/assembly/business-hermes/consultations',
    {},
    { signal }
  );
  return unwrapBusinessHermesConsultation(data);
}

export async function getBusinessHermesConsultation(
  consultationId: string,
  messageCursor?: string,
  signal?: AbortSignal
): Promise<BusinessHermesConsultationDetail> {
  const query = messageCursor ? `?messageCursor=${encodeURIComponent(messageCursor)}` : '';
  const { data } = await api.get<{ consultation: BusinessHermesConsultationDetail }>(
    `/assembly/business-hermes/consultations/${encodeURIComponent(consultationId)}${query}`,
    { signal }
  );
  return unwrapBusinessHermesConsultation(data);
}

export async function updateBusinessHermesConsultation(
  consultationId: string,
  payload: BusinessHermesConsultationPatch,
  signal?: AbortSignal
): Promise<BusinessHermesConsultationDetail> {
  const { data } = await api.patch<BusinessHermesConsultationEnvelope>(
    `/assembly/business-hermes/consultations/${encodeURIComponent(consultationId)}`,
    payload,
    { signal }
  );
  return unwrapBusinessHermesConsultation(data);
}

export async function cancelBusinessHermesConsultation(consultationId: string): Promise<void> {
  await api.post(`/assembly/business-hermes/consultations/${encodeURIComponent(consultationId)}/cancel`, {});
}

export async function sendBusinessHermesConsultationMessage(
  payload: { consultationId: string; message: string; selection?: { prompt: string; option: string }; scanValue?: string },
  signal?: AbortSignal
): Promise<BusinessHermesConsultationChatResponse> {
  const { data } = await api.post<BusinessHermesConsultationChatResponse>(
    '/assembly/business-hermes/chat',
    payload,
    { signal, timeout: BUSINESS_HERMES_CHAT_HTTP_TIMEOUT_MS }
  );
  return data;
}

// The common web client timeout is 120s, but one chat request can perform
// intent extraction and answer generation sequentially. Keep this UI wait
// bound separate; cancellation through the caller's signal remains effective.
const BUSINESS_HERMES_CHAT_HTTP_TIMEOUT_MS = 600_000;

export async function sendBusinessHermesChat(
  payload: BusinessHermesChatRequest,
  signal?: AbortSignal
): Promise<BusinessHermesChatResponse> {
  const { data } = await api.post<BusinessHermesChatResponse>(
    '/assembly/business-hermes/chat',
    payload,
    { signal, timeout: BUSINESS_HERMES_CHAT_HTTP_TIMEOUT_MS }
  );
  return data;
}

export type BusinessHermesProactiveSuggestion = {
  id: string;
  sessionId: string;
  clientDeviceId: string;
  eventCode: string;
  status: 'ready' | 'unavailable' | 'unknown' | string;
  reasonCode: string | null;
  message: string | null;
  targetKey: string | null;
  evidence: BusinessHermesGuideResponse['evidence'];
  createdAt: string;
};

export async function listBusinessHermesProactiveSuggestions(limit = 50) {
  const { data } = await api.get<{ suggestions: BusinessHermesProactiveSuggestion[] }>(
    `/assembly/business-hermes/proactive-suggestions?limit=${Math.min(Math.max(limit, 1), 100)}`
  );
  return data.suggestions;
}

export async function recordBusinessHermesFeedback(consultationId: string, messageId: string, verdict: 'helpful' | 'unhelpful'): Promise<void> {
  await api.post(`/assembly/business-hermes/consultations/${consultationId}/feedback`, { messageId, verdict });
}
