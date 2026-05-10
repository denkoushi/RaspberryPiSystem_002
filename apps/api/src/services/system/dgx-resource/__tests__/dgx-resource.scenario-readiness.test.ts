import { describe, expect, it, vi } from 'vitest';

import type { OverviewProbeBundle } from '../dgx-resource.control-targets.builder.js';
import {
  allReadinessChecksSatisfied,
  buildScenarioReadinessTargetSpec,
  isReadinessNoop,
  waitScenarioReadiness,
} from '../dgx-resource.scenario-readiness.js';

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
    });

    expect(res.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('allReadinessChecksSatisfied が部分充足を検出', () => {
    const chk = [{ code: 'inference_business' as const, satisfied: false, detailJa: 'x' }];
    expect(allReadinessChecksSatisfied(chk)).toBe(false);
  });
});
