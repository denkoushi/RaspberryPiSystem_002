import { Prisma } from '@prisma/client';

import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { AssemblyProcedureImageStorage } from '../../lib/assembly-procedure-image-storage.js';
import { AssemblyWorkSessionService } from './assembly-work-session.service.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';
import type { LocalLlmRuntimeControllerPort } from '../inference/runtime/local-llm-runtime-control.port.js';
import { getImageOcrLayoutPort } from '../ocr/image-ocr-runtime.js';
import type { ImageOcrLayoutResult } from '../ocr/ports/image-ocr-layout.port.js';

export const BUSINESS_HERMES_EVENT_CODES = ['USER_REQUEST', 'TORQUE_NG', 'PROCEDURE_LOAD_ERROR', 'CHECK_REQUIRED'] as const;
export type BusinessHermesEventCode = (typeof BUSINESS_HERMES_EVENT_CODES)[number];
export type BusinessHermesTargetKey = 'current-bolt';

type GuideStatus = 'ready' | 'unavailable' | 'unknown';

type ProcedureEvidence = {
  sourceKind: 'kiosk_document' | 'assembly_procedure_step' | 'assembly_procedure_page_ocr';
  documentId: string;
  documentTitle: string;
  pageIndex: number;
  bodyAvailable: boolean;
  documentUpdatedAt: string;
  bodyScope: 'document' | 'page';
};

type GuideResult = {
  status: GuideStatus;
  uiRevision: string;
  message: string | null;
  targetKey: BusinessHermesTargetKey | null;
  evidence: ProcedureEvidence[];
  reasonCode?: string;
};

type BusinessHermesConfig = {
  provider: 'dgx' | 'openai';
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  chatTimeoutMs?: number;
};

type FetchLike = typeof fetch;
type AssemblySession = NonNullable<Awaited<ReturnType<AssemblyWorkSessionService['getDetail']>>>;

type GuideInput = {
  sessionId: string;
  clientDeviceId: string;
  uiRevision: string;
  eventCode: BusinessHermesEventCode;
  eventId?: string;
};

type AssistantOutput = {
  known: boolean;
  message: string;
  targetKey: BusinessHermesTargetKey | null;
};

export type BusinessHermesChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type BusinessHermesChatResult = {
  status: 'ready' | 'unavailable';
  message: string | null;
  reasonCode?: string;
};

export type BusinessHermesChatIntent = {
  scope: 'nonconformity' | 'work_instruction' | 'both' | 'unknown';
  partNumber: string | null;
  shootingTarget: string | null;
  clarificationQuestion: string | null;
};

export type BusinessHermesChatIntentResult = {
  status: 'ready' | 'unavailable';
  intent: BusinessHermesChatIntent | null;
  reasonCode?: string;
};

type ProcedurePageOcrInput = {
  documentId: string;
  pageIndex: number;
  documentUpdatedAt: string;
  imageRelativePath: string;
};

type ProcedurePageOcr = (input: ProcedurePageOcrInput) => Promise<string>;

const MAX_PROCEDURE_BODY_CHARS = 12_000;
const MAX_ASSISTANT_MESSAGE_CHARS = 360;
const MAX_CHAT_USER_MESSAGE_CHARS = 2_000;
const MAX_CHAT_RESPONSE_CHARS = 2_000;
const MAX_CHAT_SYSTEM_MESSAGE_CHARS = 32_000;
const MAX_PROACTIVE_IN_FLIGHT = 2;
const PROCEDURE_PAGE_OCR_TIMEOUT_MS = 12_000;
const PROCEDURE_PAGE_OCR_CACHE_LIMIT = 8;
const MIN_PROCEDURE_PAGE_OCR_AVERAGE_CONFIDENCE = 80;
let proactiveInFlight = 0;

type ProcedurePageOcrInFlight = {
  key: string;
  promise: Promise<string>;
};

const procedurePageOcrCache = new Map<string, string>();
let procedurePageOcrInFlight: ProcedurePageOcrInFlight | null = null;

const safeConfig = (): BusinessHermesConfig => ({
  provider: env.BUSINESS_HERMES_PROVIDER,
  baseUrl: env.BUSINESS_HERMES_BASE_URL,
  apiKey: env.BUSINESS_HERMES_API_KEY,
  model: env.BUSINESS_HERMES_MODEL,
  timeoutMs: env.BUSINESS_HERMES_TIMEOUT_MS,
  chatTimeoutMs: env.BUSINESS_HERMES_CHAT_TIMEOUT_MS
});

function isConfigured(config: BusinessHermesConfig): config is Required<BusinessHermesConfig> {
  return Boolean(config.baseUrl && config.apiKey && config.model);
}

function normalizeBody(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROCEDURE_BODY_CHARS);
}

function procedurePageOcrCacheKey(input: ProcedurePageOcrInput): string {
  return [input.documentId, input.pageIndex, input.documentUpdatedAt, input.imageRelativePath].join('|');
}

function acceptedProcedurePageOcrText(result: ImageOcrLayoutResult): string {
  const text = normalizeBody(result.text);
  if (!text || !Array.isArray(result.words) || result.words.length === 0) return '';
  const words = result.words.filter((word) => normalizeBody(word.text) && word.confidence !== null && Number.isFinite(word.confidence));
  if (words.length === 0) return '';
  const averageConfidence = words.reduce((sum, word) => sum + (word.confidence ?? 0), 0) / words.length;
  return averageConfidence >= MIN_PROCEDURE_PAGE_OCR_AVERAGE_CONFIDENCE ? text : '';
}

function waitForProcedurePageOcr(promise: Promise<string>, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(''), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        clearTimeout(timeout);
        resolve('');
      }
    );
  });
}

async function defaultProcedurePageOcr(input: ProcedurePageOcrInput): Promise<string> {
  const image = await AssemblyProcedureImageStorage.readImage(input.imageRelativePath);
  if (image.contentType !== 'image/jpeg' && image.contentType !== 'image/png' && image.contentType !== 'image/webp') {
    return '';
  }
  const result = await getImageOcrLayoutPort().runLayoutOcrOnImage({
    imageBytes: image.buffer,
    mimeType: image.contentType
  });
  return acceptedProcedurePageOcrText(result);
}

async function readProcedurePageOcr(input: ProcedurePageOcrInput): Promise<string> {
  const key = procedurePageOcrCacheKey(input);
  const cached = procedurePageOcrCache.get(key);
  if (cached) return cached;

  if (procedurePageOcrInFlight && procedurePageOcrInFlight.key !== key) {
    return '';
  }

  const inFlight = procedurePageOcrInFlight?.promise ?? (() => {
    const promise = defaultProcedurePageOcr(input)
      .catch(() => '')
      .then((text) => {
        if (text) {
          procedurePageOcrCache.delete(key);
          procedurePageOcrCache.set(key, text);
          while (procedurePageOcrCache.size > PROCEDURE_PAGE_OCR_CACHE_LIMIT) {
            const oldest = procedurePageOcrCache.keys().next().value;
            if (oldest === undefined) break;
            procedurePageOcrCache.delete(oldest);
          }
        }
        return text;
      })
      .finally(() => {
        if (procedurePageOcrInFlight?.promise === promise) procedurePageOcrInFlight = null;
      });
    procedurePageOcrInFlight = { key, promise };
    return promise;
  })();

  return waitForProcedurePageOcr(inFlight, PROCEDURE_PAGE_OCR_TIMEOUT_MS);
}

/** テスト用。常駐worker自体は終了させず、本文結果だけを破棄する。 */
export function resetBusinessHermesProcedurePageOcrCacheForTests(): void {
  procedurePageOcrCache.clear();
}

function stateToken(session: {
  updatedAt: Date;
  currentBoltId: string | null;
  currentAreaId: string | null;
  operatorEmployeeId: string | null;
  clientDeviceId: string | null;
}): string {
  return [
    session.updatedAt.toISOString(),
    session.currentBoltId ?? '',
    session.currentAreaId ?? '',
    session.operatorEmployeeId ?? '',
    session.clientDeviceId ?? ''
  ].join('|');
}

function safeAssistantMessage(value: string): string | null {
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, MAX_ASSISTANT_MESSAGE_CHARS);
  if (!normalized) return null;
  if (/bearer\s|x-llm-token|api[-_ ]?key|secret|password|token\s*[:=]/i.test(normalized)) {
    return null;
  }
  if (/[A-Za-z0-9+/]{32,}={0,2}/.test(normalized)) return null;
  return normalized;
}

function parseAssistantOutput(raw: unknown): AssistantOutput | null {
  if (typeof raw !== 'string') return null;
  const candidate = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    if (typeof parsed.known !== 'boolean' || typeof parsed.message !== 'string') return null;
    const targetKey = parsed.targetKey === null || parsed.targetKey === undefined
      ? null
      : parsed.targetKey;
    if (targetKey !== null && targetKey !== 'current-bolt') {
      return null;
    }
    const message = safeAssistantMessage(parsed.message);
    if (!message) return null;
    return { known: parsed.known, message, targetKey: targetKey as BusinessHermesTargetKey | null };
  } catch {
    return null;
  }
}

function readAssistantContent(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const first = choices[0];
  if (!first || typeof first !== 'object') return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return null;
  return (message as { content?: unknown }).content;
}

function safeChatMessage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_RESPONSE_CHARS);
  if (!normalized) return null;
  if (/bearer\s|x-llm-token|api[-_ ]?key|secret|password|token\s*[:=]/i.test(normalized)) {
    return null;
  }
  if (/[A-Za-z0-9+/]{32,}={0,2}/.test(normalized)) return null;
  return normalized;
}

function safeIntentText(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim().slice(0, maxChars);
  if (!normalized || /bearer\s|x-llm-token|api[-_ ]?key|secret|password|token\s*[:=]/i.test(normalized)) return null;
  return normalized;
}

function parseChatIntent(raw: unknown): BusinessHermesChatIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Record<string, unknown>;
  const scope = parsed.scope;
  if (scope !== 'nonconformity' && scope !== 'work_instruction' && scope !== 'both' && scope !== 'unknown') return null;
  const partNumber = parsed.partNumber === null || parsed.partNumber === undefined ? null : safeIntentText(parsed.partNumber, 200);
  const shootingTarget = parsed.shootingTarget === null || parsed.shootingTarget === undefined ? null : safeIntentText(parsed.shootingTarget, 200);
  const clarificationQuestion = parsed.clarificationQuestion === null || parsed.clarificationQuestion === undefined
    ? null
    : safeIntentText(parsed.clarificationQuestion, 240);
  if (parsed.partNumber !== null && parsed.partNumber !== undefined && partNumber === null) return null;
  if (parsed.shootingTarget !== null && parsed.shootingTarget !== undefined && shootingTarget === null) return null;
  if (parsed.clarificationQuestion !== null && parsed.clarificationQuestion !== undefined && clarificationQuestion === null) return null;
  return { scope, partNumber, shootingTarget, clarificationQuestion };
}

function buildPrompt(input: {
  eventCode: BusinessHermesEventCode;
  session: {
    productNo: string;
    targetUnit: string;
    currentAreaId: string | null;
    currentBoltId: string | null;
  };
  bolt: {
    markerNo: number;
    boltSpec: string;
    nominalTorque: Prisma.Decimal;
    lowerLimit: Prisma.Decimal;
    upperLimit: Prisma.Decimal;
    unit: string;
  };
  evidence: ProcedureEvidence;
  procedureBody: string;
}): string {
  return JSON.stringify({
    eventCode: input.eventCode,
    currentStatus: {
      productNo: input.session.productNo,
      targetUnit: input.session.targetUnit,
      currentAreaId: input.session.currentAreaId,
      currentBoltId: input.session.currentBoltId,
      markerNo: input.bolt.markerNo,
      boltSpec: input.bolt.boltSpec,
      nominalTorque: input.bolt.nominalTorque.toString(),
      lowerLimit: input.bolt.lowerLimit.toString(),
      upperLimit: input.bolt.upperLimit.toString(),
      unit: input.bolt.unit
    },
    procedureReference: {
      sourceKind: input.evidence.sourceKind,
      documentTitle: input.evidence.documentTitle,
      pageIndex: input.evidence.pageIndex,
      body: input.procedureBody
    }
  });
}

export class BusinessHermesService {
  constructor(
    private readonly deps: {
      fetchImpl?: FetchLike;
      config?: BusinessHermesConfig;
      sessionService?: AssemblyWorkSessionService;
      localLlmRuntime?: LocalLlmRuntimeControllerPort | null;
      procedurePageOcr?: ProcedurePageOcr;
    } = {}
  ) {}

  private get config(): BusinessHermesConfig {
    return this.deps.config ?? safeConfig();
  }

  private get chatConfig(): BusinessHermesConfig {
    const config = this.config;
    return { ...config, timeoutMs: config.chatTimeoutMs ?? config.timeoutMs };
  }

  private get sessionService(): AssemblyWorkSessionService {
    return this.deps.sessionService ?? new AssemblyWorkSessionService();
  }

  private get localLlmRuntime(): LocalLlmRuntimeControllerPort | null {
    return this.deps.localLlmRuntime === undefined ? getLocalLlmRuntimeController() : this.deps.localLlmRuntime;
  }

  private get procedurePageOcr(): ProcedurePageOcr {
    return this.deps.procedurePageOcr ?? readProcedurePageOcr;
  }

  private async persistProactiveSuggestion(data: {
    sessionId: string;
    clientDeviceId: string;
    eventCode: string;
    eventId?: string;
    status: string;
    reasonCode?: string;
    message?: string | null;
    targetKey?: string | null;
    evidence: Prisma.InputJsonValue;
  }): Promise<void> {
    try {
      await prisma.businessHermesProactiveSuggestion.create({ data });
    } catch (error) {
      if (data.eventId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return;
      throw error;
    }
  }

  private unavailable(input: Pick<GuideInput, 'uiRevision'>, evidence: ProcedureEvidence[] = [], reasonCode = 'HERMES_UNAVAILABLE'): GuideResult {
    return { status: 'unavailable', uiRevision: input.uiRevision, message: null, targetKey: null, evidence, reasonCode };
  }

  private async resolveContext(input: GuideInput): Promise<{
    session: AssemblySession;
    bolt: NonNullable<NonNullable<Awaited<ReturnType<AssemblyWorkSessionService['getDetail']>>>['template']['areas'][number]['bolts'][number]>;
    evidence: ProcedureEvidence;
    procedureBody: string;
  } | GuideResult> {
    const session = await this.sessionService.getDetail(input.sessionId);
    if (!session) return this.unavailable(input, [], 'SESSION_NOT_FOUND');
    if (session.status !== 'IN_PROGRESS') return this.unavailable(input, [], 'SESSION_NOT_ACTIVE');
    if (!session.clientDeviceId || session.clientDeviceId !== input.clientDeviceId) {
      throw new ApiError(403, '作業端末が一致しません', undefined, 'ASSEMBLY_HERMES_DEVICE_MISMATCH');
    }
    if (!session.operatorEmployeeId) {
      throw new ApiError(403, '作業者確認が必要です', undefined, 'ASSEMBLY_HERMES_OPERATOR_REQUIRED');
    }
    const lastAccess = session.operatorAccesses.at(-1);
    if (
      !lastAccess ||
      lastAccess.employeeId !== session.operatorEmployeeId ||
      lastAccess.clientDeviceId !== input.clientDeviceId ||
      (lastAccess.accessType !== 'START' && lastAccess.accessType !== 'RESUME')
    ) {
      throw new ApiError(403, '現在端末の作業者確認が必要です', undefined, 'ASSEMBLY_HERMES_OPERATOR_ACCESS_REQUIRED');
    }
    const bolt = session.template.areas.flatMap((area) => area.bolts).find((candidate) => candidate.id === session.currentBoltId);
    if (!bolt) return this.unavailable(input, [], 'CURRENT_TARGET_UNKNOWN');

    const pageIndex = bolt.pageIndex ?? 0;
    const matchingStep = session.template.procedureSteps.find((step) =>
      step.pageIndex === pageIndex &&
      (bolt.kioskDocumentId
        ? step.kioskDocumentId === bolt.kioskDocumentId
        : bolt.assemblyProcedureDocumentId
          ? step.assemblyProcedureDocumentId === bolt.assemblyProcedureDocumentId
          : false)
    );

    if (bolt.kioskDocumentId) {
      const document = await prisma.kioskDocument.findUnique({
        where: { id: bolt.kioskDocumentId },
        select: { id: true, title: true, displayTitle: true, extractedText: true, confirmedSummaryText: true, enabled: true, updatedAt: true }
      });
      if (!document || !document.enabled) return this.unavailable(input, [], 'PROCEDURE_DOCUMENT_UNAVAILABLE');
      const evidence: ProcedureEvidence = {
        sourceKind: 'kiosk_document',
        documentId: document.id,
        documentTitle: document.displayTitle?.trim() || document.title,
        pageIndex,
        bodyAvailable: Boolean(normalizeBody(document.extractedText) || normalizeBody(document.confirmedSummaryText)),
        documentUpdatedAt: document.updatedAt.toISOString(),
        bodyScope: 'document'
      };
      return {
        session,
        bolt,
        evidence,
        procedureBody: normalizeBody(document.extractedText) || normalizeBody(document.confirmedSummaryText)
      };
    }

    const document = session.template.procedureDocument;
    if (bolt.assemblyProcedureDocumentId !== document.id) return this.unavailable(input, [], 'PROCEDURE_DOCUMENT_UNAVAILABLE');
    if (!document.isActive || document.status !== 'PUBLISHED') return this.unavailable(input, [], 'PROCEDURE_DOCUMENT_UNAVAILABLE');
    const instructionBody = normalizeBody(matchingStep?.instructionText);
    const page = document.pages.find((candidate) => candidate.pageIndex === pageIndex);
    const procedureBody = instructionBody || (page
      ? await this.procedurePageOcr({
          documentId: document.id,
          pageIndex,
          documentUpdatedAt: document.updatedAt.toISOString(),
          imageRelativePath: page.imageRelativePath
        })
      : '');
    const evidence: ProcedureEvidence = {
      sourceKind: instructionBody || !page ? 'assembly_procedure_step' : 'assembly_procedure_page_ocr',
      documentId: bolt.assemblyProcedureDocumentId ?? document.id,
      documentTitle: matchingStep?.title?.trim() || document.name,
      pageIndex,
      bodyAvailable: Boolean(procedureBody),
      documentUpdatedAt: document.updatedAt.toISOString(),
      bodyScope: 'page'
    };
    return { session, bolt, evidence, procedureBody };
  }

  async guide(input: GuideInput): Promise<GuideResult> {
    const context = await this.resolveContext(input);
    if ('status' in context) return context;
    const evidence = [context.evidence];
    if (!context.procedureBody) return this.unavailable(input, evidence, 'PROCEDURE_BODY_UNAVAILABLE');
    const config = this.config;
    if (!isConfigured(config)) return this.unavailable(input, evidence, 'HERMES_NOT_CONFIGURED');

    const tokenBeforeCall = stateToken(context.session);
    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const runtime = config.provider === 'dgx' ? this.localLlmRuntime : null;
    let runtimeHeld = false;
    let requestController: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (runtime) {
        await runtime.ensureReady('business_hermes');
        runtimeHeld = true;
      }
      // DGX cold-start/readiness is bounded by the shared runtime controller. Start the
      // Hermes response timeout only after readiness so a cold start does not consume it.
      requestController = new AbortController();
      timeout = setTimeout(() => requestController?.abort(), config.timeoutMs);
      const response = await fetchImpl(new URL('/v1/chat/completions', config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.1,
          max_tokens: 512,
          response_format: { type: 'json_object' },
          ...(config.provider === 'dgx'
            ? { model_options: { reasoning: { enabled: true, effort: 'high' } } }
            : {}),
          messages: [
            {
              role: 'system',
              content: 'あなたは業務手順の案内役です。与えられた手順本文と現在状態だけを根拠に、日本語で短く説明してください。手順本文がOCR由来の場合、その読み取り値を正式値として扱わず、数値はcurrentStatusの正式値を使い、OCR本文との矛盾がある場合はknown=falseとしてください。現在の対象を確認できる場合はknown=true、messageは空でない案内、targetKeyは必ず"current-bolt"にしてください。根拠が足りない、または現在の対象を確認できない場合はknown=false、messageは空文字列、targetKeyはnullにしてください。推測や断定をしないでください。JSONのみを返してください。有効な回答例は {"known":true,"message":"現在の対象を正式値で案内します。","targetKey":"current-bolt"} です。形式は {"known":boolean,"message":string,"targetKey":"current-bolt"|null} です。'
            },
            { role: 'user', content: buildPrompt({ eventCode: input.eventCode, session: context.session, bolt: context.bolt, evidence: context.evidence, procedureBody: context.procedureBody }) }
          ]
        }),
        signal: requestController.signal
      });
      if (!response.ok) return this.unavailable(input, evidence, 'HERMES_UPSTREAM_UNAVAILABLE');
      const parsed = parseAssistantOutput(readAssistantContent(await response.json()));
      if (!parsed || !parsed.known || parsed.targetKey !== 'current-bolt') {
        return { status: 'unknown', uiRevision: input.uiRevision, message: null, targetKey: null, evidence, reasonCode: 'HERMES_RESPONSE_UNKNOWN' };
      }
      const latest = await this.sessionService.getDetail(input.sessionId);
      if (!latest || stateToken(latest) !== tokenBeforeCall) {
        return { status: 'unknown', uiRevision: input.uiRevision, message: null, targetKey: null, evidence, reasonCode: 'SESSION_CHANGED' };
      }
      return { status: 'ready', uiRevision: input.uiRevision, message: parsed.message, targetKey: parsed.targetKey, evidence };
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        logger.warn({ reasonCode: 'HERMES_UPSTREAM_UNAVAILABLE', sessionId: input.sessionId }, 'Business Hermes request unavailable');
      }
      return this.unavailable(input, evidence, error instanceof Error && error.name === 'AbortError' ? 'HERMES_TIMEOUT' : 'HERMES_UPSTREAM_UNAVAILABLE');
    } finally {
      if (runtimeHeld && runtime) {
        await runtime.release('business_hermes').catch(() => {
          logger.warn({ reasonCode: 'BUSINESS_HERMES_RUNTIME_RELEASE_FAILED' }, 'Business Hermes runtime release failed');
        });
      }
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Shared chat entry point for the operator overlay. The caller supplies a
   * server-built system message and bounded conversation; this method only
   * talks to the configured Business Hermes instance and never persists chat.
   */
  async chat(input: { messages: BusinessHermesChatMessage[] }): Promise<BusinessHermesChatResult> {
    const config = this.chatConfig;
    if (!isConfigured(config)) return { status: 'unavailable', message: null, reasonCode: 'HERMES_NOT_CONFIGURED' };

    const messages = input.messages
      .map((message) => ({
        role: message.role,
        content: message.role === 'system'
          ? message.content.trim().slice(0, MAX_CHAT_SYSTEM_MESSAGE_CHARS)
          : message.content.trim().slice(0, MAX_CHAT_USER_MESSAGE_CHARS)
      }))
      .filter((message) => message.content.length > 0);
    if (messages.length === 0) return { status: 'unavailable', message: null, reasonCode: 'HERMES_EMPTY_REQUEST' };

    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const runtime = config.provider === 'dgx' ? this.localLlmRuntime : null;
    let runtimeHeld = false;
    let requestController: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (runtime) {
        await runtime.ensureReady('business_hermes');
        runtimeHeld = true;
      }
      requestController = new AbortController();
      timeout = setTimeout(() => requestController?.abort(), config.timeoutMs);
      const response = await fetchImpl(new URL('/v1/chat/completions', config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.2,
          max_tokens: 700,
          ...(config.provider === 'dgx'
            ? { model_options: { reasoning: { enabled: true, effort: 'medium' } } }
            : {}),
          messages
        }),
        signal: requestController.signal
      });
      if (!response.ok) return { status: 'unavailable', message: null, reasonCode: 'HERMES_UPSTREAM_UNAVAILABLE' };
      const message = safeChatMessage(readAssistantContent(await response.json()));
      if (!message) return { status: 'unavailable', message: null, reasonCode: 'HERMES_RESPONSE_INVALID' };
      return { status: 'ready', message };
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        logger.warn({ reasonCode: 'HERMES_UPSTREAM_UNAVAILABLE' }, 'Business Hermes chat request unavailable');
      }
      return {
        status: 'unavailable',
        message: null,
        reasonCode: error instanceof Error && error.name === 'AbortError' ? 'HERMES_TIMEOUT' : 'HERMES_UPSTREAM_UNAVAILABLE'
      };
    } finally {
      if (runtimeHeld && runtime) {
        await runtime.release('business_hermes').catch(() => {
          logger.warn({ reasonCode: 'BUSINESS_HERMES_RUNTIME_RELEASE_FAILED' }, 'Business Hermes runtime release failed');
        });
      }
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Extracts the current operator request as strict JSON. Only caller-supplied
   * user turns should be passed here; the caller validates identifiers before
   * using them for any business-data lookup.
   */
  async classifyChat(input: { messages: BusinessHermesChatMessage[] }): Promise<BusinessHermesChatIntentResult> {
    const config = this.chatConfig;
    if (!isConfigured(config)) return { status: 'unavailable', intent: null, reasonCode: 'HERMES_NOT_CONFIGURED' };
    const messages = input.messages
      .filter((message) => message.role === 'user')
      .slice(-12)
      .map((message, index, all) => ({
        role: 'user' as const,
        content: `${index === all.length - 1 ? '[LATEST_USER_TURN]\n' : ''}${message.content.trim().slice(0, 4_000)}`
      }))
      .filter((message) => message.content.length > 0);
    if (messages.length === 0) return { status: 'unavailable', intent: null, reasonCode: 'HERMES_EMPTY_REQUEST' };

    const fetchImpl = this.deps.fetchImpl ?? fetch;
    const runtime = config.provider === 'dgx' ? this.localLlmRuntime : null;
    let runtimeHeld = false;
    let requestController: AbortController | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (runtime) {
        await runtime.ensureReady('business_hermes');
        runtimeHeld = true;
      }
      requestController = new AbortController();
      timeout = setTimeout(() => requestController?.abort(), config.timeoutMs);
      const response = await fetchImpl(new URL('/v1/chat/completions', config.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          max_tokens: 256,
          response_format: { type: 'json_object' },
          ...(config.provider === 'dgx'
            ? { model_options: { reasoning: { enabled: true, effort: 'medium' } } }
            : {}),
          messages: [
            {
              role: 'system',
              content: 'ユーザーの最新発言を優先して、業務検索意図をJSONだけで抽出してください。assistant発言は入力されません。scopeは不適合ならnonconformity、作業要領や写真ならwork_instruction、両方ならboth、判定不能ならunknown。partNumberとshootingTargetはユーザーが文字列として明示した場合だけ返し、推測・補完・過去の別品番からの引継ぎは禁止です。最新発言で新しい品番が示された場合、対象は最新発言に明示された場合だけ返してください。聞き返しへの回答で不足項目だけが示された場合は、直前までの同一会話の明示値を補完してよいですが、別品番の対象を引き継がないでください。値がない場合はnull。clarificationQuestionは不足・曖昧な場合の日本語の短い聞き返し、十分ならnull。形式は {"scope":"nonconformity|work_instruction|both|unknown","partNumber":string|null,"shootingTarget":string|null,"clarificationQuestion":string|null}。'
            },
            ...messages
          ]
        }),
        signal: requestController.signal
      });
      if (!response.ok) return { status: 'unavailable', intent: null, reasonCode: 'HERMES_UPSTREAM_UNAVAILABLE' };
      const content = readAssistantContent(await response.json());
      if (typeof content !== 'string') return { status: 'unavailable', intent: null, reasonCode: 'HERMES_RESPONSE_INVALID' };
      const candidate = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      let parsed: unknown;
      try {
        parsed = JSON.parse(candidate);
      } catch {
        return { status: 'unavailable', intent: null, reasonCode: 'HERMES_RESPONSE_INVALID' };
      }
      const intent = parseChatIntent(parsed);
      return intent
        ? { status: 'ready', intent }
        : { status: 'unavailable', intent: null, reasonCode: 'HERMES_RESPONSE_INVALID' };
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        logger.warn({ reasonCode: 'HERMES_UPSTREAM_UNAVAILABLE' }, 'Business Hermes intent request unavailable');
      }
      return {
        status: 'unavailable',
        intent: null,
        reasonCode: error instanceof Error && error.name === 'AbortError' ? 'HERMES_TIMEOUT' : 'HERMES_UPSTREAM_UNAVAILABLE'
      };
    } finally {
      if (runtimeHeld && runtime) {
        await runtime.release('business_hermes').catch(() => {
          logger.warn({ reasonCode: 'BUSINESS_HERMES_RUNTIME_RELEASE_FAILED' }, 'Business Hermes runtime release failed');
        });
      }
      if (timeout) clearTimeout(timeout);
    }
  }

  async recordProactiveSuggestion(input: { sessionId: string; clientDeviceId: string; eventCode: 'TORQUE_NG'; eventId?: string }): Promise<void> {
    if (!isConfigured(this.config)) return;
    if (input.eventId) {
      const existing = await prisma.businessHermesProactiveSuggestion.findUnique({ where: { eventId: input.eventId } });
      if (existing) return;
    }
    if (proactiveInFlight >= MAX_PROACTIVE_IN_FLIGHT) {
      await this.persistProactiveSuggestion({
        sessionId: input.sessionId,
        clientDeviceId: input.clientDeviceId,
        eventCode: input.eventCode,
        eventId: input.eventId,
        status: 'unavailable',
        reasonCode: 'PROACTIVE_CONCURRENCY_LIMIT',
        evidence: []
      });
      return;
    }
    proactiveInFlight += 1;
    try {
      const result = await this.guide({ ...input, uiRevision: `event:${input.eventCode}` });
      await this.persistProactiveSuggestion({
        sessionId: input.sessionId,
        clientDeviceId: input.clientDeviceId,
        eventCode: input.eventCode,
        eventId: input.eventId,
        status: result.status,
        reasonCode: result.reasonCode,
        message: result.message,
        targetKey: result.targetKey,
        evidence: result.evidence as unknown as Prisma.InputJsonValue
      });
    } catch (error) {
      const reasonCode = error instanceof ApiError ? error.code ?? 'PROACTIVE_REJECTED' : 'PROACTIVE_FAILED';
      await this.persistProactiveSuggestion({
        sessionId: input.sessionId,
        clientDeviceId: input.clientDeviceId,
        eventCode: input.eventCode,
        eventId: input.eventId,
        status: 'unavailable',
        reasonCode,
        evidence: []
      });
    } finally {
      proactiveInFlight -= 1;
    }
  }

  async listProactiveSuggestions(limit: number) {
    const rows = await prisma.businessHermesProactiveSuggestion.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100)
    });
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.sessionId,
      clientDeviceId: row.clientDeviceId,
      eventCode: row.eventCode,
      status: row.status,
      reasonCode: row.reasonCode,
      message: row.message,
      targetKey: row.targetKey,
      evidence: row.evidence,
      createdAt: row.createdAt.toISOString()
    }));
  }
}
