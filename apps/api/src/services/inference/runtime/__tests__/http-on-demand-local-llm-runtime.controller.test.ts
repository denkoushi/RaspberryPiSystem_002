import { describe, expect, it, vi } from 'vitest';

import { HttpOnDemandLocalLlmRuntimeController } from '../http-on-demand-local-llm-runtime.controller.js';

describe('HttpOnDemandLocalLlmRuntimeController', () => {
  it('starts once and polls health until ready', async () => {
    let healthN = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/runtime/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/healthz')) {
        healthN += 1;
        return new Response('ok\n', { status: healthN >= 2 ? 200 : 503 });
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
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
    });

    await c.ensureReady('photo_label');
    expect(healthN).toBeGreaterThanOrEqual(2);
    await c.release('photo_label');
    const posts = fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.length).toBe(2);
  });

  it('concurrent ensureReady shares one start', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/healthz')) {
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
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
    });

    await Promise.all([c.ensureReady('photo_label'), c.ensureReady('document_summary')]);
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
    ).toBe(1);
  });
});
