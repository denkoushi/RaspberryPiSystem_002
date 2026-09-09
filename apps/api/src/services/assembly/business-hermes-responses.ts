import { asEvidenceIds, requestedRecordIds } from './business-hermes-evidence.js';

type JsonRecord = Record<string, unknown>;
type ResponsesOutputItem = JsonRecord & { type?: string };

export type BusinessHermesConsultationConfirmation = {
  prompt: string;
  options?: string[];
  title?: string;
  relatedIdentifiers?: string[];
};

const MAX_MESSAGE_CHARS = 4_000;
export const MAX_SUMMARY_CHARS = 2_000;
const KNOWN_UPSTREAM_FAILURE = /^API call failed after \d+ retries:\s+HTTP \d{3}:\s+bad gateway:\s+\[Errno 111\]\s+Connection refused$/iu;

export function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim().slice(0, 500));
}

export function asConfirmation(value: unknown): BusinessHermesConsultationConfirmation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as JsonRecord;
  const prompt = cleanMessage(record.prompt);
  if (!prompt) return undefined;
  const options = [...new Set(asStrings(record.options))].filter((option) => option.length <= 120).slice(0, 5);
  const title = cleanMessage(record.title);
  const relatedIdentifiers = asStrings(record.relatedIdentifiers).slice(0, 10);
  return { prompt: prompt.slice(0, 500), ...(options.length >= 2 ? { options } : {}), ...(title ? { title: title.slice(0, 200) } : {}), ...(relatedIdentifiers.length > 0 ? { relatedIdentifiers } : {}) };
}


export function cleanMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!normalized) return null;
  return normalized;
}

function isPlainKnownUpstreamFailure(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const cleaned = cleanMessage(value);
  if (!cleaned || parseJson(cleaned) !== null || cleaned.startsWith('{')) return false;
  return KNOWN_UPSTREAM_FAILURE.test(cleaned);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { return null; }
}

function extractEmbeddedJson(value: string, preferLast = false): unknown {
  const parsed = parseJson(value);
  if (parsed !== null) return parsed;
  let start = value.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = parseJson(value.slice(start, index + 1));
        const next = preferLast ? value.indexOf('{', index + 1) : -1;
        if (next < 0) return candidate;
        start = next;
        index = next - 1;
      }
    }
  }
  return null;
}

function unwrapToolResult(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.flatMap((part) => part && typeof part === 'object'
      && part.type === 'input_text' && typeof part.text === 'string'
      ? [unwrapToolResult(part.text)] : []);
  }
  if (typeof value !== 'string') return value;
  const body = value.replace(/^<untrusted_tool_result[^>]*>\s*/i, '').replace(/\s*<\/untrusted_tool_result>$/i, '').trim();
  const parsed = extractEmbeddedJson(body);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const result = (parsed as JsonRecord).result;
    return result === undefined ? parsed : typeof result === 'string' ? extractEmbeddedJson(result) : result;
  }
  return parsed;
}

function responseMessageText(value: unknown): { message: string | null; structured: boolean } {
  const cleaned = cleanMessage(value);
  if (!cleaned) return { message: null, structured: false };
  // Native Responses may concatenate tool-phase drafts and the final answer.
  // Only the last complete response object represents the finished turn.
  const parsed = extractEmbeddedJson(cleaned, true);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as JsonRecord;
    const message = cleanMessage(record.message);
    // Hermes may put a closing acknowledgement before an otherwise valid state
    // object. Keep that visible prose and never expose the metadata as chat text.
    const prefix = record.message === undefined && typeof record.title === 'string' && typeof record.summary === 'string'
      ? cleanMessage(cleaned.slice(0, cleaned.indexOf('{')).replace(/```(?:json)?\s*$/i, '')) : null;
    return { message: message ?? prefix, structured: true };
  }
  // A malformed canonical object must not be shown verbatim to the operator.
  // Returning null makes the caller surface the normal unavailable result.
  if (cleaned.startsWith('{') || /(?:^|[,{]\s*)"message"\s*:/.test(cleaned)) return { message: null, structured: true };
  return { message: cleaned, structured: false };
}

export function responseMessage(response: JsonRecord): string | null {
  const direct = cleanMessage(response.output_text);
  if (direct) {
    return responseMessageText(direct).message;
  }
  const output = Array.isArray(response.output) ? response.output as ResponsesOutputItem[] : [];
  const messages: string[] = [];
  let malformedStructuredMessage = false;
  for (const item of output) {
    if (item.type !== 'message') continue;
    const content = Array.isArray(item.content) ? item.content as JsonRecord[] : [];
    for (const part of content) {
      const value = responseMessageText(part.text ?? part.output_text ?? part.value);
      if (value.message) messages.push(value.message);
      else if (value.structured) malformedStructuredMessage = true;
    }
  }
  if (messages.length === 0 && malformedStructuredMessage) return null;
  return messages.join('\n').slice(0, MAX_SUMMARY_CHARS) || null;
}

/**
 * The Hermes gateway can return a completed envelope whose only text is its
 * retry failure. Treat that fixed adapter output as transport failure; a
 * structured JSON message that quotes the same text remains a normal answer.
 */
export function isKnownUpstreamFailureResponse(response: JsonRecord): boolean {
  const direct = cleanMessage(response.output_text);
  if (direct) return isPlainKnownUpstreamFailure(direct);
  const output = Array.isArray(response.output) ? response.output as ResponsesOutputItem[] : [];
  const messageValues: unknown[] = [];
  for (const item of output) {
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content as JsonRecord[]) {
      messageValues.push(part.text ?? part.output_text ?? part.value);
    }
  }
  return isPlainKnownUpstreamFailure(messageValues.at(-1));
}

function outputItems(response: JsonRecord): ResponsesOutputItem[] {
  return Array.isArray(response.output) ? response.output.filter((item): item is ResponsesOutputItem => Boolean(item && typeof item === 'object')) as ResponsesOutputItem[] : [];
}

function isTrustedBusinessToolName(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value === 'business_hermes_search' || value === 'business_hermes_get_detail') return true;
  return value === 'mcp__business_api__business_hermes_search'
    || value === 'mcp__business_api__business_hermes_get_detail';
}

function trustedBusinessToolCallIds(items: ReadonlyArray<ResponsesOutputItem>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item.type !== 'function_call' && item.type !== 'tool_call') continue;
    const callId = typeof item.call_id === 'string' ? item.call_id : typeof item.callId === 'string' ? item.callId : null;
    if (!callId) continue;
    const nested = parseJson(item.arguments);
    const nestedName = nested && typeof nested === 'object' && !Array.isArray(nested) ? (nested as JsonRecord).name : undefined;
    if (isTrustedBusinessToolName(item.name)
      || (item.name === 'tool_call' && isTrustedBusinessToolName(nestedName))) ids.add(callId);
  }
  return ids;
}

export function searchDiagnostics(response: JsonRecord): Array<Record<string, unknown>> {
  const items = outputItems(response);
  const trusted = trustedBusinessToolCallIds(items);
  const calls = new Map(items.filter((item) => item.type === 'function_call')
    .map((item) => [item.call_id, item]));
  const diagnostics: Array<Record<string, unknown>> = [];
  for (const item of items) {
    if (item.type !== 'function_call_output' || typeof item.call_id !== 'string' || !trusted.has(item.call_id)) continue;
    const call = calls.get(item.call_id);
    const args = parseJson(call?.arguments);
    const raw = unwrapToolResult(item.output);
    for (const result of Array.isArray(raw) ? raw : [raw]) {
      if (!result || typeof result !== 'object' || !Array.isArray(result.results)) continue;
      diagnostics.push({
        arguments: call?.name === 'tool_call' && args && typeof args === 'object'
          ? (args as JsonRecord).arguments : args,
        total: typeof result.total === 'number' ? result.total : null,
        truncated: result.truncated === true,
        resultIds: result.results.map((entry: JsonRecord) => entry.id).filter((id: unknown) => typeof id === 'string')
      });
    }
  }
  return diagnostics;
}

export function evidenceObjects(response: JsonRecord): JsonRecord[] {
  const values: JsonRecord[] = [];
  const items = outputItems(response);
  const trustedCallIds = trustedBusinessToolCallIds(items);
  const visit = (value: unknown, inherited: JsonRecord = {}) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry, inherited);
      return;
    }
    const record = value as JsonRecord;
    const merged = { ...inherited, ...record };
    const hasText = typeof merged.text === 'string' || typeof merged.effectiveText === 'string'
      || typeof merged.condition === 'string' || typeof merged.remarks === 'string'
      || typeof merged.correctiveContent === 'string' || typeof merged.disposition === 'string';
    const hasStep = merged.step !== undefined || merged.sourceStep !== undefined || merged.source_step !== undefined;
    const hasAsset = typeof merged.imageAssetId === 'string' || typeof merged.asset_id === 'string';
    const childKeys = ['evidence', 'results', 'matches', 'cases', 'nonconformities', 'workInstructions', 'rows', 'steps'];
    const hasChildren = childKeys.some((key) => record[key] !== undefined);
    const ownId = typeof record.id === 'string' ? record.id : typeof record.evidence_id === 'string' ? record.evidence_id : undefined;
    const effectiveId = typeof merged.id === 'string' ? merged.id : typeof merged.evidence_id === 'string' ? merged.evidence_id : undefined;
    const hasPartNumber = typeof merged.partNumber === 'string' || typeof merged.part_number === 'string';
    const hasKnownKind = merged.kind === 'work_instruction' || merged.kind === 'work-instruction' || merged.kind === 'nonconformity';
    // Nonconformity records can legitimately omit a part number; their source ID remains authoritative.
    const isLeaf = Boolean(effectiveId && hasKnownKind && (hasPartNumber || merged.kind === 'nonconformity') && hasText && !hasChildren && (hasStep || merged.kind === 'nonconformity' || hasAsset));
    if (isLeaf) {
      // A parent work-instruction id is often inherited by a step object that
      // omits its own id. Give that leaf a stable row/step identity so the
      // parent cannot consume the card and sibling steps cannot deduplicate.
      const parentId = typeof inherited.id === 'string' ? inherited.id : undefined;
      const rowId = typeof merged.rowId === 'string' ? merged.rowId : typeof merged.row_id === 'string' ? merged.row_id : undefined;
      const stepValue = merged.step ?? merged.sourceStep ?? merged.source_step;
      const generatedId = hasStep && parentId && (!ownId || ownId === parentId)
        ? `${parentId}${rowId ? `:row:${rowId}` : ''}:step:${String(stepValue)}`
        : effectiveId;
      values.push({ ...merged, id: generatedId });
    }
    if (isLeaf) return;
    for (const key of childKeys) {
      if (record[key] !== undefined) visit(record[key], merged);
    }
  };
  for (const item of items) {
    if (item.type !== 'function_call_output') continue;
    const callId = typeof item.call_id === 'string' ? item.call_id : typeof item.callId === 'string' ? item.callId : null;
    if (!callId || !trustedCallIds.has(callId)) continue;
    const raw = unwrapToolResult(item.output);
    visit(raw);
  }
  return values;
}

export function modelState(response: JsonRecord, answer: string): {
  title?: string;
  relatedIdentifiers?: string[];
  confirmedFacts?: string[];
  openQuestions?: string[];
  summary?: string;
  message?: string;
  showEvidence?: boolean;
  evidenceIds?: string[];
  recordIds?: string[];
  recordIdsInvalid?: boolean;
  recordView?: 'summary' | 'detail';
  needsClarification?: boolean;
  confirmation?: BusinessHermesConsultationConfirmation;
} {
  const messageTexts = outputItems(response)
    .filter((item) => item.type === 'message' && Array.isArray(item.content))
    .flatMap((item) => (item.content as JsonRecord[]).map((part) => typeof part.text === 'string' ? part.text : ''));
  const candidates = [
    typeof response.output_text === 'string' ? response.output_text : null,
    ...messageTexts,
    answer
  ].filter((candidate): candidate is string => Boolean(candidate));
  for (const candidate of candidates) {
    const parsed = extractEmbeddedJson(candidate, true);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = parsed as JsonRecord;
    const hasState = ['title', 'relatedIdentifiers', 'related_identifiers', 'confirmedFacts', 'confirmed_facts', 'openQuestions', 'open_questions', 'summary', 'message', 'showEvidence', 'show_evidence', 'evidenceIds', 'evidence_ids', 'recordIds', 'record_ids', 'recordView', 'record_view', 'needsClarification', 'needs_clarification', 'confirmation']
      .some((key) => record[key] !== undefined);
    if (!hasState) continue;
    const recordIdValue = record.recordIds !== undefined ? record.recordIds : record.record_ids;
    const parsedRecordIds = recordIdValue !== undefined ? requestedRecordIds(recordIdValue) : { ids: [], invalid: false };
    return {
      title: typeof record.title === 'string' ? record.title : undefined,
      relatedIdentifiers: record.relatedIdentifiers !== undefined || record.related_identifiers !== undefined ? asStrings(record.relatedIdentifiers ?? record.related_identifiers) : undefined,
      confirmedFacts: record.confirmedFacts !== undefined || record.confirmed_facts !== undefined ? asStrings(record.confirmedFacts ?? record.confirmed_facts) : undefined,
      openQuestions: record.openQuestions !== undefined || record.open_questions !== undefined ? asStrings(record.openQuestions ?? record.open_questions) : undefined,
      summary: typeof record.summary === 'string' ? record.summary : undefined,
      message: typeof record.message === 'string' ? cleanMessage(record.message) ?? undefined : undefined,
      showEvidence: typeof record.showEvidence === 'boolean'
        ? record.showEvidence
        : typeof record.show_evidence === 'boolean' ? record.show_evidence : undefined,
      evidenceIds: record.evidenceIds !== undefined || record.evidence_ids !== undefined
        ? asEvidenceIds(record.evidenceIds ?? record.evidence_ids) : undefined,
      recordIds: record.recordIds !== undefined || record.record_ids !== undefined ? parsedRecordIds.ids : undefined,
      recordIdsInvalid: parsedRecordIds.invalid,
      recordView: record.recordView === 'detail' || record.record_view === 'detail'
        ? 'detail'
        : record.recordView === 'summary' || record.record_view === 'summary' ? 'summary' : undefined,
      needsClarification: typeof record.needsClarification === 'boolean'
        ? record.needsClarification
        : typeof record.needs_clarification === 'boolean' ? record.needs_clarification : undefined,
      confirmation: asConfirmation(record.confirmation)
    };
  }
  return {};
}

export function responseStatus(response: JsonRecord): string {
  return typeof response.status === 'string' ? response.status : 'completed';
}


function parseSseLine(value: string): JsonRecord | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[DONE]' || !trimmed.startsWith('data:')) return null;
  const parsed = parseJson(trimmed.slice(5).trim());
  return parsed && typeof parsed === 'object' ? parsed as JsonRecord : null;
}

export async function readResponsesStream(response: Response, signal: AbortSignal): Promise<JsonRecord> {
  if (!response.body) return await response.json() as JsonRecord;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let final: JsonRecord | null = null;
  let terminalReceived = false;
  const fullToolItems = new Map<string, ResponsesOutputItem>();
  const toolItemKey = (item: ResponsesOutputItem): string | null => (
    (item.type === 'function_call' || item.type === 'function_call_output') && typeof item.call_id === 'string'
      ? `${item.type}:${item.call_id}` : null
  );
  const consume = (event: JsonRecord | null) => {
    if (!event) return;
    if (event.type === 'response.output_item.done' && event.item && typeof event.item === 'object') {
      const item = event.item as ResponsesOutputItem;
      const key = toolItemKey(item);
      if (key) fullToolItems.set(key, item);
    }
    if (event.response && typeof event.response === 'object') final = event.response as JsonRecord;
    if (['response.completed', 'response.incomplete', 'response.failed'].includes(String(event.type))) terminalReceived = true;
  };
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      const part = await reader.read();
      if (part.done) break;
      pending += decoder.decode(part.value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) consume(parseSseLine(line));
    }
    consume(parseSseLine(pending + decoder.decode()));
    const envelope: JsonRecord = final ?? { status: 'incomplete', output: [] };
    const output = outputItems(envelope).map((item) => {
      const key = toolItemKey(item);
      const full = key ? fullToolItems.get(key) : undefined;
      if (key) fullToolItems.delete(key);
      return full ?? item;
    });
    // Fixed Hermes trims long tool results in response.completed. The earlier
    // output_item.done event is the complete, authoritative payload.
    output.push(...fullToolItems.values());
    return { ...envelope, status: terminalReceived ? envelope.status : 'incomplete', output };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}
