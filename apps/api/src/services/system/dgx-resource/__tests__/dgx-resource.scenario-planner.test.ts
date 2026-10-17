import { describe, expect, it } from 'vitest';

import {
  buildOrchestrationScenarioPreview,
  computeScenarioPlanFingerprint,
} from '../dgx-resource.scenario-planner.js';

describe('dgx-resource.scenario-planner', () => {
  it('computeScenarioPlanFingerprint is deterministic for normalized inputs', () => {
    const input = {
      scenarioId: 'private_to_business' as const,
      targetPolicyMode: 'business_first' as const,
      applyWorkloadChanges: true,
      postPolicyStarts: [],
      experimentLabRuntimeConfigured: false,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
    };

    expect(computeScenarioPlanFingerprint(input)).toBe(computeScenarioPlanFingerprint(input));
  });


  it('private_to_business adds pre-policy experiment stop when runtime hook exists', () => {
    const p = buildOrchestrationScenarioPreview({
      scenarioId: 'private_to_business',
      experimentLabRuntimeConfigured: true,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
      currentPolicyMode: 'business_first',
      inferenceLooksDegraded: false,
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
      experimentLabRuntimeConfigured: true,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
      currentPolicyMode: 'experiment_first',
      inferenceLooksDegraded: false,
    });

    expect(p.steps[p.steps.length - 1]?.kind).toBe('policy');
    const expectedFp = computeScenarioPlanFingerprint({
      scenarioId: p.scenarioId,
      targetPolicyMode: p.targetPolicyMode,
      applyWorkloadChanges: p.applyWorkloadChanges,
      postPolicyStarts: [],
      experimentLabRuntimeConfigured: true,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
    });
    expect(p.planFingerprint).toBe(expectedFp);
  });

  it('business_to_experiment adds post-policy experiment start when hooks exist', () => {
    const p = buildOrchestrationScenarioPreview({
      scenarioId: 'business_to_experiment',
      experimentLabRuntimeConfigured: true,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
      currentPolicyMode: 'business_first',
      inferenceLooksDegraded: false,
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
        experimentLabRuntimeConfigured: true,
        agentContainerRuntimeConfigured: false,
        gatewayRuntimeConfigured: true,
      })
    );
  });

  it('business return modelProfileId changes fingerprint and adds load step', () => {
    const base = {
      scenarioId: 'private_to_business' as const,
      experimentLabRuntimeConfigured: false,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
      currentPolicyMode: 'private_ok' as const,
      inferenceLooksDegraded: false,
      modelProfiles: [
        {
          id: 'business_qwen36_27b_nvfp4',
          displayNameJa: 'Qwen3.6 27B NVFP4',
          backend: 'blue' as const,
          servedAlias: 'system-prod-primary',
          recommended: true,
          enabled: true,
          status: 'available' as const,
          canonicalNames: [],
          legacyNames: [],
        },
      ],
    };
    const q36 = buildOrchestrationScenarioPreview({ ...base, modelProfileId: 'business_qwen36_27b_nvfp4' });
    const q35 = buildOrchestrationScenarioPreview({ ...base, modelProfileId: 'business_qwen35_35b_gguf' });

    expect(q36.planFingerprint).not.toBe(q35.planFingerprint);
    expect(q36.steps.some((s) => s.kind === 'modelProfile' && s.modelProfileId === 'business_qwen36_27b_nvfp4')).toBe(true);
  });
});
