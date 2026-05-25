import { describe, expect, it } from 'vitest';

import { planWorkloadAdjustmentsBeforePolicyChange } from '../dgx-resource.policy-arbitrator.js';

describe('planWorkloadAdjustmentsBeforePolicyChange', () => {
  it('returns empty when applyWorkloadChanges is false', () => {
    expect(
      planWorkloadAdjustmentsBeforePolicyChange({
        nextMode: 'business_first',
        applyWorkloadChanges: false,
        comfyRuntimeConfigured: true,
        experimentLabRuntimeConfigured: true,
        agentContainerRuntimeConfigured: true,
        gatewayRuntimeConfigured: true,
      })
    ).toEqual([]);
  });

  it('business_first stops experiment then agent-container then comfy when configured', () => {
    const plan = planWorkloadAdjustmentsBeforePolicyChange({
      nextMode: 'business_first',
      applyWorkloadChanges: true,
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: true,
      agentContainerRuntimeConfigured: true,
      gatewayRuntimeConfigured: true,
    });
    expect(plan.map((s) => s.targetId)).toEqual(['experiment-lab', 'agent-container', 'private-comfyui']);
    expect(plan.every((s) => s.action === 'stop')).toBe(true);
  });

  it('business_first stops experiment then comfy when agent hooks unset', () => {
    const plan = planWorkloadAdjustmentsBeforePolicyChange({
      nextMode: 'business_first',
      applyWorkloadChanges: true,
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: true,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
    });
    expect(plan.map((s) => s.targetId)).toEqual(['experiment-lab', 'private-comfyui']);
  });

  it('experiment_first stops comfy only when configured (gateway は業務/Agent維持のため自動停止しない)', () => {
    const plan = planWorkloadAdjustmentsBeforePolicyChange({
      nextMode: 'experiment_first',
      applyWorkloadChanges: true,
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: false,
      agentContainerRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
    });
    expect(plan.map((s) => s.targetId)).toEqual(['private-comfyui']);
    expect(plan.every((s) => s.action === 'stop')).toBe(true);
  });

  it('private_ok stops experiment-lab, agent-container, then force-stops gateway when configured', () => {
    expect(
      planWorkloadAdjustmentsBeforePolicyChange({
        nextMode: 'private_ok',
        applyWorkloadChanges: true,
        comfyRuntimeConfigured: true,
        experimentLabRuntimeConfigured: true,
        agentContainerRuntimeConfigured: true,
        gatewayRuntimeConfigured: true,
      })
    ).toEqual([
      {
        targetId: 'experiment-lab',
        action: 'stop',
        eventMessageJa: '私用OK: experiment-lab 停止リクエストを送信しました（GPU 解放）',
      },
      {
        targetId: 'agent-container',
        action: 'stop',
        eventMessageJa: '私用OK: agent-container 停止リクエストを送信しました（GPU 解放）',
      },
      {
        targetId: 'system-prod-gateway',
        action: 'stop_force',
        eventMessageJa: '私用OK: system-prod-gateway 強制停止リクエストを送信しました（keep_warm 上書き・GPU 解放）',
      },
    ]);
  });
});
