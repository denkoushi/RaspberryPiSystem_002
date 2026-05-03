import { createHash } from 'node:crypto';

import type { DgxPolicyMode } from './dgx-resource.policy-store.js';
import { policyLabelJa } from './dgx-resource.policy-profile.js';
import { planWorkloadAdjustmentsBeforePolicyChange, type WorkloadAdjustmentStep } from './dgx-resource.policy-arbitrator.js';
import { buildPostPolicyOrchestrationSteps } from './dgx-resource.scenario-post-policy.js';

/** GUI の複合運用ガイド用シナリオ（ユーザー向け日本語説明とは別レイヤー） */
export type DgxOrchestrationScenarioId =
  | 'business_to_private'
  | 'private_to_business'
  | 'business_to_experiment'
  | 'experiment_to_business';

/** ルート検証や UI で列挙するための固定リスト（型との整合チェック込み） */
export const DGX_ORCHESTRATION_SCENARIO_IDS = [
  'business_to_private',
  'private_to_business',
  'business_to_experiment',
  'experiment_to_business',
] as const satisfies readonly DgxOrchestrationScenarioId[];

export type ScenarioPlanFingerprintInputs = {
  scenarioId: DgxOrchestrationScenarioId;
  targetPolicyMode: DgxPolicyMode;
  applyWorkloadChanges: boolean;
  /** business_to_private かつ comfy hook 両方設定時のみ true（適用順序込みで指紋に含める） */
  postPolicyPrivateComfyStart: boolean;
  comfyRuntimeConfigured: boolean;
  experimentLabRuntimeConfigured: boolean;
  gatewayRuntimeConfigured: boolean;
};

export type ScenarioWorkloadStepPreview = {
  kind: 'workload';
  order: number;
  targetId: WorkloadAdjustmentStep['targetId'];
  action: WorkloadAdjustmentStep['action'];
  summaryJa: string;
};

export type ScenarioPolicyStepPreview = {
  kind: 'policy';
  order: number;
  policyMode: DgxPolicyMode;
  summaryJa: string;
};

export type ScenarioStepPreview = ScenarioWorkloadStepPreview | ScenarioPolicyStepPreview;

export type ScenarioPlanPreview = {
  scenarioId: DgxOrchestrationScenarioId;
  targetPolicyMode: DgxPolicyMode;
  applyWorkloadChanges: boolean;
  planFingerprint: string;
  steps: ScenarioStepPreview[];
  warnings: string[];
};

function mapScenarioToPolicyInputs(scenarioId: DgxOrchestrationScenarioId): {
  targetPolicyMode: DgxPolicyMode;
  applyWorkloadChanges: boolean;
} {
  switch (scenarioId) {
    case 'business_to_private':
      return { targetPolicyMode: 'private_ok', applyWorkloadChanges: false };
    case 'private_to_business':
    case 'experiment_to_business':
      return { targetPolicyMode: 'business_first', applyWorkloadChanges: true };
    case 'business_to_experiment':
      return { targetPolicyMode: 'experiment_first', applyWorkloadChanges: true };
    default: {
      const _exhaustive: never = scenarioId;
      return _exhaustive;
    }
  }
}

export function resolveScenarioPolicyIntent(scenarioId: DgxOrchestrationScenarioId): {
  targetPolicyMode: DgxPolicyMode;
  applyWorkloadChanges: boolean;
} {
  return mapScenarioToPolicyInputs(scenarioId);
}

export function buildScenarioFingerprintPayload(input: ScenarioPlanFingerprintInputs): string {
  const normalized = {
    scenarioId: input.scenarioId,
    policyMode: input.targetPolicyMode,
    applyWorkloadChanges: input.applyWorkloadChanges,
    postPolicyPrivateComfyStart: input.postPolicyPrivateComfyStart,
    capabilities: {
      comfyRuntimeConfigured: input.comfyRuntimeConfigured,
      experimentLabRuntimeConfigured: input.experimentLabRuntimeConfigured,
      gatewayRuntimeConfigured: input.gatewayRuntimeConfigured,
    },
  };
  return JSON.stringify(normalized);
}

export function computeScenarioPlanFingerprint(input: ScenarioPlanFingerprintInputs): string {
  return createHash('sha256').update(buildScenarioFingerprintPayload(input), 'utf8').digest('hex');
}

/** ワークロード調停と最終モード適用までの順序付きステップ一覧（プレビュー／実行共通） */
export function buildOrchestrationScenarioPreview(input: {
  scenarioId: DgxOrchestrationScenarioId;
  comfyRuntimeConfigured: boolean;
  experimentLabRuntimeConfigured: boolean;
  gatewayRuntimeConfigured: boolean;
  currentPolicyMode: DgxPolicyMode;
  /** Inference が degraded と判定できるときのみ true（呼び出し側で算出） */
  inferenceLooksDegraded: boolean;
  /** private-comfyui が running と判定できるときのみ true */
  comfyLooksRunning: boolean;
}): ScenarioPlanPreview {
  const { scenarioId } = input;
  const { targetPolicyMode, applyWorkloadChanges } = mapScenarioToPolicyInputs(scenarioId);

  const workloadSteps = planWorkloadAdjustmentsBeforePolicyChange({
    nextMode: targetPolicyMode,
    applyWorkloadChanges,
    comfyRuntimeConfigured: input.comfyRuntimeConfigured,
    experimentLabRuntimeConfigured: input.experimentLabRuntimeConfigured,
    gatewayRuntimeConfigured: input.gatewayRuntimeConfigured,
  });

  const postPolicyWorkloadTemplate = buildPostPolicyOrchestrationSteps({
    scenarioId,
    comfyRuntimeConfigured: input.comfyRuntimeConfigured,
  });
  const postPolicyPrivateComfyStart = postPolicyWorkloadTemplate.length > 0;

  const steps: ScenarioStepPreview[] = [];
  let order = 1;

  for (const s of workloadSteps) {
    steps.push({
      kind: 'workload',
      order: order++,
      targetId: s.targetId,
      action: s.action,
      summaryJa: `${s.targetId}: ${s.action === 'start' ? '起動リクエスト' : '停止リクエスト'}（Pi5 POST）`,
    });
  }

  steps.push({
    kind: 'policy',
    order: order++,
    policyMode: targetPolicyMode,
    summaryJa: `運用プロファイルを「${policyLabelJa(targetPolicyMode)}」へ適用します`,
  });

  for (const p of postPolicyWorkloadTemplate) {
    steps.push({
      kind: 'workload',
      order: order++,
      targetId: p.targetId,
      action: p.action,
      summaryJa: p.summaryJa,
    });
  }

  const fingerprint = computeScenarioPlanFingerprint({
    scenarioId,
    targetPolicyMode,
    applyWorkloadChanges,
    postPolicyPrivateComfyStart,
    comfyRuntimeConfigured: input.comfyRuntimeConfigured,
    experimentLabRuntimeConfigured: input.experimentLabRuntimeConfigured,
    gatewayRuntimeConfigured: input.gatewayRuntimeConfigured,
  });

  const warnings: string[] = [];

  if (input.inferenceLooksDegraded && scenarioId !== 'experiment_to_business') {
    warnings.push(
      '推論レイヤ (/v1/models) が degraded です。cold start と GPU 競合（私用 ComfyUI など）が混ざり得ます。復旧しないまま運用すると意図と異なる挙動になることがあります（KB-364 / Runbook）'
    );
  }

  if (scenarioId === 'business_to_private' && !input.comfyRuntimeConfigured) {
    warnings.push(
      '私用 ComfyUI の POST 起停 URL が Pi5 に未設定のため、このガイドは運用モードを私用OKへ変えるのみです（Comfy 自体は手動で立ち上げてください）。運用自動化には URL を両方 Ansible で設定してください'
    );
  }

  if (scenarioId === 'business_to_private' && input.comfyRuntimeConfigured && input.comfyLooksRunning) {
    warnings.push(
      'Comfy が稼働中に見える場合でも business→private で自動停止は行いません。GPU を空けて業務推論へ戻すときは「業務優先への切替」ガイドを使ってください'
    );
  }

  if (scenarioId === 'business_to_experiment' || scenarioId === 'experiment_to_business') {
    warnings.push(
      '実験優先または業務復帰は gateway / Comfy と GPU を共有します。途中失敗した場合でも一部の POST が既に通っていることがあります。イベントログと Runbook を参照してください'
    );
  }

  if (scenarioId === 'experiment_to_business') {
    warnings.push(
      '実験→業務: ワークロード停止後に業務優先モードになります（実験用コンテナ自体の停止は環境側 hook の責務）'
    );
  }

  if (scenarioId === 'private_to_business') {
    warnings.push('私用→業務: 必要に応じて私用 GPU 負荷を止めてから適用すると安全です')
  }

  if (
    scenarioId === 'business_to_private' &&
    input.currentPolicyMode === 'private_ok' &&
    input.comfyRuntimeConfigured
  ) {
    warnings.push(
      '運用モードはすでに私用OKです。続いて私用 ComfyUI の起動リクエストを送ります（hook がべき等でない環境では二重送信に注意してください）'
    );
  }

  if (input.currentPolicyMode === targetPolicyMode && workloadSteps.length === 0 && !postPolicyPrivateComfyStart) {
    warnings.push('すでに同じ運用モードです。ワークロード調停も実行されません')
  }

  return {
    scenarioId,
    targetPolicyMode,
    applyWorkloadChanges,
    planFingerprint: fingerprint,
    steps,
    warnings,
  };
}
