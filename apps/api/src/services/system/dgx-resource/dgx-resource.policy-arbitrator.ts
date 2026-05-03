import type { DgxPolicyMode } from './dgx-resource.policy-store.js';

import type { DgxControlTargetAction, DgxControlTargetId } from './dgx-resource.control-target.types.js';

/** policy 適用に先立ち、ワークロード調整として実行する target への操作計画（順序込み）。 */
export type WorkloadAdjustmentStep = {
  targetId: Exclude<DgxControlTargetId, 'system-prod-inference' | 'system-prod-embedding' | 'spark-host' | 'metrics-kpi'>;
  action: DgxControlTargetAction;
  eventMessageJa: string;
};

export type WorkloadPlannerInput = {
  nextMode: DgxPolicyMode;
  /** true のときのみ非 noop ステップが返る */
  applyWorkloadChanges: boolean;
  comfyRuntimeConfigured: boolean;
  experimentLabRuntimeConfigured: boolean;
  gatewayRuntimeConfigured: boolean;
};

/**
 * GUI の「ワークロードも調整」で使う自動調停（B/B 方針）。
 * GPU 互換強制ではなく、「業務復帰に寄せる」「実験に寄せる」ための推奨操作の列挙で、未設定ターゲットは無視される。
 */
export function planWorkloadAdjustmentsBeforePolicyChange(input: WorkloadPlannerInput): WorkloadAdjustmentStep[] {
  if (!input.applyWorkloadChanges) return [];

  switch (input.nextMode) {
    case 'business_first': {
      const steps: WorkloadAdjustmentStep[] = [];
      if (input.experimentLabRuntimeConfigured) {
        steps.push({
          targetId: 'experiment-lab',
          action: 'stop',
          eventMessageJa: '業務優先: experiment-lab 停止リクエストを送信しました（設定 URL）',
        });
      }
      if (input.comfyRuntimeConfigured) {
        steps.push({
          targetId: 'private-comfyui',
          action: 'stop',
          eventMessageJa: '業務優先: 私用 ComfyUI 停止リクエストを送信しました（設定 URL）',
        });
      }
      return steps;
    }
    case 'experiment_first': {
      const steps: WorkloadAdjustmentStep[] = [];
      if (input.comfyRuntimeConfigured) {
        steps.push({
          targetId: 'private-comfyui',
          action: 'stop',
          eventMessageJa: '実験優先: 私用 ComfyUI 停止リクエストを送信しました（GPU 競合緩和）',
        });
      }
      if (input.gatewayRuntimeConfigured) {
        steps.push({
          targetId: 'system-prod-gateway',
          action: 'stop',
          eventMessageJa:
            '実験優先: system-prod-gateway ランタイム停止リクエストを送信しました（業務 LocalLLM / on_demand が影響）',
        });
      }
      return steps;
    }
    case 'private_ok':
      return [];
  }
}
