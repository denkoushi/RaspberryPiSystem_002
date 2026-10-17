import { describe, expect, it } from 'vitest';

import { planWorkloadAdjustmentsBeforePolicyChange } from '../dgx-resource.policy-arbitrator.js';

describe('planWorkloadAdjustmentsBeforePolicyChange', () => {
  it('returns empty when applyWorkloadChanges is false', () => {
    expect(
      planWorkloadAdjustmentsBeforePolicyChange({
        nextMode: 'business_first',
        applyWorkloadChanges: false,
        experimentLabRuntimeConfigured: true,
        agentContainerRuntimeConfigured: true,
        gatewayRuntimeConfigured: true,
      })
    ).toEqual([]);
  });

  it('business_first stops experiment then agent-container when configured', () => {
    const plan = planWorkloadAdjustmentsBeforePolicyChange({
      nextMode: 'business_first',
      applyWorkloadChanges: true,
      experimentLabRuntimeConfigured: true,
      agentContainerRuntimeConfigured: true,
      gatewayRuntimeConfigured: true,
    });
    expect(plan.map((s) => s.targetId)).toEqual(['experiment-lab', 'agent-container']);
    expect(plan.every((s) => s.action === 'stop')).toBe(true);
  });

  it('business_first stops experiment when agent hooks unset', () => {
    const plan = planWorkloadAdjustmentsBeforePolicyChange({
      nextMode: 'business_first',
      applyWorkloadChanges: true,
      experimentLabRuntimeConfigured: true,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
    });
    expect(plan.map((s) => s.targetId)).toEqual(['experiment-lab']);
  });

  it('experiment_first does not stop business workloads (gateway は業務/Agent維持のため自動停止しない)', () => {
    const plan = planWorkloadAdjustmentsBeforePolicyChange({
      nextMode: 'experiment_first',
      applyWorkloadChanges: true,
      experimentLabRuntimeConfigured: false,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
    });
    expect(plan.map((s) => s.targetId)).toEqual([]);
    expect(plan.every((s) => s.action === 'stop')).toBe(true);
  });

  it('private_ok preserves all business workloads when configured', () => {
    expect(
      planWorkloadAdjustmentsBeforePolicyChange({
        nextMode: 'private_ok',
        applyWorkloadChanges: true,
        experimentLabRuntimeConfigured: true,
        agentContainerRuntimeConfigured: true,
        gatewayRuntimeConfigured: true,
      })
    ).toEqual([]);
  });
});
