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
        gatewayRuntimeConfigured: true,
      })
    ).toEqual([]);
  });

  it('business_first stops experiment then comfy when configured', () => {
    const plan = planWorkloadAdjustmentsBeforePolicyChange({
      nextMode: 'business_first',
      applyWorkloadChanges: true,
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: true,
      gatewayRuntimeConfigured: true,
    });
    expect(plan.map((s) => s.targetId)).toEqual(['experiment-lab', 'private-comfyui']);
    expect(plan.every((s) => s.action === 'stop')).toBe(true);
  });

  it('experiment_first stops comfy then gateway when configured', () => {
    const plan = planWorkloadAdjustmentsBeforePolicyChange({
      nextMode: 'experiment_first',
      applyWorkloadChanges: true,
      comfyRuntimeConfigured: true,
      experimentLabRuntimeConfigured: false,
      gatewayRuntimeConfigured: true,
    });
    expect(plan.map((s) => s.targetId)).toEqual(['private-comfyui', 'system-prod-gateway']);
    expect(plan.every((s) => s.action === 'stop')).toBe(true);
  });

  it('private_ok stops experiment-lab when configured', () => {
    expect(
      planWorkloadAdjustmentsBeforePolicyChange({
        nextMode: 'private_ok',
        applyWorkloadChanges: true,
        comfyRuntimeConfigured: true,
        experimentLabRuntimeConfigured: true,
        gatewayRuntimeConfigured: true,
      })
    ).toEqual([
      {
        targetId: 'experiment-lab',
        action: 'stop',
        eventMessageJa: '私用OK: experiment-lab 停止リクエストを送信しました（GPU 解放）',
      },
    ]);
  });
});
