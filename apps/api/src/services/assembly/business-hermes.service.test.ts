import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, imageStorageMock, imageOcrLayoutMock } = vi.hoisted(() => ({
  prismaMock: {
    kioskDocument: { findUnique: vi.fn() },
    businessHermesProactiveSuggestion: {
      findUnique: vi.fn(),
      create: vi.fn()
    }
  },
  imageStorageMock: { readImage: vi.fn() },
  imageOcrLayoutMock: { runLayoutOcrOnImage: vi.fn() }
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../lib/assembly-procedure-image-storage.js', () => ({ AssemblyProcedureImageStorage: imageStorageMock }));
vi.mock('../ocr/image-ocr-runtime.js', () => ({ getImageOcrLayoutPort: () => imageOcrLayoutMock }));

import { BusinessHermesService, resetBusinessHermesProcedurePageOcrCacheForTests } from './business-hermes.service.js';
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
        updatedAt: now,
        pages: [{ pageIndex: 0, imageRelativePath: '/api/storage/assembly-procedure-images/procedure-1-page-0.jpg' }]
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

function createOcrResult(text = '公開ページの手順本文', confidence = 90) {
  return {
    text,
    engine: 'tesseract.js',
    words: [{ text: text.slice(0, 6), confidence, bbox: { x0: 0, y0: 0, x1: 20, y1: 20 } }]
  };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe('BusinessHermesService', () => {
  beforeEach(() => {
    resetBusinessHermesProcedurePageOcrCacheForTests();
    imageStorageMock.readImage.mockReset();
    imageOcrLayoutMock.runLayoutOcrOnImage.mockReset();
  });

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
    expect(requestBody?.model_options).toEqual({ reasoning: { enabled: true, effort: 'high' } });
    expect(JSON.stringify(requestBody)).toContain('currentStatusの正式値を使い');
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

  it.each([
    { known: false, message: '根拠不足', targetKey: null },
    { known: true, message: '現在の対象を案内します。', targetKey: null }
  ])('returns unknown for unsupported upstream output ($known, target=$targetKey)', async (upstream) => {
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(createSession()) } as unknown as AssemblyWorkSessionService,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(upstream) } }] }), { status: 200 })),
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

  it('uses the published page OCR only when the instruction text is empty', async () => {
    const session = createSession();
    session.template.procedureSteps[0].instructionText = '';
    const getDetail = vi.fn().mockResolvedValue(session);
    const fetchImpl = vi.fn(async (_input: URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      expect(body.messages[1]?.content).toContain('公開ページから読み取った締付手順');
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ known: true, message: '案内', targetKey: 'current-bolt' }) } }]
      }), { status: 200 });
    });
    const procedurePageOcr = vi.fn().mockResolvedValue('公開ページから読み取った締付手順');
    const service = new BusinessHermesService({
      sessionService: { getDetail } as unknown as AssemblyWorkSessionService,
      procedurePageOcr,
      fetchImpl,
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result.status).toBe('ready');
    expect(result.evidence[0]).toMatchObject({
      sourceKind: 'assembly_procedure_page_ocr',
      documentId: 'procedure-1',
      pageIndex: 0,
      bodyAvailable: true,
      bodyScope: 'page',
      documentUpdatedAt: '2026-09-05T00:00:00.000Z'
    });
    expect(procedurePageOcr).toHaveBeenCalledWith({
      documentId: 'procedure-1',
      pageIndex: 0,
      documentUpdatedAt: '2026-09-05T00:00:00.000Z',
      imageRelativePath: '/api/storage/assembly-procedure-images/procedure-1-page-0.jpg'
    });
  });

  it('keeps Hermes unavailable when published page OCR has no usable body', async () => {
    const session = createSession();
    session.template.procedureSteps[0].instructionText = '';
    const fetchImpl = vi.fn();
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(session) } as unknown as AssemblyWorkSessionService,
      procedurePageOcr: vi.fn().mockResolvedValue(''),
      fetchImpl,
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result).toMatchObject({ status: 'unavailable', reasonCode: 'PROCEDURE_BODY_UNAVAILABLE' });
    expect(result.evidence[0]).toMatchObject({ sourceKind: 'assembly_procedure_page_ocr', bodyAvailable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses the existing image OCR port and rejects low-confidence page text', async () => {
    const session = createSession();
    session.template.procedureSteps[0].instructionText = '';
    imageStorageMock.readImage.mockResolvedValue({ buffer: Buffer.from('page'), contentType: 'image/jpeg' });
    imageOcrLayoutMock.runLayoutOcrOnImage.mockResolvedValue({
      text: '低品質の読み取り',
      engine: 'tesseract.js',
      words: [{ text: '低品質', confidence: 40, bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }]
    });
    const fetchImpl = vi.fn();
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(session) } as unknown as AssemblyWorkSessionService,
      fetchImpl,
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    const result = await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(result).toMatchObject({ status: 'unavailable', reasonCode: 'PROCEDURE_BODY_UNAVAILABLE' });
    expect(imageStorageMock.readImage).toHaveBeenCalledWith('/api/storage/assembly-procedure-images/procedure-1-page-0.jpg');
    expect(imageOcrLayoutMock.runLayoutOcrOnImage).toHaveBeenCalledWith({ imageBytes: Buffer.from('page'), mimeType: 'image/jpeg' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shares one OCR operation for the same page and serves later requests from the bounded cache', async () => {
    const session = createSession();
    session.template.procedureSteps[0].instructionText = '';
    let resolveOcr!: (value: ReturnType<typeof createOcrResult>) => void;
    const ocrPromise = new Promise<ReturnType<typeof createOcrResult>>((resolve) => { resolveOcr = resolve; });
    imageStorageMock.readImage.mockResolvedValue({ buffer: Buffer.from('page'), contentType: 'image/jpeg' });
    imageOcrLayoutMock.runLayoutOcrOnImage.mockReturnValue(ocrPromise);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ known: true, message: '案内', targetKey: 'current-bolt' }) } }]
    }), { status: 200 }));
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(session) } as unknown as AssemblyWorkSessionService,
      fetchImpl,
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    const first = service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });
    const second = service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r2', eventCode: 'USER_REQUEST' });
    await flushMicrotasks();
    expect(imageStorageMock.readImage).toHaveBeenCalledTimes(1);
    expect(imageOcrLayoutMock.runLayoutOcrOnImage).toHaveBeenCalledTimes(1);

    resolveOcr(createOcrResult());
    await expect(first).resolves.toMatchObject({ status: 'ready' });
    await expect(second).resolves.toMatchObject({ status: 'ready' });
    await expect(service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r3', eventCode: 'USER_REQUEST' }))
      .resolves.toMatchObject({ status: 'ready' });
    expect(imageStorageMock.readImage).toHaveBeenCalledTimes(1);
    expect(imageOcrLayoutMock.runLayoutOcrOnImage).toHaveBeenCalledTimes(1);
  });

  it('fails a different page while another page is OCR in flight', async () => {
    const firstSession = createSession();
    firstSession.template.procedureSteps[0].instructionText = '';
    const secondSession = createSession();
    secondSession.id = 'session-2';
    secondSession.currentBoltId = 'bolt-2';
    secondSession.template.areas[0].bolts[0].id = 'bolt-2';
    secondSession.template.areas[0].bolts[0].pageIndex = 1;
    secondSession.template.procedureDocument.pages.push({ pageIndex: 1, imageRelativePath: '/api/storage/assembly-procedure-images/procedure-1-page-1.jpg' });
    secondSession.template.procedureSteps[0].pageIndex = 1;
    secondSession.template.procedureSteps[0].instructionText = '';
    let resolveOcr!: (value: ReturnType<typeof createOcrResult>) => void;
    const ocrPromise = new Promise<ReturnType<typeof createOcrResult>>((resolve) => { resolveOcr = resolve; });
    imageStorageMock.readImage.mockResolvedValue({ buffer: Buffer.from('page'), contentType: 'image/jpeg' });
    imageOcrLayoutMock.runLayoutOcrOnImage.mockReturnValue(ocrPromise);
    const getDetail = vi.fn().mockImplementation((sessionId: string) => Promise.resolve(sessionId === 'session-1' ? firstSession : secondSession));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ known: true, message: '案内', targetKey: 'current-bolt' }) } }]
    }), { status: 200 }));
    const service = new BusinessHermesService({
      sessionService: { getDetail } as unknown as AssemblyWorkSessionService,
      fetchImpl,
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    const first = service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });
    await flushMicrotasks();
    const second = await service.guide({ sessionId: 'session-2', clientDeviceId: 'device-a', uiRevision: 'r2', eventCode: 'USER_REQUEST' });
    expect(second).toMatchObject({ status: 'unavailable', reasonCode: 'PROCEDURE_BODY_UNAVAILABLE' });
    expect(imageOcrLayoutMock.runLayoutOcrOnImage).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();

    resolveOcr(createOcrResult());
    await expect(first).resolves.toMatchObject({ status: 'ready' });
  });

  it('keeps a timed-out OCR in flight and caches a late successful result', async () => {
    vi.useFakeTimers();
    try {
      const session = createSession();
      session.template.procedureSteps[0].instructionText = '';
      let resolveOcr!: (value: ReturnType<typeof createOcrResult>) => void;
      const ocrPromise = new Promise<ReturnType<typeof createOcrResult>>((resolve) => { resolveOcr = resolve; });
      imageStorageMock.readImage.mockResolvedValue({ buffer: Buffer.from('page'), contentType: 'image/jpeg' });
      imageOcrLayoutMock.runLayoutOcrOnImage.mockReturnValue(ocrPromise);
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ known: true, message: '案内', targetKey: 'current-bolt' }) } }]
      }), { status: 200 }));
      const service = new BusinessHermesService({
        sessionService: { getDetail: vi.fn().mockResolvedValue(session) } as unknown as AssemblyWorkSessionService,
        fetchImpl,
        config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
      });

      const timedOut = service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });
      await flushMicrotasks();
      expect(imageOcrLayoutMock.runLayoutOcrOnImage).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(12_000);
      await expect(timedOut).resolves.toMatchObject({ status: 'unavailable', reasonCode: 'PROCEDURE_BODY_UNAVAILABLE' });
      expect(fetchImpl).not.toHaveBeenCalled();

      const lateSuccess = service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r2', eventCode: 'USER_REQUEST' });
      await flushMicrotasks();
      expect(imageOcrLayoutMock.runLayoutOcrOnImage).toHaveBeenCalledTimes(1);
      resolveOcr(createOcrResult());
      await expect(lateSuccess).resolves.toMatchObject({ status: 'ready' });
      await expect(service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r3', eventCode: 'USER_REQUEST' }))
        .resolves.toMatchObject({ status: 'ready' });
      expect(imageOcrLayoutMock.runLayoutOcrOnImage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('invalidates OCR cache when the published page revision or image changes', async () => {
    const session = createSession();
    session.template.procedureSteps[0].instructionText = '';
    imageStorageMock.readImage.mockResolvedValue({ buffer: Buffer.from('page'), contentType: 'image/jpeg' });
    imageOcrLayoutMock.runLayoutOcrOnImage.mockResolvedValue(createOcrResult());
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ known: true, message: '案内', targetKey: 'current-bolt' }) } }]
    }), { status: 200 }));
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(session) } as unknown as AssemblyWorkSessionService,
      fetchImpl,
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    await expect(service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' }))
      .resolves.toMatchObject({ status: 'ready' });
    session.template.procedureDocument.updatedAt = new Date('2026-09-05T00:00:01.000Z');
    session.template.procedureDocument.pages[0].imageRelativePath = '/api/storage/assembly-procedure-images/procedure-1-page-0-revision-2.jpg';
    await expect(service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r2', eventCode: 'USER_REQUEST' }))
      .resolves.toMatchObject({ status: 'ready' });

    expect(imageStorageMock.readImage).toHaveBeenCalledTimes(2);
    expect(imageOcrLayoutMock.runLayoutOcrOnImage).toHaveBeenCalledTimes(2);
  });

  it('does not OCR when instruction text is present', async () => {
    const procedurePageOcr = vi.fn();
    const service = new BusinessHermesService({
      sessionService: { getDetail: vi.fn().mockResolvedValue(createSession()) } as unknown as AssemblyWorkSessionService,
      procedurePageOcr,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ known: true, message: '案内', targetKey: 'current-bolt' }) } }] }), { status: 200 })),
      config: { provider: 'dgx', baseUrl: 'https://business-hermes.test', apiKey: 'secret', model: 'model', timeoutMs: 1000 }
    });

    await service.guide({ sessionId: 'session-1', clientDeviceId: 'device-a', uiRevision: 'r1', eventCode: 'USER_REQUEST' });

    expect(procedurePageOcr).not.toHaveBeenCalled();
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
