import { ApiError } from '../../../lib/errors.js';

import { policyLabelJa, setPolicyEventMessage } from './dgx-resource.policy-profile.js';
import type { DgxPolicyMode, DgxResourcePolicyStore } from './dgx-resource.policy-store.js';
import type { DgxControlTargetAction, DgxControlTargetId } from './dgx-resource.control-target.types.js';
import { planWorkloadAdjustmentsBeforePolicyChange } from './dgx-resource.policy-arbitrator.js';
import {
  computeScenarioPlanFingerprint,
  resolveScenarioPolicyIntent,
  type DgxOrchestrationScenarioId,
} from './dgx-resource.scenario-planner.js';
import { buildPostPolicyOrchestrationSteps } from './dgx-resource.scenario-post-policy.js';
import type { DgxResourceScenarioExecuteResult, DgxResourceScenarioOutcomeKind } from './dgx-resource.scenario-execute.types.js';

/** ターゲット実行の戻り（service 内の runTargetRuntimeAction と一致） */
export type TargetRuntimeRunResult = { ok: true; message: string };

export type TargetRuntimeEventLogMode = 'default' | 'none';

export type RunTargetRuntimeActionFn = (
  targetId: DgxControlTargetId,
  action: DgxControlTargetAction,
  reason: string | undefined,
  eventLog: TargetRuntimeEventLogMode
) => Promise<TargetRuntimeRunResult>;

export type WorkloadCapabilityFlags = {
  comfyRuntimeConfigured: boolean;
  experimentLabRuntimeConfigured: boolean;
  gatewayRuntimeConfigured: boolean;
};

function summarizeControlErrorJa(error: unknown): string {
  if (typeof error === 'object' && error != null && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return '予期しないエラーにより停止しました';
}

/**
 * SET_POLICY のワークロード調停→ポリシー適用。イベント記録は policyStore へ。
 */
export async function executeWorkloadTransitionsThenApplyPolicyMode(input: {
  mode: DgxPolicyMode;
  applyWorkloadChanges: boolean;
  workloadTraceReason: string;
  capability: WorkloadCapabilityFlags;
  runTargetRuntimeAction: RunTargetRuntimeActionFn;
  policyStore: DgxResourcePolicyStore;
}): Promise<{ ok: true; message: string }> {
  const { mode, applyWorkloadChanges, workloadTraceReason, capability, runTargetRuntimeAction, policyStore } = input;

  const plan = planWorkloadAdjustmentsBeforePolicyChange({
    nextMode: mode,
    applyWorkloadChanges,
    comfyRuntimeConfigured: capability.comfyRuntimeConfigured,
    experimentLabRuntimeConfigured: capability.experimentLabRuntimeConfigured,
    gatewayRuntimeConfigured: capability.gatewayRuntimeConfigured,
  });

  for (const step of plan) {
    await runTargetRuntimeAction(step.targetId, step.action, workloadTraceReason, 'none');
    policyStore.appendEvent(step.eventMessageJa);
  }

  const changed = policyStore.setPolicyMode(mode);
  if (!changed) {
    if (plan.length > 0) {
      return {
        ok: true,
        message: `${policyLabelJa(mode)}モードのまま。ワークロード調整のみ実行しました`,
      };
    }
    return { ok: true, message: `${policyLabelJa(mode)}モードのままです` };
  }
  const msg = setPolicyEventMessage(mode);
  policyStore.appendEvent(msg);
  return { ok: true, message: msg };
}

/**
 * オーケストレーションシナリオの確定実行（指紋照合・ワークロード順序・ポリシー適用・部分失敗記録）
 */
export async function executeOrchestrationScenarioTransition(input: {
  scenarioId: DgxOrchestrationScenarioId;
  planFingerprint: string;
  capability: WorkloadCapabilityFlags;
  runTargetRuntimeAction: RunTargetRuntimeActionFn;
  policyStore: DgxResourcePolicyStore;
}): Promise<{
  ok: true;
  message: string;
  scenarioExecute: DgxResourceScenarioExecuteResult;
}> {
  const { scenarioId, planFingerprint, capability, runTargetRuntimeAction, policyStore } = input;
  const intent = resolveScenarioPolicyIntent(scenarioId);

  const postPolicyPlan = buildPostPolicyOrchestrationSteps({
    scenarioId,
    comfyRuntimeConfigured: capability.comfyRuntimeConfigured,
  });

  const recomputedFingerprint = computeScenarioPlanFingerprint({
    scenarioId,
    targetPolicyMode: intent.targetPolicyMode,
    applyWorkloadChanges: intent.applyWorkloadChanges,
    postPolicyPrivateComfyStart: postPolicyPlan.length > 0,
    comfyRuntimeConfigured: capability.comfyRuntimeConfigured,
    experimentLabRuntimeConfigured: capability.experimentLabRuntimeConfigured,
    gatewayRuntimeConfigured: capability.gatewayRuntimeConfigured,
  });

  if (recomputedFingerprint !== planFingerprint.trim()) {
    throw new ApiError(
      409,
      'プレビュー後に起停設定や計画前提が変わったかプレビューが古くなった可能性があります（指紋不一致）。もう一度プレビューを取得してください。',
      { scenarioId, expectedPrefix: recomputedFingerprint.slice(0, 12) },
      'DGX_SCENARIO_PLAN_STALE'
    );
  }

  const plan = planWorkloadAdjustmentsBeforePolicyChange({
    nextMode: intent.targetPolicyMode,
    applyWorkloadChanges: intent.applyWorkloadChanges,
    comfyRuntimeConfigured: capability.comfyRuntimeConfigured,
    experimentLabRuntimeConfigured: capability.experimentLabRuntimeConfigured,
    gatewayRuntimeConfigured: capability.gatewayRuntimeConfigured,
  });

  const completedStepOrders: number[] = [];

  policyStore.clearScenarioFailure();

  /** プレビューの step order と順序対応させるカウンタ */
  let stepOrderSeq = 1;
  try {
    for (const step of plan) {
      await runTargetRuntimeAction(step.targetId, step.action, 'scenario_guide', 'none');
      policyStore.appendEvent(step.eventMessageJa);
      completedStepOrders.push(stepOrderSeq++);
    }

    const changed = policyStore.setPolicyMode(intent.targetPolicyMode);
    completedStepOrders.push(stepOrderSeq++);

    let outcomeKind: DgxResourceScenarioOutcomeKind = 'success';
    const msgPieces: string[] = [];

    if (changed) {
      const pm = setPolicyEventMessage(intent.targetPolicyMode);
      policyStore.appendEvent(pm);
      msgPieces.push(pm);
    } else if (plan.length > 0) {
      msgPieces.push(
        `${policyLabelJa(intent.targetPolicyMode)}モードのまま。ワークロード調停のみ適用しました（ガイド）`
      );
    }

    let ranPostSteps = false;
    for (const ps of postPolicyPlan) {
      await runTargetRuntimeAction(ps.targetId, ps.action, 'scenario_guide', 'none');
      policyStore.appendEvent(ps.eventMessageJa);
      completedStepOrders.push(stepOrderSeq++);
      ranPostSteps = true;
    }

    let msg: string;
    if (!changed && plan.length === 0 && !ranPostSteps) {
      outcomeKind = 'noop';
      msgPieces.length = 0;
      msgPieces.push(`${policyLabelJa(intent.targetPolicyMode)}モードのままです（ガイド）`);
      msg = msgPieces.join(' ');
    } else if (ranPostSteps) {
      if (changed || plan.length > 0) {
        msgPieces.push('続いて私用 ComfyUI の起動リクエストを送信しました（ガイド）');
      } else {
        msgPieces.push('私用OKモードです。私用 ComfyUI の起動リクエストを送信しました（ガイド）');
      }
      msg = msgPieces.join(' ');
    } else {
      msg = msgPieces.filter((s) => s.length > 0).join(' ') || setPolicyEventMessage(intent.targetPolicyMode);
    }

    policyStore.clearScenarioFailure();

    const scenarioExecute: DgxResourceScenarioExecuteResult = {
      scenarioId,
      success: true,
      completedStepOrders,
      completedPolicyApplied: changed,
      outcomeKind,
      recommendedNextJa:
        `/v1/models と Control Targets が期待どおりになるまで数十秒〜数十分かかることがあります（blue cold start 等）。`,
    };

    return {
      ok: true,
      message: msg,
      scenarioExecute,
    };
  } catch (error: unknown) {
    const brief = summarizeControlErrorJa(error);
    policyStore.recordScenarioFailure({
      scenarioId,
      message: brief,
      completedStepOrders,
    });
    policyStore.appendEvent(`ガイド ${scenarioId} が途中停止: ${brief}`);
    const scenarioExecute: DgxResourceScenarioExecuteResult = {
      scenarioId,
      success: false,
      completedStepOrders,
      completedPolicyApplied: false,
      outcomeKind: 'partial_failure',
      failureMessageJa: brief,
      recommendedNextJa:
        'Control Targets とイベントログを確認してください。環境側で一部 POST が通っていることがあるため、そのまま単発操作での復旧や Runbook / KB-364 に従ってください',
    };
    return {
      ok: true,
      message: brief,
      scenarioExecute,
    };
  }
}

export { summarizeControlErrorJa };
