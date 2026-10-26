import Fastify, { type FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../config/env/load-dotenv.js', () => ({}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { clientDevice: { findUnique: vi.fn() } } }));
vi.mock('../../../services/inference/inference-runtime.js', () => ({
  getInferenceRuntime: vi.fn(),
}));
vi.mock('../../../services/system/local-llm-on-demand-runtime.js', () => ({
  withAdminConsoleChatOnDemandRuntime: vi.fn(),
}));

import { env } from '../../../config/env.js';
import { prisma } from '../../../lib/prisma.js';
import { getInferenceRuntime } from '../../../services/inference/inference-runtime.js';
import type { InferenceProviderDefinition } from '../../../services/inference/config/inference-provider.types.js';
import { InferenceRouter } from '../../../services/inference/routing/inference-router.js';
import { registerLocalLlmRoutes } from '../local-llm.js';

describe('local LLM availability (isolated, real JWT/client-key authorization)', () => {
  let app: FastifyInstance;
  let provider: InferenceProviderDefinition;
  let viewerHeaders: { authorization: string };
  let restoreEnv: () => void;

  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')));
    const originalEnv = {
      LOCAL_LLM_RUNTIME_MODE: env.LOCAL_LLM_RUNTIME_MODE,
      INFERENCE_RUNTIME_START_PROFILE_ENABLED: env.INFERENCE_RUNTIME_START_PROFILE_ENABLED,
    };
    restoreEnv = () => Object.assign(env, originalEnv);
    env.LOCAL_LLM_RUNTIME_MODE = 'on_demand';
    env.INFERENCE_RUNTIME_START_PROFILE_ENABLED = false;
    provider = {
      id: 'business', baseUrl: 'http://business.test', sharedToken: 'test-business-token',
      defaultModel: 'business-model', timeoutMs: 60_000,
      runtimeControl: {
        mode: 'on_demand', startUrl: 'http://business.test/start', stopUrl: 'http://business.test/stop',
        healthBaseUrl: 'http://business-health.test',
      },
    };
    const router = new InferenceRouter({
      providers: [provider],
      routes: {
        business_hermes: { providerId: provider.id }, security_review: { providerId: provider.id }, photo_label: { providerId: provider.id },
        document_summary: { providerId: provider.id }, admin_console_chat: { providerId: 'admin' },
      },
    });
    vi.mocked(getInferenceRuntime).mockReturnValue({
      router, providers: [provider], getAdminProvider: () => undefined,
    } as ReturnType<typeof getInferenceRuntime>);
    viewerHeaders = { authorization: `Bearer ${jwt.sign({ sub: 'viewer', username: 'viewer', role: 'VIEWER' }, env.JWT_ACCESS_SECRET)}` };
    app = Fastify();
    registerLocalLlmRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    restoreEnv();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const availabilityUrl = '/system/local-llm/availability';

  it('uses the business runtime health target with GET only and accepts a VIEWER', async () => {
    const response = await app.inject({ url: availabilityUrl, headers: viewerHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: true });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('http://business-health.test/v1/models', {
      method: 'GET', headers: { 'X-LLM-Token': 'test-business-token' }, signal: expect.any(AbortSignal),
    });
  });

  it('reports false when inference is unhealthy even if the gateway healthz would be healthy', async () => {
    vi.mocked(fetch).mockImplementation(async (url) => new Response('', {
      status: String(url).endsWith('/healthz') ? 200 : 503,
    }));
    const response = await app.inject({ url: availabilityUrl, headers: viewerHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports false when no business provider is configured without probing', async () => {
    vi.spyOn(getInferenceRuntime().router, 'resolve').mockImplementation(() => { throw new Error('not configured'); });
    const response = await app.inject({ url: availabilityUrl, headers: viewerHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports false for network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    const response = await app.inject({ url: availabilityUrl, headers: viewerHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false });
  });

  it.each([true, false])('caches %s for ten seconds, then probes again', async (available) => {
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: available ? 200 : 503 }));
    await app.inject({ url: availabilityUrl, headers: viewerHeaders });
    clock.mockReturnValue(now + 9999);
    const cached = await app.inject({ url: availabilityUrl, headers: viewerHeaders });
    expect(cached.json()).toEqual({ available });
    expect(fetch).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + 10_000);
    await app.inject({ url: availabilityUrl, headers: viewerHeaders });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight probe across polling clients', async () => {
    let completeProbe!: (response: Response) => void;
    let probeStarted!: () => void;
    const started = new Promise<void>((resolve) => { probeStarted = resolve; });
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => {
      completeProbe = resolve;
      probeStarted();
    }));
    const first = app.inject({ url: availabilityUrl, headers: viewerHeaders }).then((response) => response);
    await started;
    const second = app.inject({ url: availabilityUrl, headers: viewerHeaders }).then((response) => response);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(fetch).toHaveBeenCalledTimes(1);
    completeProbe(new Response('{}'));
    expect((await first).json()).toEqual({ available: true });
    expect((await second).json()).toEqual({ available: true });
  });

  it('aborts the health probe at two seconds and returns 200 false', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let probeStarted!: () => void;
    const started = new Promise<void>((resolve) => { probeStarted = resolve; });
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
      probeStarted();
    }));
    const pending = app.inject({ url: availabilityUrl, headers: viewerHeaders }).then((response) => response);
    await started;
    await vi.advanceTimersByTimeAsync(2000);
    const response = await pending;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: false });
  });

  it.each([true, false])('checks the expected profile using GET only (matching=%s)', async (matching) => {
    env.INFERENCE_RUNTIME_START_PROFILE_ENABLED = true;
    provider.runtimeStartProfileId = 'business-profile';
    vi.mocked(fetch).mockImplementation(async (url) => new Response(JSON.stringify(
      String(url).endsWith('/system/model-profiles')
        ? { activeProfileId: matching ? 'business-profile' : 'other-profile' }
        : { data: [{ id: 'business-model' }] }
    )));
    const response = await app.inject({ url: availabilityUrl, headers: viewerHeaders });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: matching });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
  });

  it('accepts a registered kiosk client key', async () => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue({ id: 'kiosk' } as Awaited<ReturnType<typeof prisma.clientDevice.findUnique>>);
    const response = await app.inject({ url: availabilityUrl, headers: { 'x-client-key': 'registered-key' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ available: true });
    expect(prisma.clientDevice.findUnique).toHaveBeenCalledWith({ where: { apiKey: 'registered-key' } });
  });

  it.each([{}, { 'x-client-key': 'invalid-key' }, { authorization: 'Bearer invalid' }])('rejects unauthenticated callers: %j', async (headers) => {
    vi.mocked(prisma.clientDevice.findUnique).mockResolvedValue(null);
    const response = await app.inject({ url: availabilityUrl, headers });
    expect(response.statusCode).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the existing status route restricted to ADMIN/MANAGER', async () => {
    const response = await app.inject({ url: '/system/local-llm/status', headers: viewerHeaders });
    expect(response.statusCode).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
