import { describe, expect, it } from 'vitest';

import { buildDgxResourceRuntimeSummary } from '../dgx-resource.runtime-summary.js';
import type { OverviewProbeBundle } from '../dgx-resource.control-targets.builder.js';
import type { DgxModelProfilesOverview } from '../dgx-resource.model-profiles.js';

function mkBundle(partial: Partial<OverviewProbeBundle>): OverviewProbeBundle {
  const defaults: OverviewProbeBundle = {
    policyMode: 'business_first',
    adminCfg: { configured: true, baseUrl: 'http://dgx', sharedToken: 'tok' },
    gatewayStatus: { configured: true, health: { ok: true } },
    modelsProbe: { ok: true, inferenceHint: 'llamacpp' },
    modelProfiles: {
      configured: true,
      status: 'ok',
      available: [
        {
          id: 'business_qwen35_35b_gguf',
          displayNameJa: '35B GGUF',
          backend: 'green',
          servedAlias: 'system-prod-primary',
          recommended: false,
          businessOrchestrationEligible: true,
          enabled: true,
          status: 'available',
          canonicalNames: [],
          legacyNames: [],
        },
      ],
      activeProfileId: 'business_qwen35_35b_gguf',
      activeStateBackend: 'green',
      activeRuntimeState: null,
      pendingProfileId: null,
      lastLoadedProfileId: null,
      resourceState: {
        owner: 'business',
        status: 'preparing',
        updatedAt: '2026-06-07T00:00:00Z',
        action: 'start',
        reason: 'scenario_guide_model_profile',
        modelProfileId: 'business_qwen35_35b_gguf',
        displayNameJa: '35B GGUF',
        backend: 'green',
        guaranteeLevel: 'post_only',
      },
    },
    metricsConfigured: true,
    metricsPayload: { gpuUtilPct: 0, unifiedMemoryUsedGiB: 22, unifiedMemoryTotalGiB: 128, freeMemoryGiB: 100 },
    comfyConfigured: false,
    comfyReachable: false,
    embeddingConfigured: false,
    embeddingReachable: false,
    sparkConfigured: false,
    sparkProbe: { ok: false },
    runtimeControlConfigured: true,
    comfyRuntimeControlConfigured: false,
    experimentLabHealthConfigured: false,
    experimentLabReachable: false,
    experimentLabRuntimeControlConfigured: false,
    agentContainerHealthConfigured: false,
    agentContainerReachable: false,
    agentContainerRuntimeControlConfigured: false,
  };
  return { ...defaults, ...partial };
}

describe('buildDgxResourceRuntimeSummary', () => {
  it('exposes active model from model profile state', () => {
    const summary = buildDgxResourceRuntimeSummary(mkBundle({}), 'business_first');
    expect(summary.activeProfileId).toBe('business_qwen35_35b_gguf');
    expect(summary.activeProfileDisplayNameJa).toBe('35B GGUF');
    expect(summary.activeBackend).toBe('green');
    expect(summary.runtimeSource).toBe('model_profile_state');
    expect(summary.businessReady).toBe(true);
    expect(summary.resourceOwner).toBe('business');
    expect(summary.resourceOwnerLabelJa).toBe('業務');
  });

  it('marks business not ready when models probe fails', () => {
    const summary = buildDgxResourceRuntimeSummary(
      mkBundle({
        modelsProbe: { ok: false, statusCode: 503 },
        gatewayStatus: { configured: true, health: { ok: true } },
      }),
      'private_ok'
    );
    expect(summary.businessReady).toBe(false);
    expect(summary.inferenceDegraded).toBe(true);
    expect(summary.policyLabel).toContain('私用');
  });

  it('reports business runtime intent alignment', () => {
    const summary = buildDgxResourceRuntimeSummary(mkBundle({}), 'business_first', {
      businessRuntimeStartProfileId: 'business_qwen35_35b_gguf',
    });
    expect(summary.businessRuntimeIntentProfileId).toBe('business_qwen35_35b_gguf');
    expect(summary.businessRuntimeIntentSource).toBe('env');
    expect(summary.businessRuntimeIntentAlignedWithActive).toBe(true);
  });

  it('handles missing active profile', () => {
    const mp: DgxModelProfilesOverview = {
      configured: true,
      status: 'ok',
      available: [],
      businessReturnSelectable: [],
      activeProfileId: null,
      activeStateBackend: null,
      activeRuntimeState: null,
      pendingProfileId: null,
      lastLoadedProfileId: null,
      resourceState: null,
    };
    const summary = buildDgxResourceRuntimeSummary(mkBundle({ modelProfiles: mp }), 'business_first');
    expect(summary.activeProfileId).toBeNull();
    expect(summary.runtimeSource).toBe('unknown');
  });
});
