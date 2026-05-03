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
      applyWorkloadChanges: false,
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
    };

    expect(computeScenarioPlanFingerprint(input)).toBe(computeScenarioPlanFingerprint(input));
  });

  it('buildOrchestrationScenarioPreview includes policy step last and aligns fingerprint inputs', () => {
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
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: true,
      gatewayRuntimeConfigured: true,
    });
    expect(p.planFingerprint).toBe(expectedFp);
  });
});
