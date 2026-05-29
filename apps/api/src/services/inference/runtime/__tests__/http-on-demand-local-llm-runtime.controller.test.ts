import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HttpOnDemandLocalLlmRuntimeController } from '../http-on-demand-local-llm-runtime.controller.js';
import { resetMainLocalLlmRuntimeControlQueueForTests } from '../local-llm-runtime-command-queue.js';

const defaultRuntimeIntentEnv = { runtimeStartProfileEnabled: false };

const testProvider = {
  id: 'dgx_primary',
  baseUrl: 'http://llm:38081',
  sharedToken: 'llm',
  timeoutMs: 60_000,
  defaultModel: 'system-prod-primary',
};

describe('HttpOnDemandLocalLlmRuntimeController', () => {
  beforeEach(() => {
    resetMainLocalLlmRuntimeControlQueueForTests();
  });
  it('starts once and polls chat completions until ready for admin console chat', async () => {
    let chatN = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/runtime/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        chatN += 1;
        return new Response('ok\n', { status: chatN >= 2 ? 200 : 503 });
      }
      if (url.includes('/runtime/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;

    const c = new HttpOnDemandLocalLlmRuntimeController({
      fetchImpl,
      startUrl: 'http://ubuntu/runtime/start',
      stopUrl: 'http://ubuntu/runtime/stop',
      controlToken: 'ctrl',
      healthCheckBaseUrl: 'http://llm:38081',
      llmToken: 'llm',
      readyProbeModels: {
        admin_console_chat: 'qwen-ready',
      },
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv: defaultRuntimeIntentEnv,
      provider: testProvider,
    });

    await c.ensureReady('admin_console_chat');
    expect(chatN).toBeGreaterThanOrEqual(2);
    await c.release('admin_console_chat');
    const posts = fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.length).toBe(4);
  });

  it('polls optionalSimpleHealthProbeUrl with GET when set', async () => {
    let healthN = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/aux/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/agent/health') && init?.method === 'GET') {
        healthN += 1;
        return new Response('ok', { status: healthN >= 2 ? 200 : 503 });
      }
      if (url.includes('/aux/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;

    const c = new HttpOnDemandLocalLlmRuntimeController({
      fetchImpl,
      startUrl: 'http://ubuntu/aux/start',
      stopUrl: 'http://ubuntu/aux/stop',
      controlToken: 'ctrl',
      healthCheckBaseUrl: 'http://unused/',
      llmToken: '',
      optionalSimpleHealthProbeUrl: 'http://gw/agent/health',
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv: defaultRuntimeIntentEnv,
      provider: testProvider,
    });

    await c.ensureReady('photo_label');
    expect(healthN).toBeGreaterThanOrEqual(2);
    await c.release('photo_label');
    expect(fetchImpl.mock.calls.some(([u]) => String(u).endsWith('/aux/stop'))).toBe(true);
  });

  it('concurrent ensureReady shares one start', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ok\n', { status: 200 });
      }
      if (url.includes('/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;

    const c = new HttpOnDemandLocalLlmRuntimeController({
      fetchImpl,
      startUrl: 'http://ubuntu/start',
      stopUrl: 'http://ubuntu/stop',
      controlToken: 'ctrl',
      healthCheckBaseUrl: 'http://llm:38081/',
      llmToken: 't',
      readyProbeModels: {
        photo_label: 'photo-model',
        document_summary: 'summary-model',
        admin_console_chat: 'admin-model',
      },
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv: defaultRuntimeIntentEnv,
      provider: testProvider,
    });

    await Promise.all([
      c.ensureReady('photo_label'),
      c.ensureReady('document_summary'),
      c.ensureReady('admin_console_chat'),
    ]);
    const startPosts = fetchImpl.mock.calls.filter(
      ([u, init]) => String(u).includes('/start') && init?.method === 'POST'
    );
    expect(startPosts.length).toBe(1);
    await c.release('photo_label');
    expect(
      fetchImpl.mock.calls.filter(([u, init]) => String(u).includes('/stop') && init?.method === 'POST').length
    ).toBe(0);
    await c.release('document_summary');
    expect(
      fetchImpl.mock.calls.filter(([u, init]) => String(u).includes('/stop') && init?.method === 'POST').length
    ).toBe(0);
    await c.release('admin_console_chat');
    expect(
      fetchImpl.mock.calls.filter(([u, init]) => String(u).includes('/stop') && init?.method === 'POST').length
    ).toBe(1);
  });

  it('fails immediately when ready probe returns auth error', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('forbidden', { status: 403 });
      }
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;

    const c = new HttpOnDemandLocalLlmRuntimeController({
      fetchImpl,
      startUrl: 'http://ubuntu/start',
      stopUrl: 'http://ubuntu/stop',
      controlToken: 'ctrl',
      healthCheckBaseUrl: 'http://llm:38081/',
      llmToken: 'bad-token',
      readyProbeModels: {
        document_summary: 'summary-model',
      },
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv: defaultRuntimeIntentEnv,
      provider: testProvider,
    });

    await expect(c.ensureReady('document_summary')).rejects.toThrow(
      'LocalLlmRuntimeControl: ready probe auth failed HTTP 403'
    );
  });

  it('skips stop when shouldSuppressStop returns true for use case', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ok\n', { status: 200 });
      }
      if (url.includes('/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;

    const c = new HttpOnDemandLocalLlmRuntimeController({
      fetchImpl,
      startUrl: 'http://ubuntu/start',
      stopUrl: 'http://ubuntu/stop',
      controlToken: 'ctrl',
      healthCheckBaseUrl: 'http://llm:38081/',
      llmToken: 't',
      readyProbeModels: { admin_console_chat: 'm' },
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      shouldSuppressStop: (_useCase) => true,
      runtimeIntentEnv: defaultRuntimeIntentEnv,
      provider: testProvider,
    });

    await c.ensureReady('admin_console_chat');
    await c.release('admin_console_chat');
    expect(
      fetchImpl.mock.calls.filter(([u, init]) => String(u).includes('/stop') && init?.method === 'POST').length
    ).toBe(0);
  });

  it('includes modelProfileId in start body when runtime start profile is enabled', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/system/model-profiles') && init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            ok: true,
            activeProfileId: 'business_qwen36_27b_nvfp4',
            state: { runtimeReadyCapabilities: ['text', 'vision'], visionReadyReason: 'vision' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ok\n', { status: 200 });
      }
      if (url.includes('/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;

    const c = new HttpOnDemandLocalLlmRuntimeController({
      fetchImpl,
      startUrl: 'http://ubuntu/start',
      stopUrl: 'http://ubuntu/stop',
      controlToken: 'ctrl',
      healthCheckBaseUrl: 'http://llm:38081/',
      llmToken: 't',
      readyProbeModels: { photo_label: 'photo-model' },
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv: {
        runtimeStartProfileEnabled: true,
        photoLabelRuntimeStartProfileId: 'business_qwen35_35b_gguf',
      },
      provider: {
        ...testProvider,
        runtimeStartProfileId: 'business_qwen36_27b_nvfp4',
      },
    });

    await c.ensureReady('photo_label');
    const startPost = fetchImpl.mock.calls.find(
      ([u, init]) => String(u).includes('/start') && init?.method === 'POST'
    );
    expect(startPost).toBeDefined();
    const body = JSON.parse(String(startPost?.[1]?.body ?? '{}'));
    expect(body.reason).toBe('photo_label');
    expect(body.modelProfileId).toBe('business_qwen36_27b_nvfp4');
    await c.release('photo_label');
  });

  it('fails photo_label when profile sent but vision capability is missing', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/system/model-profiles') && init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            ok: true,
            activeProfileId: 'business_qwen35_35b_gguf',
            state: { runtimeReadyCapabilities: ['text'], visionReadyReason: 'mmproj_missing' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ok\n', { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;

    const c = new HttpOnDemandLocalLlmRuntimeController({
      fetchImpl,
      startUrl: 'http://ubuntu/start',
      stopUrl: 'http://ubuntu/stop',
      controlToken: 'ctrl',
      healthCheckBaseUrl: 'http://llm:38081/',
      llmToken: 't',
      readyProbeModels: { photo_label: 'photo-model' },
      readyTimeoutMs: 200,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv: {
        runtimeStartProfileEnabled: true,
        businessRuntimeStartProfileId: 'business_qwen35_35b_gguf',
      },
      provider: testProvider,
    });

    await expect(c.ensureReady('photo_label')).rejects.toThrow(/lacks vision runtime capability/);
  });

  it('runs photo_label vision readiness even when document_summary warmed the shared controller', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/system/model-profiles') && init?.method === 'GET') {
        return new Response(
          JSON.stringify({
            ok: true,
            activeProfileId: 'business_qwen35_35b_gguf',
            state: { runtimeReadyCapabilities: ['text'], visionReadyReason: 'mmproj_missing' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ok\n', { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;

    const c = new HttpOnDemandLocalLlmRuntimeController({
      fetchImpl,
      startUrl: 'http://ubuntu/start',
      stopUrl: 'http://ubuntu/stop',
      controlToken: 'ctrl',
      healthCheckBaseUrl: 'http://llm:38081/',
      llmToken: 't',
      readyProbeModels: {
        photo_label: 'photo-model',
        document_summary: 'summary-model',
      },
      readyTimeoutMs: 200,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv: {
        runtimeStartProfileEnabled: true,
        businessRuntimeStartProfileId: 'business_qwen35_35b_gguf',
      },
      provider: testProvider,
    });

    await c.ensureReady('document_summary');
    await expect(c.ensureReady('photo_label')).rejects.toThrow(/lacks vision runtime capability/);
    await c.release('photo_label');
    await c.release('document_summary');
  });
});
