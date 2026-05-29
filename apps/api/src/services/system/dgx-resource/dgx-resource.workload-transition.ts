import { ApiError } from '../../../lib/errors.js';

import { policyLabelJa, setPolicyEventMessage } from './dgx-resource.policy-profile.js';
import type { DgxPolicyMode, DgxResourcePolicyStore } from './dgx-resource.policy-store.js';
import { planWorkloadAdjustmentsBeforePolicyChange } from './dgx-resource.policy-arbitrator.js';
import {
  computeScenarioPlanFingerprint,
  resolveScenarioPolicyIntent,
  type DgxOrchestrationScenarioId,
} from './dgx-resource.scenario-planner.js';
import { buildPostPolicyOrchestrationSteps } from './dgx-resource.scenario-post-policy.js';
import type { DgxResourceScenarioExecuteResult, DgxResourceScenarioOutcomeKind } from './dgx-resource.scenario-execute.types.js';

import type { CollectOverviewProbeBundleFn } from './dgx-resource.scenario-readiness.js';
import {
  buildScenarioReadinessTargetSpec,
  isReadinessNoop,
  waitScenarioReadiness,
} from './dgx-resource.scenario-readiness.js';
import { performSafeScenarioRollback } from './dgx-resource.scenario-safe-rollback.js';
import { getBusinessProfileIntentStore } from '../../inference/config/business-profile-intent-store.js';

import type { TargetRuntimeDispatchFn, TargetRuntimeEventLogMode } from './dgx-resource.target-runtime-fn.js';

/** ターゲット実行の戻り（サービス側の結果型）。 */
export type TargetRuntimeRunResult = { ok: true; message: string };

/** サービスおよびテストでの既存名前（TargetRuntimeDispatchFn と同一） */
export type RunTargetRuntimeActionFn = TargetRuntimeDispatchFn;

export type { TargetRuntimeEventLogMode };

export type WorkloadCapabilityFlags = {
  comfyRuntimeConfigured: boolean;
  experimentLabRuntimeConfigured: boolean;
  agentContainerRuntimeConfigured: boolean;
  gatewayRuntimeConfigured: boolean;
};

export type OrchestrationReadinessCoordinator = {
  collectProbeBundle: CollectOverviewProbeBundleFn;
  localLlmRuntimeMode: 'always_on' | 'on_demand';
  readinessDeadlineMs: number;
  readinessPollIntervalMs: number;
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
    agentContainerRuntimeConfigured: capability.agentContainerRuntimeConfigured,
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
 * オーケストレーションシナリオの確定実行（指紋照合・ワークロード順序・ポリシー適用・Strict Ready）
 */
export async function executeOrchestrationScenarioTransition(input: {
  scenarioId: DgxOrchestrationScenarioId;
  planFingerprint: string;
  modelProfileId?: string;
  capability: WorkloadCapabilityFlags;
  runTargetRuntimeAction: RunTargetRuntimeActionFn;
  policyStore: DgxResourcePolicyStore;
  readinessCoordinator?: OrchestrationReadinessCoordinator;
}): Promise<{
  ok: true;
  message: string;
  scenarioExecute: DgxResourceScenarioExecuteResult;
}> {
  const { scenarioId, planFingerprint, modelProfileId, capability, runTargetRuntimeAction, policyStore, readinessCoordinator } = input;
  const intent = resolveScenarioPolicyIntent(scenarioId);
  const policyBefore = policyStore.getPolicyMode();

  const postPolicyPlan = buildPostPolicyOrchestrationSteps({
    scenarioId,
    comfyRuntimeConfigured: capability.comfyRuntimeConfigured,
    experimentLabRuntimeConfigured: capability.experimentLabRuntimeConfigured,
  });
  const postPolicyStarts: Array<'private-comfyui' | 'experiment-lab'> = [];
  for (const s of postPolicyPlan) {
    if (s.action !== 'start') continue;
    if (s.targetId === 'private-comfyui' || s.targetId === 'experiment-lab') {
      postPolicyStarts.push(s.targetId);
    }
  }

  const recomputedFingerprint = computeScenarioPlanFingerprint({
    scenarioId,
    targetPolicyMode: intent.targetPolicyMode,
    applyWorkloadChanges: intent.applyWorkloadChanges,
    postPolicyStarts,
    comfyRuntimeConfigured: capability.comfyRuntimeConfigured,
    experimentLabRuntimeConfigured: capability.experimentLabRuntimeConfigured,
    agentContainerRuntimeConfigured: capability.agentContainerRuntimeConfigured,
    gatewayRuntimeConfigured: capability.gatewayRuntimeConfigured,
    ...(modelProfileId ? { modelProfileId } : {}),
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
    agentContainerRuntimeConfigured: capability.agentContainerRuntimeConfigured,
    gatewayRuntimeConfigured: capability.gatewayRuntimeConfigured,
  });

  const completedStepOrders: number[] = [];

  policyStore.clearScenarioFailure();

  /** プレビューの step order と順序対応させるカウンタ */
  let stepOrderSeq = 1;
  try {
    let ranModelProfileStart = false;
    for (const step of plan) {
      await runTargetRuntimeAction(step.targetId, step.action, 'scenario_guide', 'none');
      policyStore.appendEvent(step.eventMessageJa);
      completedStepOrders.push(stepOrderSeq++);
    }

    const changed = policyStore.setPolicyMode(intent.targetPolicyMode);
    completedStepOrders.push(stepOrderSeq++);

    if (modelProfileId && (scenarioId === 'private_to_business' || scenarioId === 'experiment_to_business')) {
      await runTargetRuntimeAction('system-prod-gateway', 'start', 'scenario_guide_model_profile', 'none', modelProfileId);
      policyStore.appendEvent(`業務復帰: 選択モデル ${modelProfileId} のロードを要求しました`);
      completedStepOrders.push(stepOrderSeq++);
      ranModelProfileStart = true;
    }

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
    let noopOrchestration = false;
    if (!changed && plan.length === 0 && !ranPostSteps && !ranModelProfileStart) {
      outcomeKind = 'noop';
      msgPieces.length = 0;
      msgPieces.push(`${policyLabelJa(intent.targetPolicyMode)}モードのままです（ガイド）`);
      msg = msgPieces.join(' ');
      noopOrchestration = true;
    } else if (ranPostSteps) {
      const startedTargets = postPolicyPlan
        .filter((s) => s.action === 'start')
        .map((s) => s.targetId)
        .join(', ');
      msgPieces.push(`続いて ${startedTargets} の起動リクエストを送信しました（ガイド）`);
      msg = msgPieces.join(' ');
    } else {
      msg = msgPieces.filter((s) => s.length > 0).join(' ') || setPolicyEventMessage(intent.targetPolicyMode);
    }

    const willPostPolicyStartComfy = postPolicyPlan.some((p) => p.targetId === 'private-comfyui' && p.action === 'start');
    const willPostPolicyStartExperimentLab = postPolicyPlan.some(
      (p) => p.targetId === 'experiment-lab' && p.action === 'start'
    );

    let readinessChecksJa: DgxResourceScenarioExecuteResult['readinessChecksJa'];
    let readinessSummaryJa: string | undefined;
    let rollback: DgxResourceScenarioExecuteResult['rollback'];

    if (!noopOrchestration && readinessCoordinator) {
      const spec = buildScenarioReadinessTargetSpec({
        scenarioId,
        willPostPolicyStartComfy,
        willPostPolicyStartExperimentLab,
        localLlmRuntimeMode: readinessCoordinator.localLlmRuntimeMode,
        gatewayRuntimeConfigured: capability.gatewayRuntimeConfigured,
      });
      const runGatewayWithEvent: RunTargetRuntimeActionFn =
        spec.allowGatewayStartRemediation && spec.requireInferenceBusiness
          ? async (tid, act, reason, ev, remediationModelProfileId) => {
              const out = await runTargetRuntimeAction(
                tid,
                act,
                reason,
                ev,
                remediationModelProfileId ?? modelProfileId
              );
              if (tid === 'system-prod-gateway' && act === 'start' && reason === 'readiness_remediation') {
                policyStore.appendEvent('Strict Ready 調整: system-prod-gateway に /start を 1 回試行しました');
              }
              return out;
            }
          : runTargetRuntimeAction;

      if (!isReadinessNoop(spec)) {
        policyStore.appendEvent(`Strict Ready: 「${scenarioId}」完了条件の確認を開始します`);

        const wait = await waitScenarioReadiness({
          spec,
          collectProbeBundle: readinessCoordinator.collectProbeBundle,
          readinessDeadlineMs: readinessCoordinator.readinessDeadlineMs,
          readinessPollIntervalMs: readinessCoordinator.readinessPollIntervalMs,
          ...(modelProfileId ? { modelProfileId } : {}),
          runGatewayStartOnceIfNeeded:
            spec.allowGatewayStartRemediation && spec.requireInferenceBusiness ? runGatewayWithEvent : undefined,
        });

        if (!wait.ok) {
          policyStore.recordScenarioFailure({
            scenarioId,
            message: wait.failureJa,
            completedStepOrders,
          });
          policyStore.appendEvent(`Strict Ready がタイムアウトしました: ${wait.failureJa}`);
          rollback = await performSafeScenarioRollback({
            ctx: {
              scenarioId,
              policyBefore,
              rollbackPolicyMode: policyBefore,
              comfyRuntimeConfigured: capability.comfyRuntimeConfigured,
              experimentLabRuntimeConfigured: capability.experimentLabRuntimeConfigured,
              agentContainerRuntimeConfigured: capability.agentContainerRuntimeConfigured,
            },
            policyStore,
            currentPolicyBeforeRollback: policyStore.getPolicyMode(),
            runTargetRuntimeAction,
          });

          const scenarioExecute: DgxResourceScenarioExecuteResult = {
            scenarioId,
            success: false,
            completedStepOrders,
            completedPolicyApplied: false,
            outcomeKind: 'partial_failure',
            readinessChecksJa: wait.checksJa,
            readinessSummaryJa: wait.failureJa,
            rollback,
            failureMessageJa: wait.failureJa,
            recommendedNextJa: [
              rollback?.policyRestoredJa,
              ...(rollback?.workloadStepsJa ?? []),
              'Control Targets・イベントログ・Runbook を確認してください（自動復帰で未解決なら単発 EXECUTE で補修）。',
            ]
              .filter((s): s is string => Boolean(s?.trim()))
              .join(' · '),
          };

          return {
            ok: true,
            message: wait.failureJa,
            scenarioExecute,
          };
        }

        readinessChecksJa = wait.checksJa;
        readinessSummaryJa = wait.summaryJa;
        policyStore.appendEvent(wait.summaryJa);
        msgPieces.push(wait.summaryJa);
        msg = msgPieces.join(' ');
      }
    }

    policyStore.clearScenarioFailure();

    if (
      modelProfileId &&
      (scenarioId === 'private_to_business' || scenarioId === 'experiment_to_business')
    ) {
      getBusinessProfileIntentStore().setFromOrchestration(modelProfileId);
      policyStore.appendEvent(
        `業務モデル意図を更新しました（${modelProfileId}）。以降の photo_label / 要約 / 管理チャット / StackChan の on-demand start がこの profile を参照します（opt-in 時は /start に付与）。`
      );
    }

    const scenarioExecute: DgxResourceScenarioExecuteResult = {
      scenarioId,
      success: true,
      completedStepOrders,
      completedPolicyApplied: changed,
      outcomeKind,
      readinessChecksJa,
      ...(readinessSummaryJa ? { readinessSummaryJa } : {}),
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
