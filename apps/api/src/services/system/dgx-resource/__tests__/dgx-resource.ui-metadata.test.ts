import { describe, expect, it, vi } from 'vitest';

import { buildDgxResourceUiMetadata } from '../dgx-resource.ui-metadata.js';
import { createDgxResourceService } from '../dgx-resource.service.js';
import { DgxResourcePolicyStore } from '../dgx-resource.policy-store.js';

import type { LocalLlmGateway } from '../../local-llm-proxy.service.js';

describe('buildDgxResourceUiMetadata', () => {
  it('includes all orchestration scenarios and policy modes with expected ids', () => {
    const meta = buildDgxResourceUiMetadata();

    expect(meta.scenarios.map((s) => s.id)).toEqual([
      'business_to_private',
      'private_to_business',
      'business_to_experiment',
      'experiment_to_business',
    ]);
    expect(meta.policyModes.map((p) => p.mode)).toEqual(['business_first', 'private_ok', 'experiment_first']);

    for (const scenario of meta.scenarios) {
      expect(scenario.titleJa.length).toBeGreaterThan(0);
      expect(scenario.descriptionJa.length).toBeGreaterThan(0);
      expect(Array.isArray(scenario.cautionsJa)).toBe(true);
    }

    for (const policy of meta.policyModes) {
      expect(policy.labelJa.length).toBeGreaterThan(0);
      expect(policy.titleFullJa.length).toBeGreaterThan(0);
      expect(policy.descriptionJa.length).toBeGreaterThan(0);
      expect(Array.isArray(policy.autoArbitrationNotesJa)).toBe(true);
      expect(policy.autoArbitrationNotesJa.length).toBeGreaterThan(0);
    }
  });
});

describe('createDgxResourceService overview uiMetadata', () => {
  it('exposes uiMetadata on overview response', async () => {
    const store = new DgxResourcePolicyStore(20);
    const gateway: LocalLlmGateway = {
      getStatus: vi.fn(async () => ({
        configured: false,
        baseUrl: undefined,
        model: undefined,
        timeoutMs: 60_000,
        health: { ok: false },
      })),
      createChatCompletion: vi.fn(),
    };
    const svc = createDgxResourceService({
      fetchImpl: vi.fn(async () => ({ ok: false, status: 599, text: async () => '', json: async () => ({}) }) as Response),
      localLlmGateway: gateway,
      getAdminLocalLlmRuntimeConfig: () => ({
        configured: false,
        baseUrl: undefined,
        sharedToken: undefined,
        model: undefined,
        timeoutMs: 60_000,
      }),
      policyStore: store,
      probeTimeoutMs: 3000,
    });

    const overview = await svc.getOverview();

    expect(overview.uiMetadata).toBeDefined();
    expect(overview.uiMetadata!.scenarios).toHaveLength(4);
    expect(overview.uiMetadata!.policyModes).toHaveLength(3);
    expect(overview.uiMetadata!.scenarios[0]?.id).toBe('business_to_private');
    expect(overview.uiMetadata!.policyModes[0]?.mode).toBe('business_first');
  });
});
