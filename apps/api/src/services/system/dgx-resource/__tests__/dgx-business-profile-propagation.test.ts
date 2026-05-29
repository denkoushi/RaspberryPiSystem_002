import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  getBusinessProfileIntentStore,
  resetBusinessProfileIntentStoreForTests,
} from '../../../inference/config/business-profile-intent-store.js';
import {
  computeScenarioPlanFingerprint,
  resolveScenarioPolicyIntent,
} from '../dgx-resource.scenario-planner.js';
import { buildPostPolicyOrchestrationSteps } from '../dgx-resource.scenario-post-policy.js';
import { executeOrchestrationScenarioTransition } from '../dgx-resource.workload-transition.js';
import { getDgxResourcePolicyStore, resetDgxResourcePolicyStoreForTests } from '../dgx-resource.policy-store.js';

describe('dgx business profile propagation', () => {
  beforeEach(() => {
    resetBusinessProfileIntentStoreForTests();
    resetDgxResourcePolicyStoreForTests();
  });

  it('records orchestration-selected modelProfileId on successful business return', async () => {
    const policyStore = getDgxResourcePolicyStore(50);
    const runTargetRuntimeAction = vi.fn().mockResolvedValue({ ok: true, message: 'ok' });
    const capability = {
      comfyRuntimeConfigured: false,
      experimentLabRuntimeConfigured: false,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
    };
    const scenarioId = 'private_to_business' as const;
    const modelProfileId = 'business_qwen35_35b_gguf';
    const intent = resolveScenarioPolicyIntent(scenarioId);
    const postPolicyPlan = buildPostPolicyOrchestrationSteps({
      scenarioId,
      comfyRuntimeConfigured: capability.comfyRuntimeConfigured,
      experimentLabRuntimeConfigured: capability.experimentLabRuntimeConfigured,
    });
    const postPolicyStarts: Array<'private-comfyui' | 'experiment-lab'> = [];
    for (const s of postPolicyPlan) {
      if (s.action === 'start' && (s.targetId === 'private-comfyui' || s.targetId === 'experiment-lab')) {
        postPolicyStarts.push(s.targetId);
      }
    }
    const planFingerprint = computeScenarioPlanFingerprint({
      scenarioId,
      targetPolicyMode: intent.targetPolicyMode,
      applyWorkloadChanges: intent.applyWorkloadChanges,
      postPolicyStarts,
      ...capability,
      modelProfileId,
    });

    const result = await executeOrchestrationScenarioTransition({
      scenarioId,
      planFingerprint,
      modelProfileId,
      capability,
      runTargetRuntimeAction,
      policyStore,
    });

    expect(result.scenarioExecute.success).toBe(true);
    expect(getBusinessProfileIntentStore().getModelProfileId()).toBe(modelProfileId);
    expect(getBusinessProfileIntentStore().get()?.source).toBe('orchestration');
  });
});
