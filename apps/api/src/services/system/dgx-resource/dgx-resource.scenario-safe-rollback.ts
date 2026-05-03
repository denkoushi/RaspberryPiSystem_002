import type { DgxPolicyMode, DgxResourcePolicyStore } from './dgx-resource.policy-store.js';
import type { DgxOrchestrationScenarioId } from './dgx-resource.scenario-planner.js';
import { policyLabelJa } from './dgx-resource.policy-profile.js';

import type { DgxScenarioSafeRollbackJa } from './dgx-resource.scenario-execute.types.js';
import type { TargetRuntimeDispatchFn } from './dgx-resource.target-runtime-fn.js';

export type ScenarioRollbackWorkloadContext = {
  scenarioId: DgxOrchestrationScenarioId;
  policyBefore: DgxPolicyMode;
  /** 復帰先の論理モード */
  rollbackPolicyMode: DgxPolicyMode;
  comfyRuntimeConfigured: boolean;
  experimentLabRuntimeConfigured: boolean;
};

/**
 * 「安全」と判断できる復帰だけを自動で試みる。
 * GPU 状態は断定できないため、危険な逆操作（任意に gateway start など）はしない。
 */
export async function performSafeScenarioRollback(input: {
  ctx: ScenarioRollbackWorkloadContext;
  policyStore: DgxResourcePolicyStore;
  /** 復帳前のアクティブ policy（復帳後との差分のみポリシーストアを変更） */
  currentPolicyBeforeRollback: DgxPolicyMode;
  runTargetRuntimeAction: TargetRuntimeDispatchFn;
}): Promise<DgxScenarioSafeRollbackJa> {
  const { ctx, policyStore, currentPolicyBeforeRollback, runTargetRuntimeAction } = input;
  const steps: string[] = [];

  if (currentPolicyBeforeRollback === ctx.rollbackPolicyMode) {
    return { attempted: false };
  }

  /** ワークロード側の復帰（policy 復帳の前にも後にも危険度が異なるのでシナリオ別） */
  if (ctx.scenarioId === 'business_to_private') {
    if (ctx.comfyRuntimeConfigured && ctx.policyBefore === 'business_first') {
      try {
        await runTargetRuntimeAction('private-comfyui', 'stop', 'scenario_safe_rollback', 'none');
        steps.push('私用 ComfyUI 停止リクエスト（Ready タイムアウト後の復帰）を送信しました');
        policyStore.appendEvent('復帰: Comfy を停止すべく POST を試行しました');
      } catch {
        steps.push('私用 ComfyUI 停止の試行が失敗しました（手動で停止を確認してください）');
        policyStore.appendEvent('復帰警告: private-comfyui stop が失敗した可能性があります');
      }
    }
  }

  if (ctx.scenarioId === 'business_to_experiment') {
    if (ctx.experimentLabRuntimeConfigured && ctx.policyBefore === 'business_first') {
      try {
        await runTargetRuntimeAction('experiment-lab', 'stop', 'scenario_safe_rollback', 'none');
        steps.push('experiment-lab 停止リクエスト（Ready タイムアウト後の復帰）を送信しました');
        policyStore.appendEvent('復帰: experiment-lab を停止すべく POST を試行しました');
      } catch {
        steps.push('experiment-lab 停止の試行が失敗しました（手動確認）');
        policyStore.appendEvent('復帰警告: experiment-lab stop が失敗した可能性があります');
      }
    }
  }

  const changedBack = policyStore.setPolicyMode(ctx.rollbackPolicyMode);
  const policyJa = `${policyLabelJa(ctx.rollbackPolicyMode)} にロールバックしました`;
  if (changedBack) {
    steps.push(policyJa);
    policyStore.appendEvent(`運用モードを ${policyLabelJa(ctx.rollbackPolicyMode)} へ戻しました（Safe rollback）`);
  }

  const policyRestoredJa = `${policyLabelJa(ctx.rollbackPolicyMode)} に戻しました（自動復帰の限界があるため Control Targets と Runbook で最終状態を確認してください）`;

  return {
    attempted: true,
    policyRestoredJa,
    ...(steps.length > 0 ? { workloadStepsJa: steps } : {}),
  };
}
