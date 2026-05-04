import { describe, expect, it } from 'vitest';

import {
  buildOrchestrationScenarioPreview,
  computeScenarioPlanFingerprint,
} from '../dgx-resource.scenario-planner.js';

describe('dgx-resource.scenario-planner', () => {
  it('computeScenarioPlanFingerprint is deterministic for normalized inputs', () => {
    const input = {
      scenarioId: 'business_to_private' as const,
      targetPolicyMode: 'private_ok' as const,
      applyWorkloadChanges: true,
      postPolicyStarts: [],
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
    };

    expect(computeScenarioPlanFingerprint(input)).toBe(computeScenarioPlanFingerprint(input));
  });

  it('buildOrchestrationScenarioPreview includes policy step before optional post-policy comfy start when hooks exist', () => {
    const p = buildOrchestrationScenarioPreview({
      scenarioId: 'business_to_private',
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
      currentPolicyMode: 'business_first',
      inferenceLooksDegraded: false,
      comfyLooksRunning: false,
    });

    const policyIdx = p.steps.findIndex((s) => s.kind === 'policy');
    const postComfyIdx = p.steps.findIndex((s) => s.kind === 'workload' && s.targetId === 'private-comfyui' && s.action === 'start');
    expect(policyIdx).toBeGreaterThan(-1);
    expect(postComfyIdx).toBeGreaterThan(policyIdx);

    expect(
      computeScenarioPlanFingerprint({
        scenarioId: p.scenarioId,
        targetPolicyMode: p.targetPolicyMode,
        applyWorkloadChanges: p.applyWorkloadChanges,
        postPolicyStarts: ['private-comfyui'],
        comfyRuntimeConfigured: true,
        experimentLabRuntimeConfigured: false,
        gatewayRuntimeConfigured: true,
      })
    ).toBe(p.planFingerprint);
  });

  it('business_to_private adds pre-policy experiment stop when runtime hook exists', () => {
    const p = buildOrchestrationScenarioPreview({
      scenarioId: 'business_to_private',
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: true,
      gatewayRuntimeConfigured: true,
      currentPolicyMode: 'business_first',
      inferenceLooksDegraded: false,
      comfyLooksRunning: false,
    });
    const expStopIdx = p.steps.findIndex(
      (s) => s.kind === 'workload' && s.targetId === 'experiment-lab' && s.action === 'stop'
    );
    const policyIdx = p.steps.findIndex((s) => s.kind === 'policy');
    expect(expStopIdx).toBeGreaterThan(-1);
    expect(policyIdx).toBeGreaterThan(expStopIdx);
  });

  it('buildOrchestrationScenarioPreview includes policy step last when no post-policy steps and aligns fingerprint inputs', () => {
    const p = buildOrchestrationScenarioPreview({
      scenarioId: 'experiment_to_business',
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: true,
      gatewayRuntimeConfigured: true,
      currentPolicyMode: 'experiment_first',
      inferenceLooksDegraded: false,
      comfyLooksRunning: false,
    });

    expect(p.steps[p.steps.length - 1]?.kind).toBe('policy');
    const expectedFp = computeScenarioPlanFingerprint({
      scenarioId: p.scenarioId,
      targetPolicyMode: p.targetPolicyMode,
      applyWorkloadChanges: p.applyWorkloadChanges,
      postPolicyStarts: [],
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: true,
      gatewayRuntimeConfigured: true,
    });
    expect(p.planFingerprint).toBe(expectedFp);
  });

  it('business_to_experiment adds post-policy experiment start when hooks exist', () => {
    const p = buildOrchestrationScenarioPreview({
      scenarioId: 'business_to_experiment',
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: true,
      gatewayRuntimeConfigured: true,
      currentPolicyMode: 'business_first',
      inferenceLooksDegraded: false,
      comfyLooksRunning: false,
    });
    const postExpIdx = p.steps.findIndex((s) => s.kind === 'workload' && s.targetId === 'experiment-lab' && s.action === 'start');
    const policyIdx = p.steps.findIndex((s) => s.kind === 'policy');
    expect(policyIdx).toBeGreaterThan(-1);
    expect(postExpIdx).toBeGreaterThan(policyIdx);
    expect(p.planFingerprint).toBe(
      computeScenarioPlanFingerprint({
        scenarioId: p.scenarioId,
        targetPolicyMode: p.targetPolicyMode,
        applyWorkloadChanges: p.applyWorkloadChanges,
        postPolicyStarts: ['experiment-lab'],
        comfyRuntimeConfigured: true,
        experimentLabRuntimeConfigured: true,
        gatewayRuntimeConfigured: true,
      })
    );
  });
});
