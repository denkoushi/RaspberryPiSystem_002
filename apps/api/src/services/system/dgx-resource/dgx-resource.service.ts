import { ApiError } from '../../../lib/errors.js';
import { env } from '../../../config/env.js';

import {
  isBusinessFirstSuppressionHintActive,
  policyLabelJa,
  setPolicyEventMessage,
} from './dgx-resource.policy-profile.js';
import type { DgxPolicyMode, DgxResourceEvent, DgxResourcePolicyStore } from './dgx-resource.policy-store.js';

import type { DgxControlTargetAction, DgxControlTargetId, DgxControlTargetSnapshot } from './dgx-resource.control-target.types.js';
import { executeGatewayRuntimeStartStop } from './dgx-resource.gateway-runtime.executor.js';
import {
  buildControlTargetSnapshots,
  buildLegacyServiceCards,
  type DgxResourceServiceCard,
  type OverviewProbeBundle,
} from './dgx-resource.control-targets.builder.js';
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
  | { type: 'SET_POLICY'; policyMode: DgxPolicyMode }
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

export function createDgxResourceService(deps: DgxResourceServiceDeps): DgxResourceServicePort {
  const handleSetPolicy = (mode: DgxPolicyMode): { ok: true; message: string } => {
    const changed = deps.policyStore.setPolicyMode(mode);
    if (!changed) {
      return { ok: true, message: `${policyLabelJa(mode)}モードのままです` };
    }
    const msg = setPolicyEventMessage(mode);
    deps.policyStore.appendEvent(msg);
    return { ok: true, message: msg };
  };

  const executeGatewayStartStop = async (
    action: DgxControlTargetAction,
    reason?: string
  ): Promise<{ ok: true; message: string }> => {
    await executeGatewayRuntimeStartStop(deps, action, reason);
    if (action === 'start') {
      deps.policyStore.appendEvent('LocalLLM ランタイム起動を要求しました');
      return { ok: true, message: '起動リクエストを送信しました（反映まで時間がかかる場合があります）' };
    }
    deps.policyStore.appendEvent('LocalLLM ランタイム停止を要求しました');
    return { ok: true, message: '停止リクエストを送信しました' };
  };

  const handleExecuteTargetAction = async (
    targetId: DgxControlTargetId,
    action: DgxControlTargetAction,
    reason?: string
  ): Promise<{ ok: true; message: string }> => {
    if (targetId !== 'system-prod-gateway') {
      throw new ApiError(
        400,
        'この制御ターゲットでは start/stop を実行できません（読取のみ）',
        { targetId, action },
        'DGX_TARGET_ACTION_NOT_SUPPORTED'
      );
    }
    return executeGatewayStartStop(action, reason);
  };

  return {
    getEvents(limit: number): DgxResourceEvent[] {
      return deps.policyStore.getEvents(limit);
    },

    async executeAction(body: DgxResourceActionBody): Promise<{ ok: true; message: string }> {
      if (body.type === 'SET_POLICY') return handleSetPolicy(body.policyMode);
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

      const runtimeControlConfigured =
        Boolean(env.LOCAL_LLM_RUNTIME_CONTROL_START_URL?.trim() && env.LOCAL_LLM_RUNTIME_CONTROL_STOP_URL?.trim()) &&
        env.LOCAL_LLM_RUNTIME_MODE === 'on_demand';

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
        },
        targets,
        sparkHost,
        services,
        notes,
      };
    },
  };
}
