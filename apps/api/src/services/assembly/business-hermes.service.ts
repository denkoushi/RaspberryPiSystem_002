import { Prisma } from '@prisma/client';

import { env } from '../../config/env.js';
import { ApiError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../lib/logger.js';
import { AssemblyWorkSessionService } from './assembly-work-session.service.js';
import { getLocalLlmRuntimeController } from '../inference/runtime/get-local-llm-runtime-controller.js';
import type { LocalLlmRuntimeControllerPort } from '../inference/runtime/local-llm-runtime-control.port.js';

export const BUSINESS_HERMES_EVENT_CODES = ['USER_REQUEST', 'TORQUE_NG', 'PROCEDURE_LOAD_ERROR', 'CHECK_REQUIRED'] as const;
export type BusinessHermesEventCode = (typeof BUSINESS_HERMES_EVENT_CODES)[number];
export type BusinessHermesTargetKey = 'current-bolt';

type GuideStatus = 'ready' | 'unavailable' | 'unknown';

type ProcedureEvidence = {
  sourceKind: 'kiosk_document' | 'assembly_procedure_step';
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

const MAX_PROCEDURE_BODY_CHARS = 12_000;
const MAX_ASSISTANT_MESSAGE_CHARS = 360;
const MAX_PROACTIVE_IN_FLIGHT = 2;
let proactiveInFlight = 0;

const safeConfig = (): BusinessHermesConfig => ({
  provider: env.BUSINESS_HERMES_PROVIDER,
  baseUrl: env.BUSINESS_HERMES_BASE_URL,
  apiKey: env.BUSINESS_HERMES_API_KEY,
  model: env.BUSINESS_HERMES_MODEL,
  timeoutMs: env.BUSINESS_HERMES_TIMEOUT_MS
});

function isConfigured(config: BusinessHermesConfig): config is Required<BusinessHermesConfig> {
  return Boolean(config.baseUrl && config.apiKey && config.model);
}

function normalizeBody(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROCEDURE_BODY_CHARS);
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
    } = {}
  ) {}

  private get config(): BusinessHermesConfig {
    return this.deps.config ?? safeConfig();
  }

  private get sessionService(): AssemblyWorkSessionService {
    return this.deps.sessionService ?? new AssemblyWorkSessionService();
  }

  private get localLlmRuntime(): LocalLlmRuntimeControllerPort | null {
    return this.deps.localLlmRuntime === undefined ? getLocalLlmRuntimeController() : this.deps.localLlmRuntime;
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
    const procedureBody = normalizeBody(matchingStep?.instructionText);
    const evidence: ProcedureEvidence = {
      sourceKind: 'assembly_procedure_step',
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
          messages: [
            {
              role: 'system',
              content: 'あなたは業務手順の案内役です。与えられた手順本文と現在状態だけを根拠に、日本語で短く説明してください。根拠が足りなければ known=false とし、推測や断定をしないでください。JSONのみを返してください。形式は {"known":boolean,"message":string,"targetKey":"current-bolt"|null} です。'
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
