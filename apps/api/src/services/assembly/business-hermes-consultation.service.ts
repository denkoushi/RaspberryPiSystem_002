import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';
import type { LocalLlmRuntimeControllerPort } from '../inference/runtime/local-llm-runtime-control.port.js';

type FetchLike = typeof fetch;

export type BusinessHermesConsultationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  evidence: ReadonlyArray<Record<string, unknown>>;
  evidenceVisible?: boolean;
  confirmation?: BusinessHermesConsultationConfirmation;
  searchDiagnostics: ReadonlyArray<Record<string, unknown>>;
  createdAt: string;
};

export type BusinessHermesConsultation = {
  id: string;
  title: string;
  relatedIdentifiers: string[];
  confirmedFacts: string[];
  openQuestions: string[];
  summary: string;
  updatedAt: string;
  enabled: boolean;
};

export type BusinessHermesConsultationDetail = BusinessHermesConsultation & {
  messages: BusinessHermesConsultationMessage[];
  messagesNextCursor?: string | null;
};

export type BusinessHermesConsultationConfirmation = {
  prompt: string;
  options?: string[];
  title?: string;
  relatedIdentifiers?: string[];
};

export type ConsultationEvidence = {
  kind: 'nonconformity' | 'work_instruction';
  id: string;
  title: string;
  partNumber: string;
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
};

export type BusinessHermesConsultationChatResponse = {
  status: 'ready' | 'unavailable';
  message: string | null;
  evidence: ReadonlyArray<ConsultationEvidence>;
  evidenceVisible?: boolean;
  needsClarification: boolean;
  clarificationMessage: string | null;
  reasonCode?: string;
  confirmation?: BusinessHermesConsultationConfirmation;
  consultationId: string;
  consultation: BusinessHermesConsultationDetail;
};

type ConsultationDeps = {
  db?: PrismaClient;
  fetchImpl?: FetchLike;
  runtime?: LocalLlmRuntimeControllerPort | null;
  config?: {
    baseUrl?: string;
    apiKey?: string;
    model?: string;
    provider?: 'dgx' | 'openai';
    timeoutMs?: number;
  };
  activeAssetLookup?: (assetIds: ReadonlyArray<string>) => Promise<ReadonlyArray<{ id: string; mimeType: string }>>;
};

type JsonRecord = Record<string, unknown>;
type ResponsesOutputItem = JsonRecord & { type?: string };

const MAX_MESSAGE_CHARS = 4_000;
const MAX_EVIDENCE = 24;
const MAX_HISTORY = 40;
const MAX_SUMMARY_CHARS = 2_000;
const activeControllers = new Map<string, AbortController>();
const inFlight = new Map<string, Promise<BusinessHermesConsultationChatResponse>>();

// Business behavior belongs to the official SOUL/Context/Skill profile.
// This instruction is only the application response and case-state contract.
const CANONICAL_STATE_INSTRUCTIONS = [
  'SOUL・業務Context・関連Skillに従って対話してください。アプリへ返す最終回答はJSONオブジェクト1個だけです。挨拶や相談終了も同じ形式で、JSONの外に文章やMarkdownを書きません。',
  '必須キーは message（利用者への簡潔な日本語の回答）、title（現在の相談名）、relatedIdentifiers（業務上の番号・工程名の配列）、confirmedFacts（根拠のある確認済み事項の配列）、openQuestions（現在の依頼を解決するための未確認事項の配列）、summary（引継ぎ要約）、showEvidence（根拠・出典・写真の表示が今回必要ならtrue、通常はfalse）、confirmation（任意の次の操作を選ぶ問いと選択肢、不要ならnull）です。文字列・配列に値がなければ空文字・空配列とし、全キーを含めます。',
  'title・openQuestions・summaryにも、利用者が依頼した範囲と根拠を守ってください。検索で別工程が見つかっただけでは、それを次の工程・未実施作業・今後の確認予定にしません。資料間の順序も推定しません。提案と合意済みの予定を混ぜず、不具合が報告されていない相談名に不具合を加えません。',
  '利用者が答えを選ぶ必要がある確認、または回答後に役立つ任意の次の調査があるときは、本文だけで終えずconfirmationとoptionsを返してください。任意の次の操作は未解決事項ではなく、回答済みの本文に添える候補です。confirmation: {"prompt": "問いまたは次の操作", "options": ["選択肢1", "選択肢2"]} とし、選択肢は2～5個、各120文字以内です。例は「処置を詳しく見る」「関連する要領書を探す」「根拠を確認する」です。単一の実施確認ならoptionsは["はい", "いいえ"]、複数候補なら各候補名と必要に応じて「どれでもない」を渡してください。「AかBか」に「はい／いいえ」を使いません。自由回答の問いはmessageで尋ね、confirmationを付けません。optionsがなければ画面はボタンを作りません。未解決の問いだけをopenQuestionsに入れ、問いはmessageにも提示してください。',
  '案件情報は自動保存します。相談名・関連番号の入力や保存承認を利用者に求めません。内部レコードID・版ID・写真IDは本文やrelatedIdentifiersに入れません。出典・写真カードは取得結果からサーバーが生成するため、URLを創作・再記載しません。',
  '前回の案件状態はAIの引継ぎであり、正式な業務資料ではありません。訂正時は古い前提・関連付け・未解決事項を置き換えます。過去資料の事実と現在の相談について確認した事実を区別してください。'
].join(' ');

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim().slice(0, 500));
}

function asConfirmation(value: unknown): BusinessHermesConsultationConfirmation | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as JsonRecord;
  const prompt = cleanMessage(record.prompt);
  if (!prompt) return undefined;
  const options = [...new Set(asStrings(record.options))].filter((option) => option.length <= 120).slice(0, 5);
  const title = cleanMessage(record.title);
  const relatedIdentifiers = asStrings(record.relatedIdentifiers).slice(0, 10);
  return { prompt: prompt.slice(0, 500), ...(options.length >= 2 ? { options } : {}), ...(title ? { title: title.slice(0, 200) } : {}), ...(relatedIdentifiers.length > 0 ? { relatedIdentifiers } : {}) };
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return (value === undefined ? null : value) as Prisma.InputJsonValue;
}

function cleanMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, MAX_MESSAGE_CHARS);
  if (!normalized) return null;
  return normalized;
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

function responseMessage(response: JsonRecord): string | null {
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

function searchDiagnostics(response: JsonRecord): Array<Record<string, unknown>> {
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

function evidenceObjects(response: JsonRecord): JsonRecord[] {
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

function modelState(response: JsonRecord, answer: string): {
  title?: string;
  relatedIdentifiers?: string[];
  confirmedFacts?: string[];
  openQuestions?: string[];
  summary?: string;
  message?: string;
  showEvidence?: boolean;
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
    const hasState = ['title', 'relatedIdentifiers', 'related_identifiers', 'confirmedFacts', 'confirmed_facts', 'openQuestions', 'open_questions', 'summary', 'message', 'showEvidence', 'show_evidence', 'confirmation']
      .some((key) => record[key] !== undefined);
    if (!hasState) continue;
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
      confirmation: asConfirmation(record.confirmation)
    };
  }
  return {};
}

function responseStatus(response: JsonRecord): string {
  return typeof response.status === 'string' ? response.status : 'completed';
}

function storedEvidence(value: unknown): { items: Record<string, unknown>[]; visible: boolean } {
  if (Array.isArray(value)) {
    return {
      items: value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object')),
      visible: false
    };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { items: [], visible: false };
  const record = value as JsonRecord;
  return {
    items: Array.isArray(record.items)
      ? record.items.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      : [],
    visible: record.visible === true
  };
}

function parseSseLine(value: string): JsonRecord | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '[DONE]' || !trimmed.startsWith('data:')) return null;
  const parsed = parseJson(trimmed.slice(5).trim());
  return parsed && typeof parsed === 'object' ? parsed as JsonRecord : null;
}

async function readResponsesStream(response: Response, signal: AbortSignal): Promise<JsonRecord> {
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

function iso(value: Date): string { return value.toISOString(); }

export function toConsultationView(row: {
  id: string;
  title: string | null;
  relatedIdentifiers: unknown;
  confirmedFacts: unknown;
  openQuestions: unknown;
  summary: string | null;
  updatedAt: Date;
}, enabled = true): BusinessHermesConsultation {
  return {
    id: row.id,
    title: row.title ?? '',
    relatedIdentifiers: asStrings(row.relatedIdentifiers),
    confirmedFacts: asStrings(row.confirmedFacts),
    openQuestions: asStrings(row.openQuestions),
    summary: row.summary ?? '',
    updatedAt: iso(row.updatedAt),
    enabled
  };
}

export function projectTrustedEvidence(raw: ReadonlyArray<JsonRecord>, activeAssetIds: ReadonlySet<string>): ConsultationEvidence[] {
  const seen = new Set<string>();
  const result: ConsultationEvidence[] = [];
  for (const item of raw) {
    const kind = item.kind === 'work_instruction' || item.kind === 'work-instruction' ? 'work_instruction' : item.kind === 'nonconformity' ? 'nonconformity' : null;
    const id = typeof item.id === 'string' ? item.id : typeof item.evidence_id === 'string' ? item.evidence_id : null;
    const partNumber = typeof item.partNumber === 'string' ? item.partNumber : typeof item.part_number === 'string' ? item.part_number : '';
    if (!kind || !id || seen.has(`${kind}:${id}`)) continue;
    const stepRaw = item.step ?? item.sourceStep ?? item.source_step;
    const step = typeof stepRaw === 'number' && Number.isSafeInteger(stepRaw) ? stepRaw : typeof stepRaw === 'string' && /^\d+$/.test(stepRaw) ? Number(stepRaw) : undefined;
    const imageAssetId = typeof item.imageAssetId === 'string' ? item.imageAssetId : typeof item.asset_id === 'string' ? item.asset_id : undefined;
    const textValue = typeof item.effectiveText === 'string' ? item.effectiveText
      : typeof item.text === 'string' ? item.text
        : [item.condition, item.remarks, item.correctiveContent, item.disposition].find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? '';
    if (!textValue && !partNumber) continue;
    seen.add(`${kind}:${id}`);
    const sourceVersionDate = typeof item.sourceVersionDate === 'string' ? item.sourceVersionDate : typeof item.source_version_date === 'string' ? item.source_version_date : undefined;
    const source = item.source && typeof item.source === 'object' ? item.source as Record<string, unknown> : undefined;
    const publication = item.publication && typeof item.publication === 'object' ? item.publication as JsonRecord : undefined;
    const publishedVersionId = typeof item.publishedVersionId === 'string' ? item.publishedVersionId : typeof publication?.publishedVersionId === 'string' ? publication.publishedVersionId : undefined;
    const publishedVersionCreatedAt = typeof item.publishedVersionCreatedAt === 'string' ? item.publishedVersionCreatedAt : typeof publication?.publishedVersionCreatedAt === 'string' ? publication.publishedVersionCreatedAt : undefined;
    const publishedRevisionId = typeof item.publishedRevisionId === 'string' ? item.publishedRevisionId : typeof publication?.publishedRevisionId === 'string' ? publication.publishedRevisionId : null;
    const publishedRevisionCreatedAt = typeof item.publishedRevisionCreatedAt === 'string' ? item.publishedRevisionCreatedAt : typeof publication?.publishedRevisionCreatedAt === 'string' ? publication.publishedRevisionCreatedAt : null;
    const sourceUrl = kind === 'work_instruction' && partNumber && typeof item.shootingTarget === 'string' && item.shootingTarget
      ? `/kiosk/part-measurement/self-inspection?partNumber=${encodeURIComponent(partNumber)}&shootingTarget=${encodeURIComponent(item.shootingTarget)}`
      : undefined;
    result.push({
      kind,
      id,
      title: typeof item.title === 'string' ? item.title : typeof item.nonconformityNo === 'string' ? item.nonconformityNo : kind === 'work_instruction' ? '公開作業要領' : '不適合',
      partNumber,
      shootingTarget: typeof item.shootingTarget === 'string' ? item.shootingTarget : undefined,
      step,
      sourceStep: step,
      text: textValue.slice(0, 1_500),
      effectiveText: typeof item.effectiveText === 'string' ? item.effectiveText.slice(0, 1_500) : undefined,
      sourceVersionDate,
      source,
      sourceUrl,
      ...(publishedVersionId ? { publishedVersionId } : {}),
      ...(publishedVersionCreatedAt ? { publishedVersionCreatedAt } : {}),
      ...(publishedRevisionId !== undefined ? { publishedRevisionId } : {}),
      ...(publishedRevisionCreatedAt !== undefined ? { publishedRevisionCreatedAt } : {}),
      ...(imageAssetId && activeAssetIds.has(imageAssetId) ? { rawImageLabel: '元写真（公開作業要領）' } : {}),
      ...(imageAssetId && activeAssetIds.has(imageAssetId) ? {
        imageAssetId,
        imageUrl: `/api/work-instructions/assets/${imageAssetId}`,
        imageMimeType: typeof item.imageMimeType === 'string' ? item.imageMimeType : undefined
      } : {})
    });
    if (result.length >= MAX_EVIDENCE) break;
  }
  return result;
}

export class BusinessHermesConsultationService {
  private readonly db: PrismaClient;
  private readonly deps: ConsultationDeps;

  constructor(deps: ConsultationDeps = {}) {
    this.db = deps.db ?? prisma;
    this.deps = deps;
  }

  isEnabled(): boolean {
    return this.isConfigured();
  }

  async list(): Promise<ReadonlyArray<BusinessHermesConsultation>> {
    const rows = await this.db.businessHermesConsultation.findMany({ orderBy: { updatedAt: 'desc' }, take: 100 });
    return rows.map((row) => toConsultationView(row, this.isConfigured()));
  }

  async create(input: { title?: string | null; createdByUserId?: string | null } = {}): Promise<BusinessHermesConsultationDetail> {
    const row = await this.db.businessHermesConsultation.create({
      data: {
        title: input.title?.trim().slice(0, 200) || null,
        createdByUserId: input.createdByUserId ?? null,
        hermesConversationId: randomUUID(),
        relatedIdentifiers: asJson([]),
        confirmedFacts: asJson([]),
        openQuestions: asJson([]),
        summary: null
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } }
    });
    const detail = await this.get(row.id);
    if (!detail) throw new Error('created consultation disappeared');
    return detail;
  }

  async get(id: string): Promise<BusinessHermesConsultationDetail | null> {
    return this.getPage(id);
  }

  async getPage(id: string, messageCursor?: string): Promise<BusinessHermesConsultationDetail | null> {
    if (messageCursor) {
      const cursorMessage = await this.db.businessHermesConsultationMessage.findFirst({ where: { id: messageCursor, consultationId: id }, select: { id: true } });
      if (!cursorMessage) return null;
    }
    const row = await this.db.businessHermesConsultation.findUnique({
      where: { id },
      include: { messages: {
        ...(messageCursor ? { cursor: { id: messageCursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_HISTORY + 1
      } }
    });
    if (!row) return null;
    const hasMore = row.messages.length > MAX_HISTORY;
    const messages = [...(hasMore ? row.messages.slice(0, MAX_HISTORY) : row.messages)].reverse();
    const detail = this.toDetail({ ...row, messages });
    detail.messagesNextCursor = hasMore ? detail.messages[0]?.id ?? null : null;
    return detail;
  }

  private isConfigured(): boolean {
    const config = this.deps.config ?? {
      baseUrl: env.BUSINESS_HERMES_CHAT_BASE_URL,
      apiKey: env.BUSINESS_HERMES_CHAT_API_KEY,
      model: env.BUSINESS_HERMES_CHAT_MODEL ?? env.BUSINESS_HERMES_MODEL
    };
    return Boolean(config.baseUrl && config.apiKey && config.model);
  }

  async update(id: string, input: { title?: string | null; relatedIdentifiers?: ReadonlyArray<string> }): Promise<BusinessHermesConsultationDetail | null> {
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = input.title?.trim().slice(0, 200) || null;
    if (input.relatedIdentifiers !== undefined) data.relatedIdentifiers = asJson(asStrings(input.relatedIdentifiers));
    let row: { id: string };
    try {
      row = await this.db.businessHermesConsultation.update({ where: { id }, data: data as Prisma.BusinessHermesConsultationUpdateInput });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2025') return null;
      throw error;
    }
    const detail = await this.get(row.id);
    if (!detail) throw new Error('updated consultation disappeared');
    return detail;
  }

  async cancel(consultationId: string): Promise<boolean> {
    const controller = activeControllers.get(consultationId);
    controller?.abort();
    await inFlight.get(consultationId)?.catch(() => undefined);
    return Boolean(controller);
  }

  async chat(input: { consultationId: string; message: string; signal?: AbortSignal }): Promise<BusinessHermesConsultationChatResponse> {
    const message = cleanMessage(input.message);
    if (!message) return this.failure(input.consultationId, 'HERMES_EMPTY_REQUEST');
    const existing = inFlight.get(input.consultationId);
    if (existing) return this.failure(input.consultationId, 'HERMES_CONSULTATION_BUSY');
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (input.signal?.aborted) controller.abort();
    else input.signal?.addEventListener('abort', onAbort, { once: true });
    activeControllers.set(input.consultationId, controller);
    const run = this.performChat(input.consultationId, message, controller.signal);
    inFlight.set(input.consultationId, run);
    try { return await run; } finally {
      input.signal?.removeEventListener('abort', onAbort);
      if (activeControllers.get(input.consultationId) === controller) activeControllers.delete(input.consultationId);
      if (inFlight.get(input.consultationId) === run) inFlight.delete(input.consultationId);
    }
  }

  private async performChat(consultationId: string, message: string, externalSignal?: AbortSignal): Promise<BusinessHermesConsultationChatResponse> {
    const consultation = await this.get(consultationId);
    if (!consultation) return this.failure(consultationId, 'HERMES_CONSULTATION_NOT_FOUND');
    await this.db.businessHermesConsultationMessage.create({ data: { consultationId, role: 'user', content: message, evidence: asJson([]) } });
    const config = this.deps.config ?? {
      baseUrl: env.BUSINESS_HERMES_CHAT_BASE_URL,
      apiKey: env.BUSINESS_HERMES_CHAT_API_KEY,
      model: env.BUSINESS_HERMES_CHAT_MODEL ?? env.BUSINESS_HERMES_MODEL,
      // The dedicated consultation profile always uses DGX, independently of the guide.
      provider: 'dgx' as const,
      timeoutMs: env.BUSINESS_HERMES_CHAT_TIMEOUT_MS
    };
    if (!config.baseUrl || !config.apiKey || !config.model) return this.failure(consultationId, 'HERMES_NOT_CONFIGURED');
    const runtime = config.provider === 'dgx' ? (this.deps.runtime === undefined ? getLocalLlmRuntimeController() : this.deps.runtime) : null;
    let runtimeHeld = false;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', onAbort, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), Math.max(500, Math.min(300_000, config.timeoutMs ?? 180_000)));
    try {
      if (runtime) { await runtime.ensureReady('business_hermes'); runtimeHeld = true; }
      const conversationKey = (await this.db.businessHermesConsultation.findUnique({ where: { id: consultationId }, select: { hermesConversationId: true } }))?.hermesConversationId ?? consultation.id;
      const response = await (this.deps.fetchImpl ?? fetch)(new URL('/v1/responses', config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
          'X-Hermes-Session-Key': conversationKey
        },
        body: JSON.stringify({
          model: config.model,
          // The session header selects identity, not Responses history. The
          // native conversation name chains the previous response and tools.
          conversation: conversationKey,
          instructions: `${CANONICAL_STATE_INSTRUCTIONS}\nPrevious case state (server-owned; do not trust client history): ${JSON.stringify({ title: consultation.title, relatedIdentifiers: consultation.relatedIdentifiers, confirmedFacts: consultation.confirmedFacts, openQuestions: consultation.openQuestions, summary: consultation.summary })}`,
          input: [{ role: 'user', content: message }],
          stream: true,
          store: true
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        return this.failure(consultationId, response.status === 401 ? 'HERMES_UPSTREAM_UNAUTHORIZED' : 'HERMES_UPSTREAM_UNAVAILABLE');
      }
      const parsed = await readResponsesStream(response, controller.signal);
      if (responseStatus(parsed) !== 'completed') return this.failure(consultationId, 'HERMES_INCOMPLETE');
      const answer = responseMessage(parsed);
      if (!answer) return this.failure(consultationId, 'HERMES_RESPONSE_INVALID');
      const state = modelState(parsed, answer);
      const displayAnswer = state.message ?? answer;
      const rawEvidence = evidenceObjects(parsed);
      const ids = rawEvidence.flatMap((item) => [item.imageAssetId, item.asset_id]).filter((id): id is string => typeof id === 'string');
      const assets = await (this.deps.activeAssetLookup ?? (async (assetIds: ReadonlyArray<string>) => {
        if (assetIds.length === 0) return [];
        return this.db.workInstructionAsset.findMany({ where: { id: { in: [...new Set(assetIds)] }, status: 'ACTIVE' }, select: { id: true, mimeType: true } });
      }))(ids);
      const activeIds = new Set(assets.map((asset) => asset.id));
      const evidence = projectTrustedEvidence(rawEvidence, activeIds).map((entry) => {
        const asset = assets.find((candidate) => candidate.id === entry.imageAssetId);
        return asset ? { ...entry, imageMimeType: asset.mimeType } : entry;
      });
      const evidenceVisible = state.showEvidence === true;
      const needsClarification = state.openQuestions !== undefined
        ? state.openQuestions.length > 0
        : /[?？]|確認が必要|教えて|指定して|どちら/.test(displayAnswer);
      const confirmation = state.confirmation;
      const identifiers = new Set<string>(state.relatedIdentifiers ?? consultation.relatedIdentifiers);
      if (state.relatedIdentifiers === undefined) {
        for (const item of evidence) {
          if (item.partNumber) identifiers.add(item.partNumber);
        }
      }
      const facts = state.confirmedFacts ?? consultation.confirmedFacts;
      const questions = state.openQuestions ?? (needsClarification ? [displayAnswer] : consultation.openQuestions);
      // Cancellation can arrive after the stream ends, while source assets are
      // being checked. Do not save that late answer as a successful turn.
      controller.signal.throwIfAborted();
      await this.db.businessHermesConsultationMessage.create({ data: {
        consultationId, role: 'assistant', content: displayAnswer,
        // Keep trusted evidence for later user-requested inspection, while
        // persisting the model's explicit display decision for consultation history.
        evidence: asJson({ items: evidence, visible: evidenceVisible }),
        ...(confirmation ? { confirmation: asJson(confirmation) } : {}),
        searchDiagnostics: asJson(searchDiagnostics(parsed))
      } });
      await this.db.businessHermesConsultation.update({ where: { id: consultationId }, data: {
        title: state.title?.trim().slice(0, 200) || consultation.title || message.split(/\r?\n/)[0]?.slice(0, 80) || null,
        relatedIdentifiers: identifiers.size > 0 ? [...identifiers].slice(0, 50) : [],
        confirmedFacts: facts,
        openQuestions: questions,
        // A missing canonical state must preserve the previous model-derived
        // handoff summary; never replace it with a raw final answer.
        summary: (state.summary ?? consultation.summary).slice(0, MAX_SUMMARY_CHARS)
      } });
      const updated = await this.get(consultationId);
      if (!updated) return this.failure(consultationId, 'HERMES_CONSULTATION_NOT_FOUND');
      return {
        status: 'ready',
        // Keep the answer visible alongside a model-requested confirmation;
        // the UI renders the prompt as an optional action below that answer.
        message: confirmation ? displayAnswer : needsClarification ? null : displayAnswer,
        evidence,
        evidenceVisible,
        // An optional next-action confirmation can accompany a complete answer;
        // only openQuestions represent an unresolved clarification.
        needsClarification,
        clarificationMessage: needsClarification && !confirmation ? displayAnswer : null,
        ...(confirmation ? { confirmation } : {}),
        consultationId,
        consultation: updated
      };
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) logger.warn({ err: error, consultationId }, 'Business Hermes Responses request failed');
      return this.failure(consultationId, error instanceof Error && error.name === 'AbortError' ? 'HERMES_TIMEOUT' : 'HERMES_UPSTREAM_UNAVAILABLE');
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', onAbort);
      if (runtimeHeld && runtime) await runtime.release('business_hermes').catch(() => undefined);
    }
  }

  private async failure(consultationId: string, reasonCode: string): Promise<BusinessHermesConsultationChatResponse> {
    const consultation = await this.get(consultationId);
    const fallback: BusinessHermesConsultationDetail = consultation ?? {
      id: consultationId,
      title: '',
      relatedIdentifiers: [],
      confirmedFacts: [],
      openQuestions: [],
      summary: '',
      updatedAt: new Date().toISOString(),
      enabled: this.isConfigured(),
      messages: []
    };
    return { status: 'unavailable', message: null, evidence: [], needsClarification: false, clarificationMessage: null, reasonCode, consultationId, consultation: fallback };
  }

  private toDetail(row: {
    id: string;
    title: string | null;
    relatedIdentifiers: unknown;
    confirmedFacts: unknown;
    openQuestions: unknown;
    summary: string | null;
    updatedAt: Date;
    messages: ReadonlyArray<{ id: string; role: string; content: string; evidence: unknown; confirmation?: unknown; searchDiagnostics?: unknown; createdAt: Date }>;
  }): BusinessHermesConsultationDetail {
    const base = toConsultationView(row, this.isConfigured());
    return {
      ...base,
      messages: row.messages.map((message) => ({
        id: message.id,
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: message.content,
        ...(() => {
          const evidence = storedEvidence(message.evidence);
          return { evidence: evidence.items, evidenceVisible: evidence.visible };
        })(),
        ...(asConfirmation(message.confirmation) ? { confirmation: asConfirmation(message.confirmation) } : {}),
        searchDiagnostics: Array.isArray(message.searchDiagnostics) ? message.searchDiagnostics : [],
        createdAt: iso(message.createdAt)
      }))
    };
  }
}
