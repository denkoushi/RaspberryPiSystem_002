import { describe, expect, it, vi } from 'vitest';

import type { OverviewProbeBundle } from '../dgx-resource.control-targets.builder.js';
import {
  enrichModelProfilesOverview,
  type DgxModelProfilesOverview,
} from '../dgx-resource.model-profiles.js';
import {
  allReadinessChecksSatisfied,
  buildScenarioReadinessTargetSpec,
  isReadinessNoop,
  waitScenarioReadiness,
} from '../dgx-resource.scenario-readiness.js';

const defaultModelProfiles: DgxModelProfilesOverview = enrichModelProfilesOverview({
  configured: true,
  status: 'ok',
  available: [],
  businessReturnSelectable: [],
  activeProfileId: null,
  activeStateBackend: null,
  activeRuntimeState: null,
  pendingProfileId: null,
  lastLoadedProfileId: null,
});

function mkModelProfiles(over: Partial<DgxModelProfilesOverview>): DgxModelProfilesOverview {
  return enrichModelProfilesOverview({ ...defaultModelProfiles, ...over });
}

function mkBundle(over: Partial<OverviewProbeBundle>): OverviewProbeBundle {
  return {
    policyMode: 'business_first',
    adminCfg: {
      configured: true,
      baseUrl: 'http://gw',
      sharedToken: 't'.repeat(32),
      model: 'x',
      timeoutMs: 60_000,
    },
    gatewayStatus: {
      configured: true,
      baseUrl: 'http://gw',
      model: 'x',
      timeoutMs: 60_000,
      health: { ok: true, statusCode: 200 },
    },
    modelsProbe: { ok: false },
    modelProfiles: defaultModelProfiles,
    metricsConfigured: false,
    metricsPayload: undefined,
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
    ...over,
  } as OverviewProbeBundle;
}

const qwen27 = {
  id: 'business_qwen36_27b_nvfp4',
  displayNameJa: 'Qwen3.6 27B NVFP4',
  backend: 'blue' as const,
  servedAlias: 'system-prod-primary',
  recommended: true,
  businessOrchestrationEligible: true,
  enabled: true,
  status: 'available' as const,
  canonicalNames: [] as string[],
  legacyNames: [] as string[],
};

const qwen35 = {
  id: 'business_qwen35_35b_gguf',
  displayNameJa: 'Qwen3.5 35B GGUF',
  backend: 'green' as const,
  servedAlias: 'system-prod-primary',
  recommended: false,
  businessOrchestrationEligible: true,
  enabled: true,
  status: 'available' as const,
  canonicalNames: [] as string[],
  legacyNames: [] as string[],
};

describe('dgx-resource.scenario-readiness', () => {
  it('buildScenarioReadinessTargetSpec: business復帰ガイドは Inference を必須・補正スタートを許可', () => {
    const s = buildScenarioReadinessTargetSpec({
      scenarioId: 'private_to_business',
      willPostPolicyStartComfy: false,
      willPostPolicyStartExperimentLab: false,
      localLlmRuntimeMode: 'on_demand',
      gatewayRuntimeConfigured: true,
    });
    expect(s.requireInferenceBusiness).toBe(true);
    expect(s.allowGatewayStartRemediation).toBe(true);
    expect(isReadinessNoop(s)).toBe(false);
  });

  it('buildScenarioReadinessTargetSpec: experiment シナリオはヘルス必須（Strict）', () => {
    const s = buildScenarioReadinessTargetSpec({
      scenarioId: 'business_to_experiment',
      willPostPolicyStartComfy: false,
      willPostPolicyStartExperimentLab: true,
      localLlmRuntimeMode: 'always_on',
      gatewayRuntimeConfigured: false,
    });
    expect(s.requireExperimentLabHealthy).toBe(true);
    expect(isReadinessNoop(s)).toBe(false);
  });

  it('waitScenarioReadiness: 連続成功で OK', async () => {
    const bundle = mkBundle({ modelsProbe: { ok: true } });
    const collect = vi.fn(async () => bundle);
    const res = await waitScenarioReadiness({
      spec: buildScenarioReadinessTargetSpec({
        scenarioId: 'experiment_to_business',
        willPostPolicyStartComfy: false,
        willPostPolicyStartExperimentLab: false,
        localLlmRuntimeMode: 'always_on',
        gatewayRuntimeConfigured: false,
      }),
      collectProbeBundle: collect,
      readinessDeadlineMs: 2000,
      readinessPollIntervalMs: 10,
    });
    expect(res.ok).toBe(true);
    expect(res.ok && res.checksJa.every((c) => c.satisfied)).toBe(true);
    expect(collect.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('waitScenarioReadiness: タイムアウトで NG', async () => {
    const bundle = mkBundle({ modelsProbe: { ok: false, statusCode: 502 } });
    const collect = vi.fn(async () => bundle);
    const res = await waitScenarioReadiness({
      spec: buildScenarioReadinessTargetSpec({
        scenarioId: 'private_to_business',
        willPostPolicyStartComfy: false,
        willPostPolicyStartExperimentLab: false,
        localLlmRuntimeMode: 'always_on',
        gatewayRuntimeConfigured: false,
      }),
      collectProbeBundle: collect,
      readinessDeadlineMs: 120,
      readinessPollIntervalMs: 80,
    });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.timedOut).toBe(true);
  });

  it('waitScenarioReadiness: gateway remediation が 1 回だけ呼ばれたあとモデル準備により成功', async () => {
    let modelsOk = false;
    const collect = vi.fn(async () =>
      mkBundle({
        modelsProbe: modelsOk ? { ok: true } : { ok: false, statusCode: 502 },
        modelProfiles: mkModelProfiles({
          available: [qwen27],
          activeProfileId: 'business_qwen36_27b_nvfp4',
          activeStateBackend: 'blue',
        }),
      })
    );
    const dispatch = vi.fn(async () => {
      modelsOk = true;
      return { ok: true as const, message: 'started' };
    });

    const res = await waitScenarioReadiness({
      spec: {
        requireInferenceBusiness: true,
        requirePrivateComfyHealthy: false,
        requireExperimentLabHealthy: false,
        allowGatewayStartRemediation: true,
      },
      collectProbeBundle: collect,
      readinessDeadlineMs: 5000,
      readinessPollIntervalMs: 15,
      runGatewayStartOnceIfNeeded: dispatch,
      modelProfileId: 'business_qwen36_27b_nvfp4',
    });

    expect(res.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith(
      'system-prod-gateway',
      'start',
      'readiness_remediation',
      'none',
      'business_qwen36_27b_nvfp4'
    );
  });

  it('waitScenarioReadiness: /v1/models OK でも activeProfileId 不一致なら success にならない', async () => {
    const bundle = mkBundle({
      modelsProbe: { ok: true },
      modelProfiles: mkModelProfiles({
        available: [qwen27, qwen35],
        activeProfileId: 'business_qwen35_35b_gguf',
        activeStateBackend: 'green',
      }),
    });
    const collect = vi.fn(async () => bundle);
    const res = await waitScenarioReadiness({
      spec: buildScenarioReadinessTargetSpec({
        scenarioId: 'private_to_business',
        willPostPolicyStartComfy: false,
        willPostPolicyStartExperimentLab: false,
        localLlmRuntimeMode: 'always_on',
        gatewayRuntimeConfigured: false,
      }),
      collectProbeBundle: collect,
      readinessDeadlineMs: 120,
      readinessPollIntervalMs: 40,
      modelProfileId: 'business_qwen36_27b_nvfp4',
    });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.checksJa.some((c) => c.code === 'model_profile_active' && !c.satisfied)).toBe(true);
    expect(res.ok === false && res.checksJa.some((c) => c.code === 'inference_business' && c.satisfied)).toBe(true);
  });

  it('waitScenarioReadiness: activeProfileId が null のまま業務復帰 Strict Ready は未達', async () => {
    const bundle = mkBundle({
      modelsProbe: { ok: true },
      modelProfiles: mkModelProfiles({
        available: [qwen27],
        activeProfileId: null,
        activeStateBackend: null,
      }),
    });
    const collect = vi.fn(async () => bundle);
    const res = await waitScenarioReadiness({
      spec: buildScenarioReadinessTargetSpec({
        scenarioId: 'experiment_to_business',
        willPostPolicyStartComfy: false,
        willPostPolicyStartExperimentLab: false,
        localLlmRuntimeMode: 'always_on',
        gatewayRuntimeConfigured: false,
      }),
      collectProbeBundle: collect,
      readinessDeadlineMs: 120,
      readinessPollIntervalMs: 40,
      modelProfileId: 'business_qwen36_27b_nvfp4',
    });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.checksJa.some((c) => c.code === 'model_profile_active' && !c.satisfied)).toBe(true);
  });

  it('waitScenarioReadiness: 選択 profile と active/backend が一致すれば success', async () => {
    const bundle = mkBundle({
      modelsProbe: { ok: true },
      modelProfiles: mkModelProfiles({
        available: [qwen27, qwen35],
        activeProfileId: 'business_qwen36_27b_nvfp4',
        activeStateBackend: 'blue',
      }),
    });
    const collect = vi.fn(async () => bundle);
    const res = await waitScenarioReadiness({
      spec: buildScenarioReadinessTargetSpec({
        scenarioId: 'private_to_business',
        willPostPolicyStartComfy: false,
        willPostPolicyStartExperimentLab: false,
        localLlmRuntimeMode: 'always_on',
        gatewayRuntimeConfigured: false,
      }),
      collectProbeBundle: collect,
      readinessDeadlineMs: 2000,
      readinessPollIntervalMs: 10,
      modelProfileId: 'business_qwen36_27b_nvfp4',
    });

    expect(res.ok).toBe(true);
    expect(res.ok && res.checksJa.some((c) => c.code === 'model_profile_active' && c.satisfied)).toBe(true);
    expect(res.ok && res.checksJa.some((c) => c.code === 'model_profile_backend' && c.satisfied)).toBe(true);
  });

  it('waitScenarioReadiness: state.backend が選択 profile と不一致なら success にならない', async () => {
    const bundle = mkBundle({
      modelsProbe: { ok: true },
      modelProfiles: mkModelProfiles({
        available: [qwen27],
        activeProfileId: 'business_qwen36_27b_nvfp4',
        activeStateBackend: 'green',
      }),
    });
    const collect = vi.fn(async () => bundle);
    const res = await waitScenarioReadiness({
      spec: buildScenarioReadinessTargetSpec({
        scenarioId: 'private_to_business',
        willPostPolicyStartComfy: false,
        willPostPolicyStartExperimentLab: false,
        localLlmRuntimeMode: 'always_on',
        gatewayRuntimeConfigured: false,
      }),
      collectProbeBundle: collect,
      readinessDeadlineMs: 120,
      readinessPollIntervalMs: 40,
      modelProfileId: 'business_qwen36_27b_nvfp4',
    });

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.checksJa.some((c) => c.code === 'model_profile_backend' && !c.satisfied)).toBe(true);
  });

  it('allReadinessChecksSatisfied が部分充足を検出', () => {
    const chk = [{ code: 'inference_business' as const, satisfied: false, detailJa: 'x' }];
    expect(allReadinessChecksSatisfied(chk)).toBe(false);
  });

  it('waitScenarioReadiness: vision 宣言済み profile で runtime vision 未達なら success にならない', async () => {
    const bundle = mkBundle({
      modelsProbe: { ok: true },
      modelProfiles: mkModelProfiles({
        available: [
          {
            ...qwen35,
            declaredCapabilities: ['vision'],
          },
        ],
        activeProfileId: 'business_qwen35_35b_gguf',
        activeStateBackend: 'green',
        activeRuntimeState: {
          runtimeReadyCapabilities: ['text'],
          visionReadyReason: 'mmproj_missing',
        },
      }),
    });
    const collect = vi.fn(async () => bundle);
    const res = await waitScenarioReadiness({
      spec: buildScenarioReadinessTargetSpec({
        scenarioId: 'private_to_business',
        willPostPolicyStartComfy: false,
        willPostPolicyStartExperimentLab: false,
        localLlmRuntimeMode: 'always_on',
        gatewayRuntimeConfigured: false,
      }),
      collectProbeBundle: collect,
      readinessDeadlineMs: 120,
      readinessPollIntervalMs: 40,
      modelProfileId: 'business_qwen35_35b_gguf',
    });

    expect(res.ok).toBe(false);
    expect(
      res.ok === false && res.checksJa.some((c) => c.code === 'model_profile_vision_runtime' && !c.satisfied)
    ).toBe(true);
  });
});
