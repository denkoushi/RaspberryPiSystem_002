import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    kioskDocument: { findUnique: vi.fn() },
    businessHermesProactiveSuggestion: {
      findUnique: vi.fn(),
      create: vi.fn()
    }
  }
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: prismaMock }));

import { BusinessHermesService } from './business-hermes.service.js';
import type { AssemblyWorkSessionService } from './assembly-work-session.service.js';

function createSession() {
  const now = new Date('2026-09-05T00:00:00.000Z');
  const bolt = {
    id: 'bolt-1',
    kioskDocumentId: null,
    assemblyProcedureDocumentId: 'procedure-1',
    pageIndex: 0,
    markerNo: 1,
    boltSpec: 'M8',
    nominalTorque: new Prisma.Decimal(10),
    lowerLimit: new Prisma.Decimal(9),
    upperLimit: new Prisma.Decimal(11),
    unit: 'N-m'
  };
  return {
    id: 'session-1',
    status: 'IN_PROGRESS',
    clientDeviceId: 'device-a',
    operatorEmployeeId: 'employee-a',
    updatedAt: now,
    currentAreaId: 'area-1',
    currentBoltId: 'bolt-1',
    productNo: 'PRODUCT-1',
    targetUnit: 'MH-AX',
    operatorAccesses: [{ employeeId: 'employee-a', clientDeviceId: 'device-a', accessType: 'START' }],
    template: {
      procedureDocument: {
        id: 'procedure-1',
        name: 'MH-AX 作業手順',
        isActive: true,
        status: 'PUBLISHED',
        updatedAt: now
      },
      procedureSteps: [{
        pageIndex: 0,
        kioskDocumentId: null,
        assemblyProcedureDocumentId: 'procedure-1',
        title: '締付手順',
        instructionText: 'ボルトを対角順に10 N-mで締め付けます。'
      }],
      areas: [{ bolts: [bolt] }]
    }
  };
}

describe('BusinessHermesService', () => {
  it('sends current status and procedure body to the dedicated endpoint', async () => {
    const session = createSession();
    const getDetail = vi.fn().mockResolvedValue(session);
    let requestBody: Record<string, unknown> | null = null;
    const fetchImpl = vi.fn(async (_input: URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ known: true, message: '現在の丸数字1を10 N-mで締め付けてください。', targetKey: 'current-bolt' }) } }]
      }), { status: 200 });
    });
    const service = new BusinessHermesService({
      sessionService: { getDetail } as unknown as AssemblyWorkSessionService,
      fetchImpl,
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret-test-key', model: 'business-model', timeoutMs: 1000 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result.status).toBe('ready');
    expect(result.targetKey).toBe('current-bolt');
    expect(result.evidence[0]?.bodyScope).toBe('page');
    expect(JSON.stringify(requestBody)).toContain('ボルトを対角順に10 N-mで締め付けます。');
    expect(JSON.stringify(requestBody)).toContain('PRODUCT-1');
    expect(requestBody).toMatchObject({ model_options: { reasoning: { enabled: true, effort: 'high' } } });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://business-hermes.test/v1/chat/completions'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer secret-test-key' }) })
    );
  });

  it('returns unavailable when dedicated Hermes settings are incomplete without fallback', async () => {
    const sessionService = { getDetail: vi.fn().mockResolvedValue(createSession()) } as unknown as AssemblyWorkSessionService;
    const fetchImpl = vi.fn();
    const service = new BusinessHermesService({
      sessionService,
      fetchImpl,
      config: { provider: 'dgx', baseUrl: undefined, apiKey: undefined, model: undefined, timeoutMs: 1000 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result).toMatchObject({ status: 'unavailable', reasonCode: 'HERMES_NOT_CONFIGURED' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a different terminal and does not call Hermes', async () => {
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(createSession()) } as unknown as AssemblyWorkSessionService,
      fetchImpl: vi.fn(),
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    await expect(service.guide({ sessionId: 'session-1', clientDeviceId: 'device-b', uiRevision: 'r1', eventCode: 'USER_REQUEST' }))
      .rejects.toMatchObject({ code: 'ASSEMBLY_HERMES_DEVICE_MISMATCH', statusCode: 403 });
  });

  it('drops a response when the server session changes during the request', async () => {
    const first = createSession();
    const changed = { ...first, updatedAt: new Date('2026-09-05T00:00:01.000Z') };
    const getDetail = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(changed);
    const service = new BusinessHermesService({
      sessionService: { getDetail } as unknown as AssemblyWorkSessionService,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ known: true, message: '案内', targetKey: 'current-bolt' }) } }] }), { status: 200 })),
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'SESSION_CHANGED', message: null, targetKey: null });
  });

  it('returns unknown for malformed or unsupported upstream output', async () => {
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(createSession()) } as unknown as AssemblyWorkSessionService,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ known: false, message: '根拠不足', targetKey: null }) } }] }), { status: 200 })),
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result).toMatchObject({ status: 'unknown', reasonCode: 'HERMES_RESPONSE_UNKNOWN', message: null, targetKey: null });
  });

  it('returns timeout without blocking the caller when upstream aborts', async () => {
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(createSession()) } as unknown as AssemblyWorkSessionService,
      fetchImpl: vi.fn((_input, init) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      })),
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 5 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result).toMatchObject({ status: 'unavailable', reasonCode: 'HERMES_TIMEOUT' });
  });

  it('starts the Hermes timeout after the shared DGX readiness lease', async () => {
    const runtime = {
      ensureReady: vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }),
      release: vi.fn(async () => {}),
      getMode: vi.fn(() => 'on_demand' as const)
    };
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(createSession()) } as unknown as AssemblyWorkSessionService,
      localLlmRuntime: runtime,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ known: true, message: '案内', targetKey: 'current-bolt' }) } }] }), { status: 200 })),
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 5 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result.status).toBe('ready');
    expect(runtime.ensureReady).toHaveBeenCalledWith('business_hermes');
    expect(runtime.release).toHaveBeenCalledWith('business_hermes');
  });

  it('does not touch the DGX lease when OpenAI is selected', async () => {
    const runtime = {
      ensureReady: vi.fn(),
      release: vi.fn(),
      getMode: vi.fn(() => 'on_demand' as const)
    };
    let requestBody: Record<string, unknown> | null = null;
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(createSession()) } as unknown as AssemblyWorkSessionService,
      localLlmRuntime: runtime,
      fetchImpl: vi.fn(async (_input: URL, init?: RequestInit) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ known: true, message: '案内', targetKey: 'current-bolt' }) } }] }), { status: 200 });
      }),
      config: { provider: 'openai', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result.status).toBe('ready');
    expect(runtime.ensureReady).not.toHaveBeenCalled();
    expect(runtime.release).not.toHaveBeenCalled();
    expect(requestBody).not.toHaveProperty('model_options');
  });

  it('does not use an instruction from a different procedure document', async () => {
    const session = createSession();
    session.template.procedureSteps[0].assemblyProcedureDocumentId = 'procedure-other';
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(session) } as unknown as AssemblyWorkSessionService,
      fetchImpl: vi.fn(),
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result).toMatchObject({ status: 'unavailable', reasonCode: 'PROCEDURE_BODY_UNAVAILABLE' });
  });

  it('rejects a bolt linked to a different template procedure document', async () => {
    const session = createSession();
    session.template.procedureDocument.id = 'procedure-other';
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(session) } as unknown as AssemblyWorkSessionService,
      fetchImpl: vi.fn(),
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result).toMatchObject({ status: 'unavailable', reasonCode: 'PROCEDURE_DOCUMENT_UNAVAILABLE', evidence: [] });
  });

  it('records a real NG event suggestion for the admin review path', async () => {
    prismaMock.businessHermesProactiveSuggestion.findUnique.mockResolvedValue(null);
    prismaMock.businessHermesProactiveSuggestion.create.mockResolvedValue({ id: 'suggestion-1' });
    const sessionService = { getDetail: vi.fn().mockResolvedValue(createSession()) } as unknown as AssemblyWorkSessionService;
    const service = new BusinessHermesService({
      sessionService,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ known: true, message: 'NG箇所を再確認してください。', targetKey: 'current-bolt' }) } }] }), { status: 200 })),
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    await service.recordProactiveSuggestion({ sessionId: 'session-1', clientDeviceId: 'device-a', eventCode: 'TORQUE_NG', eventId: 'torque-event-1' });

    expect(prismaMock.businessHermesProactiveSuggestion.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventCode: 'TORQUE_NG', eventId: 'torque-event-1', status: 'ready', targetKey: 'current-bolt' })
    }));
  });
});
