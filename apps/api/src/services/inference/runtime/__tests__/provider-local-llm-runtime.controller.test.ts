import { describe, expect, it, vi } from 'vitest';

import type { InferenceProviderDefinition } from '../../config/inference-provider.types.js';
import { InferenceRouter } from '../../routing/inference-router.js';
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

describe('ProviderLocalLlmRuntimeController', () => {
  it('routes document summary and photo label to different runtime endpoints', async () => {
    const providers = createProviders();
    const router = new InferenceRouter({
      providers,
      routes: {
        document_summary: { providerId: 'dgx_text', modelOverride: 'system-prod-primary' },
        photo_label: { providerId: 'ubuntu_vlm', modelOverride: 'Qwen_Qwen3.5-9B-Q4_K_M.gguf' },
      },
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
      routes: {
        document_summary: { providerId: 'dgx_text' },
        photo_label: { providerId: 'ubuntu_vlm' },
      },
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
    });

    await controller.ensureReady('admin_console_chat');
    await controller.release('admin_console_chat');

    const calledUrls = fetchImpl.mock.calls.map(([url]) => String(url));
    expect(calledUrls.filter((url) => url === 'http://dgx:38081/legacy/start')).toHaveLength(1);
    expect(calledUrls.filter((url) => url === 'http://dgx:38081/legacy/stop')).toHaveLength(1);
  });
});
