import { ApiError } from '../../../lib/errors.js';
import { env } from '../../../config/env.js';

import { isBusinessFirstSuppressionHintActive, policyLabelJa } from './dgx-resource.policy-profile.js';
import type { DgxPolicyMode, DgxResourceEvent, DgxResourcePolicyStore } from './dgx-resource.policy-store.js';

import type {
  DgxControlTargetAction,
  DgxControlTargetId,
  DgxControlTargetSnapshot,
  DgxUserControlTargetAction,
} from './dgx-resource.control-target.types.js';
import { executeAuxHttpRuntimeStartStop } from './dgx-resource.aux-http-runtime.executor.js';
import { executeGatewayRuntimeStartStop } from './dgx-resource.gateway-runtime.executor.js';
import {
  buildControlTargetSnapshots,
  buildLegacyServiceCards,
  type DgxResourceServiceCard,
  type OverviewProbeBundle,
} from './dgx-resource.control-targets.builder.js';
import {
  buildOrchestrationScenarioPreview,
  type DgxOrchestrationScenarioId,
  type ScenarioPlanPreview,
} from './dgx-resource.scenario-planner.js';
import { buildDgxResourceMonitoringOverview, type DgxResourceMonitoringSummary } from './dgx-resource.monitoring-overview.js';
import { buildDgxResourceOperatorConsole, type DgxResourceOperatorConsole } from './dgx-resource.operator-overview.js';
import {
  assertModelProfileEligibleForBusinessReturn,
  assertModelProfileKnownAndStartable,
  assertModelProfileSelectionAllowed,
  fetchDgxModelProfilesOverview,
  type DgxModelProfilesOverview,
  type DgxResourceSharedState,
} from './dgx-resource.model-profiles.js';
import {
  executeOrchestrationScenarioTransition,
  executeWorkloadTransitionsThenApplyPolicyMode,
} from './dgx-resource.workload-transition.js';
import type { DgxResourceScenarioExecuteResult } from './dgx-resource.scenario-execute.types.js';
import { fetchJsonMetrics, probeHttpGet, probeHttpOk, probeV1Models } from './dgx-resource.probes.js';
import { buildDgxResourceRuntimeSummary, type DgxResourceRuntimeSummary } from './dgx-resource.runtime-summary.js';

import type { LocalLlmGateway, LocalLlmRuntimeConfig } from '../local-llm-proxy.service.js';

export type { DgxResourceServiceCard };

/** @deprecated 互換のため re-export。新規は control-target.types を参照 */
export type DgxServiceStatusKind = import('./dgx-resource.control-target.types.js').DgxServiceStatusKind;

export type DgxResourceKpis = {
  gpuUtilPct: number | null;
  unifiedMemoryUsedGiB: number | null;
  unifiedMemoryTotalGiB: number | null;
  freeMemoryGiB: number | null;
  /** グラフ配色などはこちらで分岐（表示ラベル文字列依存を避ける） */
  policyMode: DgxPolicyMode;
  policyLabel: string;
};

export type { DgxResourceScenarioExecuteResult } from './dgx-resource.scenario-execute.types.js';

/** API POST /system/dgx-resource/actions の戻り（後方互換: message と ok は常に設定） */
export type DgxResourceActionResult = {
  ok: true;
  message: string;
  scenarioPreview?: ScenarioPlanPreview;
  scenarioExecute?: DgxResourceScenarioExecuteResult;
};

export type DgxSparkHostOverview = {
  configured: boolean;
  probedAt: string;
  status: DgxServiceStatusKind;
  probeUrl?: string;
  httpStatus?: number;
  errorBrief?: string;
};

export type DgxResourceWarmWindow = {
  enabled: boolean;
  timeZone?: string;
  startHourInclusive?: number;
  endHourExclusive?: number;
};

export type DgxResourceOverview = {
  generatedAt: string;
  kpis: DgxResourceKpis;
  policy: {
    mode: DgxPolicyMode;
    /** ロールバック用。未切替または同一モード再設定のみのとき null */
    previousMode: DgxPolicyMode | null;
    comfyStartBlockedHint: boolean;
  };
  runtime: {
    localLlmMode: 'always_on' | 'on_demand';
    runtimeControlConfigured: boolean;
    warmWindow: DgxResourceWarmWindow;
  };
  optionalProbes: {
    metricsConfigured: boolean;
    comfyHealthConfigured: boolean;
    embeddingHealthConfigured: boolean;
    sparkHostConfigured: boolean;
    comfyRuntimeControlConfigured: boolean;
    experimentLabHealthConfigured: boolean;
    experimentLabRuntimeControlConfigured: boolean;
    agentContainerHealthConfigured: boolean;
    agentContainerRuntimeControlConfigured: boolean;
  };
  /** 標準 Control Target 一覧（監視・許可操作の正規モデル） */
  targets: DgxControlTargetSnapshot[];
  sparkHost: DgxSparkHostOverview;
  /** @deprecated 後方互換。UI は targets を優先 */
  services: DgxResourceServiceCard[];
  notes: string[];
  /** Phase4 以降の構造化運用ヒント・アラート */
  monitoring: DgxResourceMonitoringSummary;
  /** 運用者向け表示モデル（targets[] を置き換えない） */
  operator: DgxResourceOperatorConsole;
  /** DGX 正本の業務復帰 LocalLLM モデルプロファイル */
  modelProfiles: DgxModelProfilesOverview;
  /** DGX gateway 共有 owner/state。Private Pi5 直通 route と業務 Pi5 UI の共通状態 */
  resourceState: DgxResourceSharedState | null;
  /** メトリクス KPI とは分離した実行時状態（モデル・backend・Ready ヒント） */
  runtimeSummary: DgxResourceRuntimeSummary;
};

export type { DgxResourceRuntimeSummary };

export type DgxResourceActionBody =
  | { type: 'LOCAL_LLM_START'; reason?: string }
  | { type: 'LOCAL_LLM_STOP'; reason?: string }
  | { type: 'START_MODEL_PROFILE'; modelProfileId: string; reason?: string }
  | { type: 'SET_POLICY'; policyMode: DgxPolicyMode; applyWorkloadChanges?: boolean }
  | {
      type: 'EXECUTE_TARGET_ACTION';
      targetId: DgxControlTargetId;
      action: DgxUserControlTargetAction;
      reason?: string;
    }
  | { type: 'PREVIEW_ORCHESTRATION_SCENARIO'; scenarioId: DgxOrchestrationScenarioId; modelProfileId?: string }
  | {
      type: 'EXECUTE_ORCHESTRATION_SCENARIO';
      scenarioId: DgxOrchestrationScenarioId;
      planFingerprint: string;
      confirmed: true;
      modelProfileId?: string;
    };

export type DgxResourceServicePort = {
  getOverview: () => Promise<DgxResourceOverview>;
  executeAction: (body: DgxResourceActionBody) => Promise<DgxResourceActionResult>;
  getEvents: (limit: number) => DgxResourceEvent[];
};

export type DgxResourceServiceDeps = {
  fetchImpl: typeof fetch;
  localLlmGateway: LocalLlmGateway;
  getAdminLocalLlmRuntimeConfig: () => LocalLlmRuntimeConfig;
  policyStore: DgxResourcePolicyStore;
  probeTimeoutMs: number;
  metricsUrl?: string;
  comfyHealthUrl?: string;
  embeddingHealthUrl?: string;
  /** DGX Spark ホスト疎通（任意） */
  sparkHostStatusUrl?: string;
};

function ensureAuxRuntimeAction(action: DgxControlTargetAction): DgxUserControlTargetAction {
  if (action === 'stop_force') {
    throw new ApiError(
      400,
      'この制御ターゲットでは強制停止を実行できません',
      { action },
      'DGX_TARGET_ACTION_NOT_SUPPORTED'
    );
  }
  return action;
}

function buildWarmWindow(): DgxResourceWarmWindow {
  if (!env.LOCAL_LLM_RUNTIME_WARM_WINDOW_ENABLED) {
    return { enabled: false };
  }
  return {
    enabled: true,
    timeZone: env.LOCAL_LLM_RUNTIME_WARM_WINDOW_TIMEZONE,
    startHourInclusive: env.LOCAL_LLM_RUNTIME_WARM_WINDOW_START_HOUR,
    endHourExclusive: env.LOCAL_LLM_RUNTIME_WARM_WINDOW_END_HOUR,
  };
}

function gatewayRuntimeControlConfiguredFlag(): boolean {
  return (
    Boolean(env.LOCAL_LLM_RUNTIME_CONTROL_START_URL?.trim() && env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?.trim()) &&
    env.LOCAL_LLM_RUNTIME_MODE === 'on_demand'
  );
}

function readComfyRuntimeEndpoints(): { startUrl: string; stopUrl: string; token?: string } | undefined {
  const s = env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL?.trim();
  const sp = env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL?.trim();
  if (!s || !sp) return undefined;
  const t = env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_CONTROL_TOKEN?.trim();
  return { startUrl: s, stopUrl: sp, ...(t ? { token: t } : {}) };
}

function readExperimentLabRuntimeEndpoints(): { startUrl: string; stopUrl: string; token?: string } | undefined {
  const s = env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL?.trim();
  const sp = env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_STOP_URL?.trim();
  if (!s || !sp) return undefined;
  const t = env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_CONTROL_TOKEN?.trim();
  return { startUrl: s, stopUrl: sp, ...(t ? { token: t } : {}) };
}

function readAgentContainerRuntimeEndpoints(): { startUrl: string; stopUrl: string; token?: string } | undefined {
  const s = env.DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_START_URL?.trim();
  const sp = env.DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_STOP_URL?.trim();
  if (!s || !sp) return undefined;
  const t = env.DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_CONTROL_TOKEN?.trim();
  return { startUrl: s, stopUrl: sp, ...(t ? { token: t } : {}) };
}

function comfyRuntimeControlConfigured(): boolean {
  return readComfyRuntimeEndpoints() !== undefined;
}

function experimentLabRuntimeControlConfigured(): boolean {
  return readExperimentLabRuntimeEndpoints() !== undefined;
}

function agentContainerRuntimeControlConfigured(): boolean {
  return readAgentContainerRuntimeEndpoints() !== undefined;
}

function inferenceHeuristics(bundle: OverviewProbeBundle): {
  inferenceLooksDegraded: boolean;
  comfyLooksRunning: boolean;
} {
  const gatewayRunning = bundle.gatewayStatus.configured && bundle.gatewayStatus.health.ok;
  const inferenceLooksDegraded = Boolean(gatewayRunning && !bundle.modelsProbe.ok && bundle.gatewayStatus.configured);
  const comfyLooksRunning = Boolean(bundle.comfyConfigured && bundle.comfyReachable);
  return { inferenceLooksDegraded, comfyLooksRunning };
}

type TargetRuntimeEventLogMode = 'default' | 'none';

export function createDgxResourceService(deps: DgxResourceServiceDeps): DgxResourceServicePort {
  const auxTimeoutMs = env.DGX_RESOURCE_AUX_RUNTIME_REQUEST_TIMEOUT_MS;
  const experimentLabHealthUrl = env.DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL?.trim() || undefined;
  const agentContainerHealthUrl = env.DGX_RESOURCE_AGENT_CONTAINER_HEALTH_URL?.trim() || undefined;
  const collectOverviewProbeBundle = async (): Promise<{
    generatedAt: string;
    policyMode: DgxPolicyMode;
    previousMode: DgxPolicyMode | null;
    adminCfg: LocalLlmRuntimeConfig;
    gatewayStatus: Awaited<ReturnType<LocalLlmGateway['getStatus']>>;
    bundle: OverviewProbeBundle;
    runtimeControlConfigured: boolean;
    comfyRtCfg: boolean;
    expLabRtCfg: boolean;
    metricsConfigured: boolean;
    comfyConfigured: boolean;
    embeddingConfigured: boolean;
    sparkConfigured: boolean;
    experimentLabHealthConfigured: boolean;
    experimentLabProbeUrl: string | undefined;
    agentContainerHealthConfigured: boolean;
    agentContainerProbeUrl: string | undefined;
    agentRtCfg: boolean;
    sparkHost: DgxSparkHostOverview;
    modelProfiles: DgxModelProfilesOverview;
    notes: string[];
  }> => {
    const generatedAt = new Date().toISOString();
    const policyMode = deps.policyStore.getPolicyMode();
    const previousMode = deps.policyStore.getPreviousPolicyMode();

    const adminCfg = deps.getAdminLocalLlmRuntimeConfig();
    const gatewayStatus = await deps.localLlmGateway.getStatus();

    let modelsProbe: OverviewProbeBundle['modelsProbe'] = { ok: false };
    if (
      gatewayStatus.configured &&
      adminCfg.configured &&
      adminCfg.baseUrl &&
      adminCfg.sharedToken &&
      gatewayStatus.health.ok
    ) {
      modelsProbe = await probeV1Models(adminCfg.baseUrl, adminCfg.sharedToken, deps.fetchImpl, deps.probeTimeoutMs);
    }

    const modelProfiles = await fetchDgxModelProfilesOverview({
      baseUrl: adminCfg.baseUrl,
      sharedToken: adminCfg.sharedToken,
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.probeTimeoutMs,
    });

    const metricsConfigured = Boolean(deps.metricsUrl?.trim());
    const metricsFallbackCandidates =
      !metricsConfigured && adminCfg.baseUrl
        ? ([
            {
              url: new URL('/system/metrics', adminCfg.baseUrl).toString(),
              headers: adminCfg.sharedToken ? ({ 'X-LLM-Token': adminCfg.sharedToken } as const) : undefined,
            },
            {
              url: new URL('/v1/system/metrics', adminCfg.baseUrl).toString(),
              headers: adminCfg.sharedToken ? ({ 'X-LLM-Token': adminCfg.sharedToken } as const) : undefined,
            },
          ] as const)
        : [];
    const metricsProbeCandidates = metricsConfigured
      ? ([{ url: deps.metricsUrl!, headers: undefined as Record<string, string> | undefined }] as const)
      : metricsFallbackCandidates;
    let metricsPayload: Awaited<ReturnType<typeof fetchJsonMetrics>> = undefined;
    for (const candidate of metricsProbeCandidates) {
      metricsPayload = await fetchJsonMetrics(candidate.url, deps.fetchImpl, deps.probeTimeoutMs, candidate.headers);
      if (metricsPayload) break;
    }
    const comfyConfigured = Boolean(deps.comfyHealthUrl?.trim());
    let comfyReachable = false;
    if (comfyConfigured) {
      comfyReachable = await probeHttpOk(deps.comfyHealthUrl!, deps.fetchImpl, deps.probeTimeoutMs);
    }

    const embeddingConfigured = Boolean(deps.embeddingHealthUrl?.trim());
    let embeddingReachable = false;
    let embeddingProbeDisplay: string | undefined;
    if (embeddingConfigured && adminCfg.sharedToken && adminCfg.baseUrl) {
      const raw = deps.embeddingHealthUrl!;
      embeddingProbeDisplay = raw;
      const embUrl =
        raw.startsWith('http://') || raw.startsWith('https://')
          ? raw
          : new URL(raw, adminCfg.baseUrl).toString();
      embeddingReachable = await probeHttpOk(embUrl, deps.fetchImpl, deps.probeTimeoutMs, {
        'X-LLM-Token': adminCfg.sharedToken,
      });
    }

    const explicitSparkUrl = deps.sparkHostStatusUrl?.trim();
    const fallbackSparkUrl =
      !explicitSparkUrl && adminCfg.baseUrl ? new URL('/healthz', adminCfg.baseUrl).toString() : undefined;
    const sparkUrl = explicitSparkUrl || fallbackSparkUrl;
    const sparkConfigured = Boolean(sparkUrl);
    let sparkProbe: { ok: boolean; statusCode?: number; errorBrief?: string } = { ok: false };
    if (sparkConfigured) {
      sparkProbe = await probeHttpGet(sparkUrl!, deps.fetchImpl, deps.probeTimeoutMs);
    }

    const experimentLabHealthConfigured = Boolean(env.DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL?.trim());
    let experimentLabReachable = false;
    const experimentLabProbeUrl = env.DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL?.trim();
    if (experimentLabHealthConfigured && experimentLabProbeUrl) {
      experimentLabReachable = await probeHttpOk(experimentLabProbeUrl, deps.fetchImpl, deps.probeTimeoutMs);
    }

    const agentContainerHealthConfigured = Boolean(env.DGX_RESOURCE_AGENT_CONTAINER_HEALTH_URL?.trim());
    let agentContainerReachable = false;
    const agentContainerProbeUrl = env.DGX_RESOURCE_AGENT_CONTAINER_HEALTH_URL?.trim();
    if (agentContainerHealthConfigured && agentContainerProbeUrl) {
      agentContainerReachable = await probeHttpOk(agentContainerProbeUrl, deps.fetchImpl, deps.probeTimeoutMs);
    }

    const runtimeControlConfigured = gatewayRuntimeControlConfiguredFlag();
    const comfyRtCfg = comfyRuntimeControlConfigured();
    const expLabRtCfg = experimentLabRuntimeControlConfigured();
    const agentRtCfg = agentContainerRuntimeControlConfigured();

    const bundle: OverviewProbeBundle = {
      policyMode,
      adminCfg,
      gatewayStatus,
      modelsProbe,
      modelProfiles,
      metricsConfigured,
      metricsPayload,
      comfyConfigured,
      comfyReachable,
      comfyProbeUrl: deps.comfyHealthUrl ?? undefined,
      embeddingConfigured,
      embeddingReachable,
      embeddingProbeDisplay,
      sparkUrl,
      sparkConfigured,
      sparkProbe,
      runtimeControlConfigured,
      comfyRuntimeControlConfigured: comfyRtCfg,
      experimentLabHealthConfigured,
      experimentLabReachable,
      experimentLabProbeUrl: experimentLabProbeUrl ?? undefined,
      experimentLabRuntimeControlConfigured: expLabRtCfg,
      agentContainerHealthConfigured,
      agentContainerReachable,
      agentContainerProbeUrl: agentContainerProbeUrl ?? undefined,
      agentContainerRuntimeControlConfigured: agentRtCfg,
    };

    const notes: string[] = [];
    if (!metricsConfigured && !metricsPayload) {
      notes.push(
        'GPU/メモリKPI は DGX_RESOURCE_METRICS_URL 未設定かつ、ゲートウェイ /system/metrics または /v1/system/metrics の取得に失敗したため未表示です'
      );
    }
    if (!comfyConfigured) {
      notes.push(
        'ComfyUI は DGX_RESOURCE_COMFYUI_HEALTH_URL 未設定のため疎通のみ表示できません（SSH ポートフォワード運用は Runbook 参照）'
      );
    }
    if (!sparkConfigured) {
      notes.push(
        'DGX Spark ホスト簡易監視は DGX_RESOURCE_SPARK_HOST_STATUS_URL 未設定のため未取得です（メトリクス sidecar の /health 等を Runbook で設定）'
      );
    }
    if (modelProfiles.status === 'degraded' && modelProfiles.errorMessageJa) {
      notes.push(`業務モデルプロファイル取得が degraded です: ${modelProfiles.errorMessageJa}`);
    }

    const cStart = env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL?.trim();
    const cStop = env.DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_STOP_URL?.trim();
    if ((cStart && !cStop) || (!cStart && cStop)) {
      notes.push(
        'DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_START_URL / STOP_URL の片方のみ設定されています（起停は無効）'
      );
    }

    const eStart = env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL?.trim();
    const eStop = env.DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_STOP_URL?.trim();
    if ((eStart && !eStop) || (!eStart && eStop)) {
      notes.push(
        'DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_START_URL / STOP_URL の片方のみ設定されています（起停は無効）'
      );
    }

    const acStart = env.DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_START_URL?.trim();
    const acStop = env.DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_STOP_URL?.trim();
    if ((acStart && !acStop) || (!acStart && acStop)) {
      notes.push(
        'DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_START_URL / STOP_URL の片方のみ設定されています（起停は無効）'
      );
    }

    if (!experimentLabHealthConfigured && expLabRtCfg) {
      notes.push(
        'experiment-lab のヘルス URL 未設定のため状態は不明ですが、起停用 POST は利用できます（任意で DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL）'
      );
    }

    if (!agentContainerHealthConfigured && agentRtCfg) {
      notes.push(
        'agent-container のヘルス URL 未設定のため状態は不明ですが、起停用 POST は利用できます（任意で DGX_RESOURCE_AGENT_CONTAINER_HEALTH_URL）'
      );
    }

    const sparkHost: DgxSparkHostOverview = {
      configured: sparkConfigured,
      probedAt: generatedAt,
      status: sparkConfigured ? (sparkProbe.ok ? 'running' : 'stopped') : 'unknown',
      ...(sparkConfigured && sparkUrl ? { probeUrl: sparkUrl } : {}),
      ...(sparkProbe.statusCode !== undefined ? { httpStatus: sparkProbe.statusCode } : {}),
      ...(sparkProbe.errorBrief && !sparkProbe.ok ? { errorBrief: sparkProbe.errorBrief } : {}),
    };

    return {
      generatedAt,
      policyMode,
      previousMode,
      adminCfg,
      gatewayStatus,
      bundle,
      runtimeControlConfigured,
      comfyRtCfg,
      expLabRtCfg,
      metricsConfigured,
      comfyConfigured,
      embeddingConfigured,
      sparkConfigured,
      experimentLabHealthConfigured,
      experimentLabProbeUrl: experimentLabProbeUrl ?? undefined,
      agentContainerHealthConfigured,
      agentContainerProbeUrl: agentContainerProbeUrl ?? undefined,
      agentRtCfg,
      sparkHost,
      modelProfiles,
      notes,
    };
  };

  const runGatewayRuntimeStartStop = async (
    action: DgxControlTargetAction,
    reason: string | undefined,
    eventLog: TargetRuntimeEventLogMode,
    modelProfileId?: string
  ): Promise<{ ok: true; message: string }> => {
    await executeGatewayRuntimeStartStop(deps, action, reason, modelProfileId);
    if (eventLog === 'default') {
      if (action === 'start') {
        deps.policyStore.appendEvent('LocalLLM ランタイム起動を要求しました');
        return { ok: true, message: '起動リクエストを送信しました（反映まで時間がかかる場合があります）' };
      }
      deps.policyStore.appendEvent(
        action === 'stop_force' ? 'LocalLLM ランタイム強制停止を要求しました' : 'LocalLLM ランタイム停止を要求しました'
      );
      return {
        ok: true,
        message: action === 'stop_force' ? '強制停止リクエストを送信しました' : '停止リクエストを送信しました',
      };
    }
    return {
      ok: true,
      message:
        action === 'start'
          ? 'ゲートウェイ起動リクエストを送信しました'
          : action === 'stop_force'
            ? 'ゲートウェイ強制停止リクエストを送信しました'
            : 'ゲートウェイ停止リクエストを送信しました',
    };
  };

  const runComfyAuxStartStop = async (
    action: DgxControlTargetAction,
    reason: string | undefined,
    eventLog: TargetRuntimeEventLogMode
  ): Promise<{ ok: true; message: string }> => {
    const auxAction = ensureAuxRuntimeAction(action);
    const rt = readComfyRuntimeEndpoints();
    if (!rt) {
      throw new ApiError(
        400,
        'private-comfyui の起停 URL が Pi5 に未設定です（DGX_RESOURCE_PRIVATE_COMFYUI_RUNTIME_* を Runbook 参照）',
        { targetId: 'private-comfyui', action },
        'DGX_TARGET_ACTION_NOT_SUPPORTED'
      );
    }
    await executeAuxHttpRuntimeStartStop(deps, {
      action: auxAction,
      startUrl: rt.startUrl,
      stopUrl: rt.stopUrl,
      timeoutMs: auxTimeoutMs,
      controlToken: rt.token,
      reason,
      errorCodePrefix: 'DGX_COMFY',
    });
    if (eventLog === 'default') {
      deps.policyStore.appendEvent(
        auxAction === 'start' ? '私用 ComfyUI 起動を要求しました' : '私用 ComfyUI 停止を要求しました'
      );
    }
    return {
      ok: true,
      message: auxAction === 'start' ? 'ComfyUI 起動リクエストを送信しました' : 'ComfyUI 停止リクエストを送信しました',
    };
  };

  const runExperimentLabAuxStartStop = async (
    action: DgxControlTargetAction,
    reason: string | undefined,
    eventLog: TargetRuntimeEventLogMode
  ): Promise<{ ok: true; message: string }> => {
    const auxAction = ensureAuxRuntimeAction(action);
    const rt = readExperimentLabRuntimeEndpoints();
    if (!rt) {
      throw new ApiError(
        400,
        'experiment-lab の起停 URL が Pi5 に未設定です（DGX_RESOURCE_EXPERIMENT_LAB_RUNTIME_*）',
        { targetId: 'experiment-lab', action },
        'DGX_TARGET_ACTION_NOT_SUPPORTED'
      );
    }
    await executeAuxHttpRuntimeStartStop(deps, {
      action: auxAction,
      startUrl: rt.startUrl,
      stopUrl: rt.stopUrl,
      timeoutMs: auxTimeoutMs,
      controlToken: rt.token,
      reason,
      errorCodePrefix: 'DGX_EXPERIMENT_LAB',
    });
    if (auxAction === 'stop' && experimentLabHealthUrl) {
      const firstProbe = await probeHttpGet(experimentLabHealthUrl, deps.fetchImpl, deps.probeTimeoutMs);
      if (firstProbe.ok) {
        deps.policyStore.appendEvent('experiment-lab 停止確認: ヘルス応答が残っているため停止を再試行します');
        await executeAuxHttpRuntimeStartStop(deps, {
          action: auxAction,
          startUrl: rt.startUrl,
          stopUrl: rt.stopUrl,
          timeoutMs: auxTimeoutMs,
          controlToken: rt.token,
          reason: `${reason ?? 'dgx_resource_aux'}_retry1`,
          errorCodePrefix: 'DGX_EXPERIMENT_LAB',
        });
        const secondProbe = await probeHttpGet(experimentLabHealthUrl, deps.fetchImpl, deps.probeTimeoutMs);
        if (secondProbe.ok) {
          throw new ApiError(
            502,
            '補助ランタイム停止後もヘルス応答が残っています',
            {
              targetId: 'experiment-lab',
              healthUrl: experimentLabHealthUrl,
              firstStatusCode: firstProbe.statusCode ?? null,
              secondStatusCode: secondProbe.statusCode ?? null,
            },
            'DGX_EXPERIMENT_LAB_STOP_NOT_EFFECTIVE'
          );
        }
      }
    }
    if (eventLog === 'default') {
      deps.policyStore.appendEvent(
        auxAction === 'start' ? 'experiment-lab 起動を要求しました' : 'experiment-lab 停止を要求しました'
      );
    }
    return {
      ok: true,
      message:
        auxAction === 'start'
          ? 'experiment-lab 起動リクエストを送信しました'
          : 'experiment-lab 停止リクエストを送信しました',
    };
  };

  const runAgentContainerAuxStartStop = async (
    action: DgxControlTargetAction,
    reason: string | undefined,
    eventLog: TargetRuntimeEventLogMode
  ): Promise<{ ok: true; message: string }> => {
    const auxAction = ensureAuxRuntimeAction(action);
    const rt = readAgentContainerRuntimeEndpoints();
    if (!rt) {
      throw new ApiError(
        400,
        'agent-container の起停 URL が Pi5 に未設定です（DGX_RESOURCE_AGENT_CONTAINER_RUNTIME_*）',
        { targetId: 'agent-container', action },
        'DGX_TARGET_ACTION_NOT_SUPPORTED'
      );
    }
    await executeAuxHttpRuntimeStartStop(deps, {
      action: auxAction,
      startUrl: rt.startUrl,
      stopUrl: rt.stopUrl,
      timeoutMs: auxTimeoutMs,
      controlToken: rt.token,
      reason,
      errorCodePrefix: 'DGX_AGENT_CONTAINER',
    });
    if (auxAction === 'stop' && agentContainerHealthUrl) {
      const firstProbe = await probeHttpGet(agentContainerHealthUrl, deps.fetchImpl, deps.probeTimeoutMs);
      if (firstProbe.ok) {
        deps.policyStore.appendEvent('agent-container 停止確認: ヘルス応答が残っているため停止を再試行します');
        await executeAuxHttpRuntimeStartStop(deps, {
          action: auxAction,
          startUrl: rt.startUrl,
          stopUrl: rt.stopUrl,
          timeoutMs: auxTimeoutMs,
          controlToken: rt.token,
          reason: `${reason ?? 'dgx_resource_aux'}_retry1`,
          errorCodePrefix: 'DGX_AGENT_CONTAINER',
        });
        const secondProbe = await probeHttpGet(agentContainerHealthUrl, deps.fetchImpl, deps.probeTimeoutMs);
        if (secondProbe.ok) {
          throw new ApiError(
            502,
            '補助ランタイム停止後もヘルス応答が残っています',
            {
              targetId: 'agent-container',
              healthUrl: agentContainerHealthUrl,
              firstStatusCode: firstProbe.statusCode ?? null,
              secondStatusCode: secondProbe.statusCode ?? null,
            },
            'DGX_AGENT_CONTAINER_STOP_NOT_EFFECTIVE'
          );
        }
      }
    }
    if (eventLog === 'default') {
      deps.policyStore.appendEvent(
        auxAction === 'start' ? 'agent-container 起動を要求しました' : 'agent-container 停止を要求しました'
      );
    }
    return {
      ok: true,
      message:
        auxAction === 'start'
          ? 'agent-container 起動リクエストを送信しました'
          : 'agent-container 停止リクエストを送信しました',
    };
  };

  const runTargetRuntimeAction = async (
    targetId: DgxControlTargetId,
    action: DgxControlTargetAction,
    reason: string | undefined,
    eventLog: TargetRuntimeEventLogMode,
    modelProfileId?: string
  ): Promise<{ ok: true; message: string }> => {
    switch (targetId) {
      case 'system-prod-gateway':
        return runGatewayRuntimeStartStop(action, reason, eventLog, modelProfileId);
      case 'private-comfyui':
        return runComfyAuxStartStop(action, reason, eventLog);
      case 'experiment-lab':
        return runExperimentLabAuxStartStop(action, reason, eventLog);
      case 'agent-container':
        return runAgentContainerAuxStartStop(action, reason, eventLog);
      default:
        throw new ApiError(
          400,
          'この制御ターゲットでは start/stop を実行できません（読取のみ）',
          { targetId, action },
          'DGX_TARGET_ACTION_NOT_SUPPORTED'
        );
    }
  };

  const handleExecuteTargetAction = async (
    targetId: DgxControlTargetId,
    action: DgxControlTargetAction,
    reason?: string
  ): Promise<{ ok: true; message: string }> => {
    return runTargetRuntimeAction(targetId, action, reason, 'default');
  };

  const handleStartModelProfile = async (
    modelProfileId: string,
    reason?: string
  ): Promise<DgxResourceActionResult> => {
    const pb = await collectOverviewProbeBundle();
    assertModelProfileKnownAndStartable(pb.modelProfiles, modelProfileId);
    const r = await runTargetRuntimeAction(
      'system-prod-gateway',
      'start',
      reason,
      'default',
      modelProfileId
    );
    deps.policyStore.clearScenarioFailure();
    deps.policyStore.appendEvent(`model profile「${modelProfileId}」の起動を要求しました`);
    return {
      ok: true,
      message: `model profile「${modelProfileId}」: ${r.message}`,
    };
  };

  const handleSetPolicy = async (
    mode: DgxPolicyMode,
    opts?: { applyWorkloadChanges?: boolean }
  ): Promise<DgxResourceActionResult> => {
    const res = await executeWorkloadTransitionsThenApplyPolicyMode({
      mode,
      applyWorkloadChanges: Boolean(opts?.applyWorkloadChanges),
      workloadTraceReason: 'policy_ui',
      capability: {
        comfyRuntimeConfigured: comfyRuntimeControlConfigured(),
        experimentLabRuntimeConfigured: experimentLabRuntimeControlConfigured(),
        agentContainerRuntimeConfigured: agentContainerRuntimeControlConfigured(),
        gatewayRuntimeConfigured: gatewayRuntimeControlConfiguredFlag(),
      },
      runTargetRuntimeAction,
      policyStore: deps.policyStore,
    });
    deps.policyStore.clearScenarioFailure();
    return res;
  };

  const orchestrationScenarioPreview = async (
    scenarioId: DgxOrchestrationScenarioId,
    modelProfileId?: string
  ): Promise<DgxResourceActionResult> => {
    assertModelProfileSelectionAllowed(scenarioId, modelProfileId);
    const pb = await collectOverviewProbeBundle();
    if (modelProfileId) {
      assertModelProfileEligibleForBusinessReturn(pb.modelProfiles, modelProfileId);
    }
    const hints = inferenceHeuristics(pb.bundle);
    const preview = buildOrchestrationScenarioPreview({
      scenarioId,
      comfyRuntimeConfigured: pb.bundle.comfyRuntimeControlConfigured,
      experimentLabRuntimeConfigured: pb.bundle.experimentLabRuntimeControlConfigured,
      agentContainerRuntimeConfigured: pb.bundle.agentContainerRuntimeControlConfigured,
      gatewayRuntimeConfigured: pb.bundle.runtimeControlConfigured,
      currentPolicyMode: pb.bundle.policyMode,
      inferenceLooksDegraded: hints.inferenceLooksDegraded,
      comfyLooksRunning: hints.comfyLooksRunning,
      ...(modelProfileId ? { modelProfileId, modelProfiles: pb.modelProfiles.available } : {}),
    });
    const lines = preview.steps.map((s) => `${s.order}. ${s.summaryJa}`).join(' / ');
    return {
      ok: true,
      message: preview.warnings.length > 0 ? `プレビュー（警告あり）: ${lines}` : `プレビュー（${lines}）`,
      scenarioPreview: preview,
    };
  };

  const orchestrationScenarioExecute = async (
    scenarioId: DgxOrchestrationScenarioId,
    planFingerprint: string,
    modelProfileId?: string
  ): Promise<DgxResourceActionResult> => {
    assertModelProfileSelectionAllowed(scenarioId, modelProfileId);
    if (modelProfileId) {
      const pb = await collectOverviewProbeBundle();
      assertModelProfileEligibleForBusinessReturn(pb.modelProfiles, modelProfileId);
    }
    const result = await executeOrchestrationScenarioTransition({
      scenarioId,
      planFingerprint,
      ...(modelProfileId ? { modelProfileId } : {}),
      deferReadiness: scenarioId === 'private_to_business' || scenarioId === 'experiment_to_business',
      capability: {
        comfyRuntimeConfigured: comfyRuntimeControlConfigured(),
        experimentLabRuntimeConfigured: experimentLabRuntimeControlConfigured(),
        agentContainerRuntimeConfigured: agentContainerRuntimeControlConfigured(),
        gatewayRuntimeConfigured: gatewayRuntimeControlConfiguredFlag(),
      },
      runTargetRuntimeAction,
      policyStore: deps.policyStore,
      readinessCoordinator: {
        collectProbeBundle: async () => {
          const pb = await collectOverviewProbeBundle();
          return pb.bundle;
        },
        localLlmRuntimeMode: env.LOCAL_LLM_RUNTIME_MODE,
        readinessDeadlineMs: env.LOCAL_LLM_RUNTIME_READY_TIMEOUT_MS,
        readinessPollIntervalMs: env.LOCAL_LLM_RUNTIME_HEALTH_POLL_INTERVAL_MS,
      },
    });
    return result;
  };

  return {
    getEvents(limit: number): DgxResourceEvent[] {
      return deps.policyStore.getEvents(limit);
    },

    async executeAction(body: DgxResourceActionBody): Promise<DgxResourceActionResult> {
      if (body.type === 'SET_POLICY') {
        return handleSetPolicy(body.policyMode, {
          applyWorkloadChanges: body.applyWorkloadChanges,
        });
      }
      if (body.type === 'PREVIEW_ORCHESTRATION_SCENARIO') {
        return orchestrationScenarioPreview(body.scenarioId, body.modelProfileId);
      }
      if (body.type === 'EXECUTE_ORCHESTRATION_SCENARIO') {
        return orchestrationScenarioExecute(body.scenarioId, body.planFingerprint, body.modelProfileId);
      }
      if (body.type === 'EXECUTE_TARGET_ACTION') {
        const r = await handleExecuteTargetAction(body.targetId, body.action, body.reason);
        deps.policyStore.clearScenarioFailure();
        return r;
      }
      if (body.type === 'START_MODEL_PROFILE') {
        return handleStartModelProfile(body.modelProfileId, body.reason);
      }
      if (body.type === 'LOCAL_LLM_START') {
        const r = await handleExecuteTargetAction('system-prod-gateway', 'start', body.reason);
        deps.policyStore.clearScenarioFailure();
        return r;
      }
      const r = await handleExecuteTargetAction('system-prod-gateway', 'stop', body.reason);
      deps.policyStore.clearScenarioFailure();
      return r;
    },

    async getOverview(): Promise<DgxResourceOverview> {
      const pb = await collectOverviewProbeBundle();
      const bundle = pb.bundle;
      const targets = buildControlTargetSnapshots(bundle);
      const services = buildLegacyServiceCards(bundle);
      const monitoring = buildDgxResourceMonitoringOverview({
        bundle,
        targets,
        adminCfg: pb.adminCfg,
        lastScenarioFailure: deps.policyStore.getLastScenarioFailure(),
      });

      const operator = buildDgxResourceOperatorConsole({
        policyMode: pb.policyMode,
        previousMode: pb.previousMode,
        comfyStartBlockedHint: isBusinessFirstSuppressionHintActive(pb.policyMode),
        targets,
        monitoring,
      });
      const businessIntentEnv = {
        businessRuntimeStartProfileId: env.INFERENCE_BUSINESS_RUNTIME_START_PROFILE_ID,
        photoLabelRuntimeStartProfileId: env.INFERENCE_PHOTO_LABEL_RUNTIME_START_PROFILE_ID,
        documentSummaryRuntimeStartProfileId: env.INFERENCE_DOCUMENT_SUMMARY_RUNTIME_START_PROFILE_ID,
        adminRuntimeStartProfileId: env.INFERENCE_ADMIN_RUNTIME_START_PROFILE_ID,
      };
      const runtimeSummary = buildDgxResourceRuntimeSummary(bundle, pb.policyMode, businessIntentEnv);

      return {
        generatedAt: pb.generatedAt,
        kpis: {
          gpuUtilPct: bundle.metricsPayload?.gpuUtilPct ?? null,
          unifiedMemoryUsedGiB: bundle.metricsPayload?.unifiedMemoryUsedGiB ?? null,
          unifiedMemoryTotalGiB: bundle.metricsPayload?.unifiedMemoryTotalGiB ?? null,
          freeMemoryGiB: bundle.metricsPayload?.freeMemoryGiB ?? null,
          policyMode: pb.policyMode,
          policyLabel: policyLabelJa(pb.policyMode),
        },
        policy: {
          mode: pb.policyMode,
          previousMode: pb.previousMode,
          comfyStartBlockedHint: isBusinessFirstSuppressionHintActive(pb.policyMode),
        },
        runtime: {
          localLlmMode: env.LOCAL_LLM_RUNTIME_MODE,
          runtimeControlConfigured: pb.runtimeControlConfigured,
          warmWindow: buildWarmWindow(),
        },
        optionalProbes: {
          metricsConfigured: pb.metricsConfigured,
          comfyHealthConfigured: pb.comfyConfigured,
          embeddingHealthConfigured: pb.embeddingConfigured,
          sparkHostConfigured: pb.sparkConfigured,
          comfyRuntimeControlConfigured: pb.comfyRtCfg,
          experimentLabHealthConfigured: pb.experimentLabHealthConfigured,
          experimentLabRuntimeControlConfigured: pb.expLabRtCfg,
          agentContainerHealthConfigured: pb.agentContainerHealthConfigured,
          agentContainerRuntimeControlConfigured: pb.agentRtCfg,
        },
        targets,
        sparkHost: pb.sparkHost,
        services,
        notes: pb.notes,
        monitoring,
        operator,
        modelProfiles: pb.modelProfiles,
        resourceState: pb.modelProfiles.resourceState,
        runtimeSummary,
      };
    },
  };
}
