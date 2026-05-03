import { ApiError } from '../../../lib/errors.js';
import { env } from '../../../config/env.js';

import {
  isBusinessFirstSuppressionHintActive,
  policyLabelJa,
  setPolicyEventMessage,
} from './dgx-resource.policy-profile.js';
import type { DgxPolicyMode, DgxResourceEvent, DgxResourcePolicyStore } from './dgx-resource.policy-store.js';

import type { DgxControlTargetAction, DgxControlTargetId, DgxControlTargetSnapshot } from './dgx-resource.control-target.types.js';
import { executeAuxHttpRuntimeStartStop } from './dgx-resource.aux-http-runtime.executor.js';
import { executeGatewayRuntimeStartStop } from './dgx-resource.gateway-runtime.executor.js';
import {
  buildControlTargetSnapshots,
  buildLegacyServiceCards,
  type DgxResourceServiceCard,
  type OverviewProbeBundle,
} from './dgx-resource.control-targets.builder.js';
import { planWorkloadAdjustmentsBeforePolicyChange } from './dgx-resource.policy-arbitrator.js';
import { fetchJsonMetrics, probeHttpGet, probeHttpOk, probeV1Models } from './dgx-resource.probes.js';

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
  };
  /** 標準 Control Target 一覧（監視・許可操作の正規モデル） */
  targets: DgxControlTargetSnapshot[];
  sparkHost: DgxSparkHostOverview;
  /** @deprecated 後方互換。UI は targets を優先 */
  services: DgxResourceServiceCard[];
  notes: string[];
};

export type DgxResourceActionBody =
  | { type: 'LOCAL_LLM_START'; reason?: string }
  | { type: 'LOCAL_LLM_STOP'; reason?: string }
  | { type: 'SET_POLICY'; policyMode: DgxPolicyMode; applyWorkloadChanges?: boolean }
  | {
      type: 'EXECUTE_TARGET_ACTION';
      targetId: DgxControlTargetId;
      action: DgxControlTargetAction;
      reason?: string;
    };

export type DgxResourceServicePort = {
  getOverview: () => Promise<DgxResourceOverview>;
  executeAction: (body: DgxResourceActionBody) => Promise<{ ok: true; message: string }>;
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

function comfyRuntimeControlConfigured(): boolean {
  return readComfyRuntimeEndpoints() !== undefined;
}

function experimentLabRuntimeControlConfigured(): boolean {
  return readExperimentLabRuntimeEndpoints() !== undefined;
}

type TargetRuntimeEventLogMode = 'default' | 'none';

export function createDgxResourceService(deps: DgxResourceServiceDeps): DgxResourceServicePort {
  const auxTimeoutMs = env.DGX_RESOURCE_AUX_RUNTIME_REQUEST_TIMEOUT_MS;

  const runGatewayRuntimeStartStop = async (
    action: DgxControlTargetAction,
    reason: string | undefined,
    eventLog: TargetRuntimeEventLogMode
  ): Promise<{ ok: true; message: string }> => {
    await executeGatewayRuntimeStartStop(deps, action, reason);
    if (eventLog === 'default') {
      if (action === 'start') {
        deps.policyStore.appendEvent('LocalLLM ランタイム起動を要求しました');
        return { ok: true, message: '起動リクエストを送信しました（反映まで時間がかかる場合があります）' };
      }
      deps.policyStore.appendEvent('LocalLLM ランタイム停止を要求しました');
      return { ok: true, message: '停止リクエストを送信しました' };
    }
    return {
      ok: true,
      message:
        action === 'start'
          ? 'ゲートウェイ起動リクエストを送信しました'
          : 'ゲートウェイ停止リクエストを送信しました',
    };
  };

  const runComfyAuxStartStop = async (
    action: DgxControlTargetAction,
    reason: string | undefined,
    eventLog: TargetRuntimeEventLogMode
  ): Promise<{ ok: true; message: string }> => {
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
      action,
      startUrl: rt.startUrl,
      stopUrl: rt.stopUrl,
      timeoutMs: auxTimeoutMs,
      controlToken: rt.token,
      reason,
      errorCodePrefix: 'DGX_COMFY',
    });
    if (eventLog === 'default') {
      deps.policyStore.appendEvent(
        action === 'start' ? '私用 ComfyUI 起動を要求しました' : '私用 ComfyUI 停止を要求しました'
      );
    }
    return {
      ok: true,
      message: action === 'start' ? 'ComfyUI 起動リクエストを送信しました' : 'ComfyUI 停止リクエストを送信しました',
    };
  };

  const runExperimentLabAuxStartStop = async (
    action: DgxControlTargetAction,
    reason: string | undefined,
    eventLog: TargetRuntimeEventLogMode
  ): Promise<{ ok: true; message: string }> => {
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
      action,
      startUrl: rt.startUrl,
      stopUrl: rt.stopUrl,
      timeoutMs: auxTimeoutMs,
      controlToken: rt.token,
      reason,
      errorCodePrefix: 'DGX_EXPERIMENT_LAB',
    });
    if (eventLog === 'default') {
      deps.policyStore.appendEvent(
        action === 'start' ? 'experiment-lab 起動を要求しました' : 'experiment-lab 停止を要求しました'
      );
    }
    return {
      ok: true,
      message:
        action === 'start'
          ? 'experiment-lab 起動リクエストを送信しました'
          : 'experiment-lab 停止リクエストを送信しました',
    };
  };

  const runTargetRuntimeAction = async (
    targetId: DgxControlTargetId,
    action: DgxControlTargetAction,
    reason: string | undefined,
    eventLog: TargetRuntimeEventLogMode
  ): Promise<{ ok: true; message: string }> => {
    switch (targetId) {
      case 'system-prod-gateway':
        return runGatewayRuntimeStartStop(action, reason, eventLog);
      case 'private-comfyui':
        return runComfyAuxStartStop(action, reason, eventLog);
      case 'experiment-lab':
        return runExperimentLabAuxStartStop(action, reason, eventLog);
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
  ): Promise<{ ok: true; message: string }> =>
    runTargetRuntimeAction(targetId, action, reason, 'default');

  const handleSetPolicy = async (
    mode: DgxPolicyMode,
    opts?: { applyWorkloadChanges?: boolean }
  ): Promise<{ ok: true; message: string }> => {
    const applyWorkloadChanges = Boolean(opts?.applyWorkloadChanges);

    const plan = planWorkloadAdjustmentsBeforePolicyChange({
      nextMode: mode,
      applyWorkloadChanges,
      comfyRuntimeConfigured: comfyRuntimeControlConfigured(),
      experimentLabRuntimeConfigured: experimentLabRuntimeControlConfigured(),
      gatewayRuntimeConfigured: gatewayRuntimeControlConfiguredFlag(),
    });

    for (const step of plan) {
      await runTargetRuntimeAction(step.targetId, step.action, 'policy_workload_transition', 'none');
      deps.policyStore.appendEvent(step.eventMessageJa);
    }

    const changed = deps.policyStore.setPolicyMode(mode);
    if (!changed) {
      if (plan.length > 0) {
        return { ok: true, message: `${policyLabelJa(mode)}モードのまま。ワークロード調整のみ実行しました` };
      }
      return { ok: true, message: `${policyLabelJa(mode)}モードのままです` };
    }
    const msg = setPolicyEventMessage(mode);
    deps.policyStore.appendEvent(msg);
    return { ok: true, message: msg };
  };

  return {
    getEvents(limit: number): DgxResourceEvent[] {
      return deps.policyStore.getEvents(limit);
    },

    async executeAction(body: DgxResourceActionBody): Promise<{ ok: true; message: string }> {
      if (body.type === 'SET_POLICY') {
        return handleSetPolicy(body.policyMode, {
          applyWorkloadChanges: body.applyWorkloadChanges,
        });
      }
      if (body.type === 'EXECUTE_TARGET_ACTION') {
        return handleExecuteTargetAction(body.targetId, body.action, body.reason);
      }
      if (body.type === 'LOCAL_LLM_START') {
        return handleExecuteTargetAction('system-prod-gateway', 'start', body.reason);
      }
      return handleExecuteTargetAction('system-prod-gateway', 'stop', body.reason);
    },

    async getOverview(): Promise<DgxResourceOverview> {
      const generatedAt = new Date().toISOString();
      const policyMode = deps.policyStore.getPolicyMode();
      const previousMode = deps.policyStore.getPreviousPolicyMode();

      const adminCfg = deps.getAdminLocalLlmRuntimeConfig();
      const gatewayStatus = await deps.localLlmGateway.getStatus();

      let modelsProbe: { ok: boolean; statusCode?: number } = { ok: false };
      if (
        gatewayStatus.configured &&
        adminCfg.configured &&
        adminCfg.baseUrl &&
        adminCfg.sharedToken &&
        gatewayStatus.health.ok
      ) {
        modelsProbe = await probeV1Models(
          adminCfg.baseUrl,
          adminCfg.sharedToken,
          deps.fetchImpl,
          deps.probeTimeoutMs
        );
      }

      const metricsConfigured = Boolean(deps.metricsUrl?.trim());
      const metricsPayload = metricsConfigured
        ? await fetchJsonMetrics(deps.metricsUrl!, deps.fetchImpl, deps.probeTimeoutMs)
        : undefined;

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

      const runtimeControlConfigured = gatewayRuntimeControlConfiguredFlag();
      const comfyRtCfg = comfyRuntimeControlConfigured();
      const expLabRtCfg = experimentLabRuntimeControlConfigured();

      const bundle: OverviewProbeBundle = {
        policyMode,
        adminCfg,
        gatewayStatus,
        modelsProbe,
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
      };

      const targets = buildControlTargetSnapshots(bundle);
      const services = buildLegacyServiceCards(bundle);

      const notes: string[] = [];
      if (!metricsConfigured) {
        notes.push('GPU/メモリKPI は DGX_RESOURCE_METRICS_URL が未設定のため取得していません');
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

      if (!experimentLabHealthConfigured && expLabRtCfg) {
        notes.push(
          'experiment-lab のヘルス URL 未設定のため状態は不明ですが、起停用 POST は利用できます（任意で DGX_RESOURCE_EXPERIMENT_LAB_HEALTH_URL）'
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
        kpis: {
          gpuUtilPct: metricsPayload?.gpuUtilPct ?? null,
          unifiedMemoryUsedGiB: metricsPayload?.unifiedMemoryUsedGiB ?? null,
          unifiedMemoryTotalGiB: metricsPayload?.unifiedMemoryTotalGiB ?? null,
          freeMemoryGiB: metricsPayload?.freeMemoryGiB ?? null,
          policyMode,
          policyLabel: policyLabelJa(policyMode),
        },
        policy: {
          mode: policyMode,
          previousMode,
          comfyStartBlockedHint: isBusinessFirstSuppressionHintActive(policyMode),
        },
        runtime: {
          localLlmMode: env.LOCAL_LLM_RUNTIME_MODE,
          runtimeControlConfigured,
          warmWindow: buildWarmWindow(),
        },
        optionalProbes: {
          metricsConfigured,
          comfyHealthConfigured: comfyConfigured,
          embeddingHealthConfigured: embeddingConfigured,
          sparkHostConfigured: sparkConfigured,
          comfyRuntimeControlConfigured: comfyRtCfg,
          experimentLabHealthConfigured,
          experimentLabRuntimeControlConfigured: expLabRtCfg,
        },
        targets,
        sparkHost,
        services,
        notes,
      };
    },
  };
}
