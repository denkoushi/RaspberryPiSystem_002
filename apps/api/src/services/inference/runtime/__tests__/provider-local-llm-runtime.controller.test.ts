import { describe, expect, it, vi } from 'vitest';

import type { InferenceProviderDefinition } from '../../config/inference-provider.types.js';
import { InferenceRouter, type InferenceRouteTarget } from '../../routing/inference-router.js';
import type { InferenceUseCase } from '../../types/inference-usecase.js';
import { ProviderLocalLlmRuntimeController } from '../provider-local-llm-runtime.controller.js';

function createProviders(): InferenceProviderDefinition[] {
  return [
    {
      id: 'dgx_text',
      baseUrl: 'http://dgx:38081',
      sharedToken: 'dgx-token',
      timeoutMs: 60_000,
      defaultModel: 'system-prod-primary',
      runtimeControl: {
        mode: 'on_demand',
        startUrl: 'http://dgx:38081/start',
        stopUrl: 'http://dgx:38081/stop',
        controlToken: 'dgx-control',
        healthBaseUrl: 'http://dgx:38081',
      },
    },
    {
      id: 'ubuntu_vlm',
      baseUrl: 'http://ubuntu:38081',
      sharedToken: 'ubuntu-token',
      timeoutMs: 60_000,
      defaultModel: 'Qwen_Qwen3.5-9B-Q4_K_M.gguf',
      runtimeControl: {
        mode: 'on_demand',
        startUrl: 'http://ubuntu:38081/start',
        stopUrl: 'http://ubuntu:38081/stop',
        controlToken: 'ubuntu-control',
        healthBaseUrl: 'http://ubuntu:38081',
      },
    },
  ];
}

function inferenceRoutes(
  overrides: Partial<Record<InferenceUseCase, InferenceRouteTarget>> = {}
): Record<InferenceUseCase, InferenceRouteTarget> {
  return {
    photo_label: { providerId: 'dgx_text' },
    document_summary: { providerId: 'dgx_text' },
    admin_console_chat: { providerId: 'dgx_text' },
    stackchan_chat: { providerId: 'dgx_text' },
    ...overrides,
  };
}

const defaultRuntimeIntentEnv = { runtimeStartProfileEnabled: false };

describe('ProviderLocalLlmRuntimeController', () => {
  it('routes document summary and photo label to different runtime endpoints', async () => {
    const providers = createProviders();
    const router = new InferenceRouter({
      providers,
      routes: inferenceRoutes({
        document_summary: { providerId: 'dgx_text', modelOverride: 'system-prod-primary' },
        photo_label: { providerId: 'ubuntu_vlm', modelOverride: 'Qwen_Qwen3.5-9B-Q4_K_M.gguf' },
      }),
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ready', { status: 200 });
      }
      if (url.endsWith('/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const controller = new ProviderLocalLlmRuntimeController({
      fetchImpl,
      globalMode: 'on_demand',
      router,
      providers,
      resolveAdminProvider: () => providers[0],
      resolveAdminModel: () => 'system-prod-primary',
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv: defaultRuntimeIntentEnv,
    });

    await controller.ensureReady('document_summary');
    await controller.release('document_summary');
    await controller.ensureReady('photo_label');
    await controller.release('photo_label');

    const calledUrls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(calledUrls.filter((url) => url === 'http://dgx:38081/start')).toHaveLength(1);
    expect(calledUrls.filter((url) => url === 'http://dgx:38081/stop')).toHaveLength(1);
    expect(calledUrls.filter((url) => url === 'http://ubuntu:38081/start')).toHaveLength(1);
    expect(calledUrls.filter((url) => url === 'http://ubuntu:38081/stop')).toHaveLength(1);
  });

  it('falls back to legacy primary runtime control for admin console chat', async () => {
    const providers = createProviders().map((provider, idx) =>
      idx === 0 ? { ...provider, runtimeControl: undefined } : provider
    );
    const router = new InferenceRouter({
      providers,
      routes: inferenceRoutes({
        document_summary: { providerId: 'dgx_text' },
        photo_label: { providerId: 'ubuntu_vlm' },
      }),
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/legacy/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ready', { status: 200 });
      }
      if (url.endsWith('/legacy/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const controller = new ProviderLocalLlmRuntimeController({
      fetchImpl,
      globalMode: 'on_demand',
      router,
      providers,
      resolveAdminProvider: () => providers[0],
      resolveAdminModel: () => 'system-prod-primary',
      legacyAdminRuntimeControl: {
        mode: 'on_demand',
        startUrl: 'http://dgx:38081/legacy/start',
        stopUrl: 'http://dgx:38081/legacy/stop',
        controlToken: 'legacy-control',
        healthBaseUrl: 'http://dgx:38081',
      },
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv: defaultRuntimeIntentEnv,
    });

    await controller.ensureReady('admin_console_chat');
    await controller.release('admin_console_chat');

    const calledUrls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(calledUrls.filter((url) => url === 'http://dgx:38081/legacy/start')).toHaveLength(1);
    expect(calledUrls.filter((url) => url === 'http://dgx:38081/legacy/stop')).toHaveLength(1);
  });

  it('routes stackchan_chat to the same admin provider runtime as admin_console_chat', async () => {
    const providers = createProviders().map((provider, idx) =>
      idx === 0 ? { ...provider, runtimeControl: undefined } : provider
    );
    const router = new InferenceRouter({
      providers,
      routes: inferenceRoutes({
        document_summary: { providerId: 'dgx_text' },
        photo_label: { providerId: 'ubuntu_vlm' },
      }),
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/legacy/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ready', { status: 200 });
      }
      if (url.endsWith('/legacy/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const controller = new ProviderLocalLlmRuntimeController({
      fetchImpl,
      globalMode: 'on_demand',
      router,
      providers,
      resolveAdminProvider: () => providers[0],
      resolveAdminModel: () => 'system-prod-primary',
      legacyAdminRuntimeControl: {
        mode: 'on_demand',
        startUrl: 'http://dgx:38081/legacy/start',
        stopUrl: 'http://dgx:38081/legacy/stop',
        controlToken: 'legacy-control',
        healthBaseUrl: 'http://dgx:38081',
      },
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv: defaultRuntimeIntentEnv,
    });

    await controller.ensureReady('stackchan_chat');
    await controller.release('stackchan_chat');

    const calledUrls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(calledUrls.filter((url) => url === 'http://dgx:38081/legacy/start')).toHaveLength(1);
    expect(calledUrls.filter((url) => url === 'http://dgx:38081/legacy/stop')).toHaveLength(1);
  });

  it('passes shouldSuppressStop so release does not POST /stop', async () => {
    const providers = createProviders();
    const router = new InferenceRouter({
      providers,
      routes: inferenceRoutes({
        document_summary: { providerId: 'dgx_text', modelOverride: 'system-prod-primary' },
        photo_label: { providerId: 'ubuntu_vlm', modelOverride: 'Qwen_Qwen3.5-9B-Q4_K_M.gguf' },
      }),
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ready', { status: 200 });
      }
      if (url.endsWith('/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const controller = new ProviderLocalLlmRuntimeController({
      fetchImpl,
      globalMode: 'on_demand',
      router,
      providers,
      resolveAdminProvider: () => providers[0],
      resolveAdminModel: () => 'system-prod-primary',
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      shouldSuppressStop: (_useCase) => true,
      runtimeIntentEnv: defaultRuntimeIntentEnv,
    });

    await controller.ensureReady('document_summary');
    await controller.release('document_summary');
    expect(
      fetchImpl.mock.calls.filter(([u, init]) => String(u).endsWith('/stop') && init?.method === 'POST').length
    ).toBe(0);
  });

  it('uses agent-container runtime control for agent_container_task', async () => {
    const providers = createProviders();
    const router = new InferenceRouter({
      providers,
      routes: inferenceRoutes({
        document_summary: { providerId: 'dgx_text' },
        photo_label: { providerId: 'ubuntu_vlm' },
      }),
    });

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/agent-container/start') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      if (url.endsWith('/agent-container/health') && init?.method === 'GET') {
        return new Response('{"ok":true}', { status: 200 });
      }
      if (url.endsWith('/agent-container/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const controller = new ProviderLocalLlmRuntimeController({
      fetchImpl,
      globalMode: 'on_demand',
      router,
      providers,
      resolveAdminProvider: () => providers[0],
      resolveAdminModel: () => 'system-prod-primary',
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      shouldSuppressStop: () => true,
      agentContainerRuntimeControl: {
        startUrl: 'http://dgx:38081/agent-container/start',
        stopUrl: 'http://dgx:38081/agent-container/stop',
        controlToken: 'ctrl',
        optionalSimpleHealthProbeUrl: 'http://dgx:38081/agent-container/health',
      },
      runtimeIntentEnv: defaultRuntimeIntentEnv,
    });

    await controller.ensureReady('agent_container_task');
    await controller.release('agent_container_task');
    const posts = fetchImpl.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts.some(([u]) => String(u).includes('/agent-container/start'))).toBe(true);
    expect(posts.some(([u]) => String(u).includes('/agent-container/stop'))).toBe(false);
    const gets = fetchImpl.mock.calls.filter(([, init]) => init?.method === 'GET');
    expect(gets.some(([u]) => String(u).includes('/agent-container/health'))).toBe(true);
  });

  it('release uses controller pinned at ensureReady when runtime intent env changes mid-flight', async () => {
    const providers = createProviders();
    const router = new InferenceRouter({
      providers,
      routes: inferenceRoutes(),
    });

    const startBodies: Array<{ modelProfileId?: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/start') && init?.method === 'POST') {
        startBodies.push(JSON.parse(String(init.body)) as { modelProfileId?: string });
        return new Response('', { status: 200 });
      }
      if (url.includes('/system/model-profiles') && init?.method === 'GET') {
        const activeProfileId = runtimeIntentEnv.businessRuntimeStartProfileId;
        return new Response(
          JSON.stringify({
            ok: true,
            activeProfileId,
            state: {
              runtimeReadyCapabilities: ['text', 'vision'],
              visionReadyReason: 'vision',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ready', { status: 200 });
      }
      if (url.endsWith('/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const runtimeIntentEnv = {
      runtimeStartProfileEnabled: true,
      businessRuntimeStartProfileId: 'business_qwen36_27b_nvfp4',
    };

    const controller = new ProviderLocalLlmRuntimeController({
      fetchImpl,
      globalMode: 'on_demand',
      router,
      providers,
      resolveAdminProvider: () => providers[0],
      resolveAdminModel: () => 'system-prod-primary',
      readyTimeoutMs: 30_000,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv,
    });

    await controller.ensureReady('photo_label');
    runtimeIntentEnv.businessRuntimeStartProfileId = 'business_qwen35_35b_gguf';
    await controller.release('photo_label');

    expect(startBodies).toHaveLength(1);
    expect(startBodies[0]?.modelProfileId).toBe('business_qwen36_27b_nvfp4');
    const stopCalls = fetchImpl.mock.calls.filter(([url, init]) => String(url).endsWith('/stop') && init?.method === 'POST');
    expect(stopCalls).toHaveLength(1);
  });

  it('drops leased controller when ensureReady fails so next retry can re-resolve profile intent', async () => {
    const providers = createProviders();
    const router = new InferenceRouter({
      providers,
      routes: inferenceRoutes({
        photo_label: { providerId: 'dgx_text' },
      }),
    });

    const startBodies: Array<{ modelProfileId?: string }> = [];
    let startAttempts = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/start') && init?.method === 'POST') {
        startBodies.push(JSON.parse(String(init.body)) as { modelProfileId?: string });
        startAttempts += 1;
        if (startAttempts === 1) {
          return new Response('boom', { status: 503 });
        }
        return new Response('', { status: 200 });
      }
      if (url.includes('/system/model-profiles') && init?.method === 'GET') {
        const activeProfileId = runtimeIntentEnv.businessRuntimeStartProfileId;
        return new Response(
          JSON.stringify({
            ok: true,
            activeProfileId,
            state: {
              runtimeReadyCapabilities: ['text', 'vision'],
              visionReadyReason: 'vision',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/v1/chat/completions') && init?.method === 'POST') {
        return new Response('ready', { status: 200 });
      }
      if (url.endsWith('/stop') && init?.method === 'POST') {
        return new Response('', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    const runtimeIntentEnv = {
      runtimeStartProfileEnabled: true,
      businessRuntimeStartProfileId: 'business_qwen36_27b_nvfp4',
    };

    const controller = new ProviderLocalLlmRuntimeController({
      fetchImpl,
      globalMode: 'on_demand',
      router,
      providers,
      resolveAdminProvider: () => providers[0],
      resolveAdminModel: () => 'system-prod-primary',
      readyTimeoutMs: 100,
      startRequestTimeoutMs: 10_000,
      stopRequestTimeoutMs: 10_000,
      healthPollIntervalMs: 1,
      runtimeIntentEnv,
    });

    await expect(controller.ensureReady('photo_label')).rejects.toThrow();

    runtimeIntentEnv.businessRuntimeStartProfileId = 'business_qwen35_35b_gguf';
    await controller.ensureReady('photo_label');
    await controller.release('photo_label');

    expect(startBodies).toHaveLength(2);
    expect(startBodies[0]?.modelProfileId).toBe('business_qwen36_27b_nvfp4');
    expect(startBodies[1]?.modelProfileId).toBe('business_qwen35_35b_gguf');
  });
});
