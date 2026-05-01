import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../../lib/errors.js';
import { DgxResourcePolicyStore } from '../dgx-resource.policy-store.js';
import { createDgxResourceService } from '../dgx-resource.service.js';

import type { LocalLlmGateway } from '../../local-llm-proxy.service.js';

function makeSvc(store: DgxResourcePolicyStore, gateway: LocalLlmGateway, fetchImpl: typeof fetch = fetch) {
  return createDgxResourceService({
    fetchImpl,
    localLlmGateway: gateway,
    getAdminLocalLlmRuntimeConfig: () => ({
      configured: true,
      baseUrl: 'http://127.0.0.1:38081',
      sharedToken: 'x'.repeat(32),
      model: 'm1',
      timeoutMs: 60_000,
    }),
    policyStore: store,
    probeTimeoutMs: 3000,
  });
}

describe('createDgxResourceService', () => {
  it('SET_POLICY persists in store and logs event', async () => {
    const store = new DgxResourcePolicyStore(20);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: true,
        baseUrl: 'http://127.0.0.1:38081',
        model: 'm1',
        timeoutMs: 60_000,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);

    await svc.executeAction({ type: 'SET_POLICY', policyMode: 'private_ok' });
    const overview = await svc.getOverview();

    expect(overview.policy.mode).toBe('private_ok');
    expect(svc.getEvents(5)[0]?.message).toContain('変更');
  });

  it('rejects LOCAL_LLM_START when not on_demand or control URLs missing', async () => {
    const store = new DgxResourcePolicyStore(20);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(),
      createChatCompletion: vi.fn(),
    };
    const svc = makeSvc(store, gateway);

    await expect(svc.executeAction({ type: 'LOCAL_LLM_START' })).rejects.toThrow(ApiError);

    await expect(svc.executeAction({ type: 'LOCAL_LLM_START' })).rejects.toMatchObject({
      code: 'DGX_RUNTIME_CONTROL_NOT_CONFIGURED',
    });
  });
});
