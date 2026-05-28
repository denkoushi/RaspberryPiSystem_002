import type { OverviewProbeBundle } from './dgx-resource.control-targets.builder.js';
import type { DgxOrchestrationScenarioId } from './dgx-resource.scenario-planner.js';

import type { TargetRuntimeDispatchFn } from './dgx-resource.target-runtime-fn.js';

import type { DgxScenarioReadinessCheckJa } from './dgx-resource.scenario-execute.types.js';

/** Overview snapshot の取得（ポーリング毎）。 */
export type CollectOverviewProbeBundleFn = () => Promise<OverviewProbeBundle>;

export type ScenarioReadinessTargetSpec = {
  /** `/v1/models` が業務 Inference として利用可能になるまで待つ（gateway + admin 構成前提） */
  requireInferenceBusiness: boolean;
  /** Comfy が GET health で running と判定できるまで（post-policy で起動試行済みである前提が多い） */
  requirePrivateComfyHealthy: boolean;
  /** experiment の GET health が reachable になるまで */
  requireExperimentLabHealthy: boolean;
  /** on_demand かつゲートウェイ起停構築時、未 Ready だと `/start` を 1 回だけ試みる（幂等運用前提） */
  allowGatewayStartRemediation: boolean;
};

const READINESS_OK_STREAK = 2;

function inferenceBusinessReady(bundle: OverviewProbeBundle): {
  satisfied: boolean;
  detailJa: string;
} {
  const gw = bundle.gatewayStatus;
  if (!gw.configured) {
    return { satisfied: false, detailJa: 'Gateway が構成されていません（admin LocalLLM 設定が必要）' };
  }
  if (!gw.health.ok) {
    const sc = gw.health.statusCode;
    const tail = typeof sc === 'number' ? `（HTTP ${sc}）` : '';
    return { satisfied: false, detailJa: `ゲートウェイ health が準備完了ではありません${tail}` };
  }
  const ac = bundle.adminCfg;
  if (!ac.configured || !ac.baseUrl || !ac.sharedToken) {
    return { satisfied: false, detailJa: 'Inference モデル確認のため admin baseUrl と sharedToken が必要です' };
  }
  if (bundle.modelsProbe.ok) {
    const hint = bundle.modelsProbe.inferenceHint ? `（${bundle.modelsProbe.inferenceHint}）` : '';
    return { satisfied: true, detailJa: `system-prod /v1/models OK${hint}` };
  }
  const sc = bundle.modelsProbe.statusCode;
  const tail = typeof sc === 'number' ? `HTTP ${sc}` : 'モデル一覧が取得できません';
  return { satisfied: false, detailJa: `Inference /v1/models 未準備: ${tail}` };
}

function businessModelProfileActiveReady(
  bundle: OverviewProbeBundle,
  selectedProfileId: string
): { satisfied: boolean; detailJa: string } {
  const mp = bundle.modelProfiles;
  if (mp.status !== 'ok') {
    return {
      satisfied: false,
      detailJa:
        mp.errorMessageJa ??
        'DGX model profiles API が利用できないため、選択モデルの active 一致を確認できません',
    };
  }
  const selected = mp.available.find((p) => p.id === selectedProfileId);
  if (!selected) {
    return {
      satisfied: false,
      detailJa: `選択した modelProfileId が allowlist にありません: ${selectedProfileId}`,
    };
  }
  if (mp.activeProfileId === null) {
    return {
      satisfied: false,
      detailJa: `DGX の active profile が未設定です（選択: ${selected.displayNameJa}）。profile 指定の /start 反映を待っています`,
    };
  }
  if (mp.activeProfileId !== selectedProfileId) {
    const activeProfile = mp.available.find((p) => p.id === mp.activeProfileId);
    const activeLabel = activeProfile?.displayNameJa ?? mp.activeProfileId;
    return {
      satisfied: false,
      detailJa: `active profile が選択と不一致です（選択: ${selected.displayNameJa}、実際: ${activeLabel}）`,
    };
  }
  return {
    satisfied: true,
    detailJa: `選択モデル ${selected.displayNameJa} が DGX active profile と一致しています`,
  };
}

function businessModelProfileBackendReady(
  bundle: OverviewProbeBundle,
  selectedProfileId: string
): { satisfied: boolean; detailJa: string } {
  const mp = bundle.modelProfiles;
  const selected = mp.available.find((p) => p.id === selectedProfileId);
  if (!selected) {
    return { satisfied: false, detailJa: `選択した modelProfileId が allowlist にありません: ${selectedProfileId}` };
  }
  if (mp.activeProfileId !== selectedProfileId) {
    return {
      satisfied: false,
      detailJa: 'active profile が選択と一致していないため、backend 整合を確認できません',
    };
  }
  const stateBackend = mp.activeStateBackend;
  if (stateBackend && stateBackend !== selected.backend) {
    return {
      satisfied: false,
      detailJa: `active backend（${stateBackend}）が選択 profile の backend（${selected.backend}）と不一致です`,
    };
  }
  if (stateBackend) {
    return {
      satisfied: true,
      detailJa: `active backend は選択 profile と一致しています（${stateBackend}）`,
    };
  }
  return {
    satisfied: true,
    detailJa: `active profile 一致（backend: ${selected.backend}。state.backend 未報告のため allowlist を参照）`,
  };
}

function privateComfyHealthy(bundle: OverviewProbeBundle): { satisfied: boolean; detailJa: string } {
  if (!bundle.comfyConfigured) {
    return { satisfied: false, detailJa: 'DGX_RESOURCE_COMFYUI_HEALTH_URL が未設定のため Comfy Ready を確認できません' };
  }
  if (bundle.comfyReachable) {
    return { satisfied: true, detailJa: 'Comfy ヘルス GET が応答しています' };
  }
  return { satisfied: false, detailJa: 'Comfy ヘルスがまだ準備できていません（起動には数十秒〜要する場合があります）' };
}

function experimentLabHealthy(bundle: OverviewProbeBundle): { satisfied: boolean; detailJa: string } {
  if (!bundle.experimentLabHealthConfigured) {
    return {
      satisfied: false,
      detailJa:
        'DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL が未設定のため実験ラボ Ready を確認できません（Strict Ready に必要）',
    };
  }
  if (bundle.experimentLabReachable) {
    return { satisfied: true, detailJa: 'experiment-lab ヘルスが応答しています' };
  }
  return {
    satisfied: false,
    detailJa:
      'experiment-lab がまだヘルスに応答していません（コンテナ起動まで数十秒〜、または cold start が必要です）',
  };
}

/**
 * Strict Ready で待つ必要性を決定する。noop（モード変更なし・ワークロードも無し）は呼び出し側で事前にスキップする。
 */
export function buildScenarioReadinessTargetSpec(input: {
  scenarioId: DgxOrchestrationScenarioId;
  /** post-policy が private-comfyui start を含むかどうか */
  willPostPolicyStartComfy: boolean;
  /** post-policy が experiment-lab start を含むかどうか */
  willPostPolicyStartExperimentLab: boolean;
  localLlmRuntimeMode: 'always_on' | 'on_demand';
  gatewayRuntimeConfigured: boolean;
}): ScenarioReadinessTargetSpec {
  const { scenarioId, willPostPolicyStartComfy, willPostPolicyStartExperimentLab, localLlmRuntimeMode, gatewayRuntimeConfigured } = input;

  switch (scenarioId) {
    case 'private_to_business':
    case 'experiment_to_business':
      return {
        requireInferenceBusiness: true,
        requirePrivateComfyHealthy: false,
        requireExperimentLabHealthy: false,
        allowGatewayStartRemediation: localLlmRuntimeMode === 'on_demand' && gatewayRuntimeConfigured,
      };

    case 'business_to_private': {
      if (!willPostPolicyStartComfy) {
        /** 運用モードのみの切替／Comfy の POST が無いときは Inference の再検証のみ（業務状態を再確認）。 */
        return {
          requireInferenceBusiness: false,
          requirePrivateComfyHealthy: false,
          requireExperimentLabHealthy: false,
          allowGatewayStartRemediation: false,
        };
      }
      return {
        requireInferenceBusiness: false,
        requirePrivateComfyHealthy: true,
        requireExperimentLabHealthy: false,
        allowGatewayStartRemediation: false,
      };
    }

    case 'business_to_experiment': {
      if (!willPostPolicyStartExperimentLab) {
        /** 計画のみ policy 適用など（実験起動なし）は追加 Ready チェックしない */
        return {
          requireInferenceBusiness: false,
          requirePrivateComfyHealthy: false,
          requireExperimentLabHealthy: false,
          allowGatewayStartRemediation: false,
        };
      }
      return {
        requireInferenceBusiness: false,
        requirePrivateComfyHealthy: false,
        requireExperimentLabHealthy: true,
        allowGatewayStartRemediation: false,
      };
    }
    default: {
      const _e: never = scenarioId;
      return _e;
    }
  }
}

function noopReadiness(spec: ScenarioReadinessTargetSpec): boolean {
  return (
    !spec.requireInferenceBusiness && !spec.requirePrivateComfyHealthy && !spec.requireExperimentLabHealthy
  );
}

function evaluateReadinessChecks(
  bundle: OverviewProbeBundle,
  spec: ScenarioReadinessTargetSpec,
  options?: { modelProfileId?: string }
): readonly DgxScenarioReadinessCheckJa[] {
  const checks: DgxScenarioReadinessCheckJa[] = [];
  if (spec.requireInferenceBusiness) {
    const r = inferenceBusinessReady(bundle);
    checks.push({
      code: 'inference_business',
      satisfied: r.satisfied,
      detailJa: r.detailJa,
    });
    if (options?.modelProfileId) {
      const active = businessModelProfileActiveReady(bundle, options.modelProfileId);
      checks.push({
        code: 'model_profile_active',
        satisfied: active.satisfied,
        detailJa: active.detailJa,
      });
      const backend = businessModelProfileBackendReady(bundle, options.modelProfileId);
      checks.push({
        code: 'model_profile_backend',
        satisfied: backend.satisfied,
        detailJa: backend.detailJa,
      });
    }
  }
  if (spec.requirePrivateComfyHealthy) {
    const r = privateComfyHealthy(bundle);
    checks.push({ code: 'private_comfy', satisfied: r.satisfied, detailJa: r.detailJa });
  }
  if (spec.requireExperimentLabHealthy) {
    const r = experimentLabHealthy(bundle);
    checks.push({ code: 'experiment_lab', satisfied: r.satisfied, detailJa: r.detailJa });
  }
  return checks;
}

export function allReadinessChecksSatisfied(checks: readonly DgxScenarioReadinessCheckJa[]): boolean {
  return checks.every((c) => c.satisfied);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stable Ready: streak 連続で全チェック達成によりジャンプ検知。
 */
export async function waitScenarioReadiness(input: {
  spec: ScenarioReadinessTargetSpec;
  collectProbeBundle: CollectOverviewProbeBundleFn;
  readinessDeadlineMs: number;
  readinessPollIntervalMs: number;
  runGatewayStartOnceIfNeeded?: TargetRuntimeDispatchFn;
  modelProfileId?: string;
}): Promise<
  | { ok: true; checksJa: readonly DgxScenarioReadinessCheckJa[]; summaryJa: string; gatewayRemediationRequested: boolean }
  | {
      ok: false;
      checksJa: readonly DgxScenarioReadinessCheckJa[];
      failureJa: string;
      gatewayRemediationRequested: boolean;
      timedOut: boolean;
    }
> {
  const {
    spec,
    collectProbeBundle,
    readinessDeadlineMs,
    readinessPollIntervalMs,
    runGatewayStartOnceIfNeeded,
    modelProfileId,
  } = input;

  const readinessOptions = modelProfileId ? { modelProfileId } : undefined;

  const deadline = Date.now() + readinessDeadlineMs;
  let streak = 0;
  let lastChecks: readonly DgxScenarioReadinessCheckJa[] = [];
  let gatewayRemediationRequested = false;

  while (Date.now() < deadline) {
    let bundle = await collectProbeBundle();
    lastChecks = evaluateReadinessChecks(bundle, spec, readinessOptions);

    if (spec.allowGatewayStartRemediation && spec.requireInferenceBusiness && runGatewayStartOnceIfNeeded) {
      const needStart = inferenceBusinessReady(bundle).satisfied === false;
      if (!gatewayRemediationRequested && needStart) {
        await runGatewayStartOnceIfNeeded(
          'system-prod-gateway',
          'start',
          'readiness_remediation',
          'none',
          modelProfileId
        );
        gatewayRemediationRequested = true;
        await sleep(readinessPollIntervalMs);
        bundle = await collectProbeBundle();
        lastChecks = evaluateReadinessChecks(bundle, spec, readinessOptions);
      }
    }

    if (allReadinessChecksSatisfied(lastChecks)) {
      streak += 1;
      if (streak >= READINESS_OK_STREAK) {
        const parts = lastChecks.map((c) => c.detailJa);
        const summaryJa = `Strict Ready を確認しました（${parts.join(' / ')}）。`;
        return { ok: true, checksJa: lastChecks, summaryJa, gatewayRemediationRequested };
      }
    } else {
      streak = 0;
    }

    await sleep(readinessPollIntervalMs);
  }

  const failureJa =
    gatewayRemediationRequested || spec.requireInferenceBusiness
      ? `Ready 確認がタイムアウトしました（許容 ${Math.round(readinessDeadlineMs / 1000)}s）。Inference cold start が長い場合は LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS を運用側で確認してください`
      : 'Ready 確認がタイムアウトしました（環境のヘルスと Runbook を確認してください）。';

  return {
    ok: false,
    checksJa: lastChecks,
    failureJa,
    gatewayRemediationRequested,
    timedOut: true,
  };
}

export function isReadinessNoop(spec: ScenarioReadinessTargetSpec): boolean {
  return noopReadiness(spec);
}
