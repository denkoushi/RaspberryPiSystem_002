import { describe, expect, it, vi } from 'vitest';

import { HttpOnDemandLocalLlmRuntimeController } from '../http-on-demand-local-llm-runtime.controller.js';

describe('HttpOnDemandLocalLlmRuntimeController', () => {
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
    });

    await c.ensureReady('admin_console_chat');
    expect(chatN).toBeGreaterThanOrEqual(2);
    await c.release('admin_console_chat');
    const posts = fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.length).toBe(4);
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
    });

    await expect(c.ensureReady('document_summary')).rejects.toThrow(
      'LocalLlmRuntimeControl: ready probe auth failed HTTP 403'
    );
  });
});
